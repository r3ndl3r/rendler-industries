# /lib/MyApp/Controller/System.pm

package MyApp::Controller::System;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for System-level operations and maintenance.
# Handles high-privilege tasks related to server health and automation triggers.
#
# Features:
#   - Service lifecycle management (Non-blocking Hot Restart).
#   - Centralized maintenance hook for automated jobs (Timers, Reminders).
#
# Integration Points:
#   - Linux Shell: Direct interaction with Hypnotoad and background forking.
#   - External: Triggered via system cron for /api/maintenance.
#   - Restricted to 'admin' bridge via router.

use DateTime;

# Returns public Firebase Web Messaging configuration for PWA push.
# Route: GET /api/fcm/web-config
# Returns: JSON object { success, enabled, config, vapid_key }
sub api_fcm_web_config {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $web = $c->app->config->{firebase_web} || {};
    my $enabled = ($web->{api_key} && $web->{project_id} && $web->{messaging_sender_id} && $web->{app_id} && $web->{vapid_key}) ? 1 : 0;

    return $c->render(json => {
        success   => 1,
        enabled   => $enabled,
        config    => {
            apiKey            => $web->{api_key}             // '',
            authDomain        => $web->{auth_domain}         // '',
            projectId         => $web->{project_id}          // '',
            storageBucket     => $web->{storage_bucket}      // '',
            messagingSenderId => $web->{messaging_sender_id} // '',
            appId             => $web->{app_id}              // '',
        },
        vapid_key => $web->{vapid_key} // '',
    });
}

# Stores a device FCM token for the currently logged-in user.
# Route: POST /api/fcm/register
# Parameters:
#   token    : FCM registration token string from the Capacitor plugin or Firebase Web SDK.
#   platform : Optional platform marker. Defaults to android_native for old app builds.
# Returns: JSON object { success }
sub api_fcm_register {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $token    = trim($c->param('token')    // '');
    my $platform = trim($c->param('platform') // 'android_native');
    return $c->render(json => { success => 0, error => 'Token required' }) unless $token;
    return $c->render(json => { success => 0, error => 'Invalid platform' })
        unless $platform =~ /\A(?:android_native|pwa_web)\z/;

    my $user_id = $c->current_user_id;
    my $ua = substr($c->req->headers->user_agent // '', 0, 255);
    eval { $c->db->save_fcm_token($user_id, $token, $platform, $ua) };
    if ($@) {
        $c->app->log->error("FCM token save failed for user $user_id: $@");
        return $c->render(json => { success => 0, error => 'Failed to save token' });
    }

    return $c->render(json => { success => 1 });
}

# Initiates a hot restart of the application server.
# Route: GET /restart
# Parameters: None
# Returns:
#   Text confirmation if command initiated successfully.
#   HTTP 500 if the system process fork fails.
# Behavior:
#   - Forks a background process to avoid blocking the HTTP response.
#   - Executes 'hypnotoad -s' followed by a fresh start.
sub restart {
    my $c = shift;
    return $c->render('noperm') unless $c->is_admin;
    
    # Fork a child process to handle the blocking system command
    my $pid = fork();
    my $base_path = $c->app->home; 

    if ($pid == 0) {
        # Child Process: Execute shell command sequence
        # 1. Navigate to app root
        # 2. Hot deploy/Stop (-s)
        # 3. Start fresh instance
        my $cmd = "cd $base_path && hypnotoad -s mojo.pl && hypnotoad mojo.pl";

        exec('sh', '-c', $cmd) or die "Failed to execute shell command: $!";
    } elsif ($pid > 0) {
        # Parent Process: Return immediate success response to user
        $c->render(text => 'Service restart command initiated.');
    } else {
        # Handle Fork Failure
        $c->render(text => 'Failed to initiate restart command.', status => 500);
    }
}

# Internal helper to handle automated chore reminders for pending tasks.
# Parameters:
#   - now : DateTime object representing the current execution minute.
# Returns: None
sub run_chore_reminders {
    my ($c, $now) = @_;
    
    my $stale_chores = $c->db->get_stale_chores_and_mark();
    return unless @$stale_chores;

    my $kids = $c->db->get_child_users() || [];

    for my $chore (@$stale_chores) {
        my $target_name  = $chore->{target_user} // 'Everyone';
        my $target_emoji = $chore->{target_emoji} // '🌍';

        if ($chore->{assigned_to}) {
            $c->notify_templated($chore->{assigned_to}, 'chore_stale_reminder', { 
                icon   => $target_emoji, 
                task   => $chore->{title}, 
                points => $chore->{points} || 0, 
                target => $target_name 
            }, 0);
        } else {
            for my $k (@$kids) {
                $c->notify_templated($k->{id}, 'chore_stale_reminder', { 
                    icon   => $target_emoji, 
                    task   => $chore->{title}, 
                    points => $chore->{points} || 0, 
                    target => $target_name 
                }, 0);
            }
        }
        $c->app->log->info("Chores: Automated nag dispatched for chore $chore->{id}.");
    }
}

# Internal helper to handle automated playbook scheduling.
# Parameters:
#   - now : DateTime object representing the current execution minute.
# Returns:
#   Stats HashRef { started }
sub run_automator_maintenance {
    my ($c, $now) = @_;
    return if $c->db->automator_active_run_count >= int($c->app->config->{automator}{max_concurrent_runs} || 10);

    require MyApp::Controller::Admin::Automator;
    my $due = $c->db->get_due_automator_schedules(10);
    my $started = 0;
    for my $schedule (@$due) {
        last if $c->db->automator_active_run_count >= int($c->app->config->{automator}{max_concurrent_runs} || 10);
        my $payload = eval { MyApp::Controller::Admin::Automator::_load_run_payload($c->db, $schedule->{playbook_id}) };
        if ($@) {
            $c->app->log->error("Automator schedule $schedule->{id} could not load playbook: $@");
            next;
        }
        my $history_id = $c->db->create_automator_history($schedule->{playbook_id}, 'run', {}, undef);
        $c->db->mark_automator_schedule_dispatched($schedule, $history_id);
        MyApp::Controller::Admin::Automator::_spawn_run($c->app, $history_id, 'run', {}, $payload);
        $started++;
    }
    return { started => $started };
}

# Internal helper for Automator health: prunes stale 'running' records if processes are gone.
# Parameters: None
# Returns: None
sub run_automator_heartbeat {
    my ($c) = @_;
    $c->db->automator_heartbeat();
}

# Internal helper to handle meal planner automation (Lock-in at 2PM, Reminders at 8AM/12PM).
# Parameters:
#   - now : DateTime object representing the current execution minute.
# Returns:
#   Stats HashRef { checked_time, actions }
sub run_meals_maintenance {
    my ($c, $now) = @_;
    my $hour = $now->hour;
    my $minute = $now->minute;
    
    my $stats = {
        checked_time => $now->strftime('%H:%M'),
        actions => []
    };

    # 1. Reminders (8 AM and 12 PM)
    if ($minute == 0 && ($hour == 8 || $hour == 12)) {
        # Check if today's plan is still open
        my $today_plan = $c->db->get_active_plan(0)->[0]; # user_id=0 (system context)
        
        # Check if we already sent this specific hourly reminder
        my $flag_col = $hour == 8 ? 'reminder_8am_sent' : 'reminder_12pm_sent';
        my ($already_sent) = $c->db->{dbh}->selectrow_array("SELECT $flag_col FROM meal_plan WHERE id = ?", undef, $today_plan->{id});

        if ($today_plan && $today_plan->{status} eq 'open' && !$already_sent) {
            # Mark as sent immediately to prevent other workers from firing
            $c->db->{dbh}->do("UPDATE meal_plan SET $flag_col = 1 WHERE id = ?", undef, $today_plan->{id});

            my $participation = $c->db->get_plan_participation($today_plan->{id});
            my %has_suggested = map { $_ => 1 } @{$participation->{suggested_ids}};
            my %has_voted     = map { $_ => 1 } @{$participation->{voted_ids}};
            
            # Find all family members
            my $users = $c->db->get_family_users();
            foreach my $u (@$users) {
                # Target family/admins who have NOT suggested AND have NOT voted
                if (!$has_suggested{$u->{id}} && !$has_voted{$u->{id}}) {
                    $c->notify_templated($u->{id}, 'meals_reminder', { 
                        user     => $u->{username}, 
                        deadline => '2:00 PM' 
                    }, 0);
                }
            }
            push @{$stats->{actions}}, "Sent $hour:00 targeted reminders";
        }
    }

    # 2. Lock-in (Exactly 2 PM)
    if ($hour == 14 && $minute == 0) {
        my $today_plan = $c->db->get_active_plan(0)->[0]; # user_id=0 (system context)
        
        # Guard Clause: Ensure we only perform 2PM automation once per day across all workers
        if ($today_plan && $today_plan->{status} eq 'open' && !$today_plan->{reminder_2pm_sent}) {
            # Mark as sent immediately to prevent other workers from firing while we process
            $c->db->{dbh}->do("UPDATE meal_plan SET reminder_2pm_sent = 1 WHERE id = ?", undef, $today_plan->{id});
            my $suggestions = $today_plan->{suggestions};
            
            if (scalar @$suggestions > 0) {
                # Find winner (get_suggestions_for_day returns sorted by vote count)
                my $winner = $suggestions->[0];
                
                # Check for ties
                if (scalar @$suggestions > 1 && $suggestions->[0]{vote_count} == $suggestions->[1]{vote_count}) {
                    my $admins = $c->db->get_admins();
                    
                    # De-duplicate recipients
                    my %seen_users;
                    foreach my $a (@$admins) {
                        next if $seen_users{$a->{id}}++;
                        $c->notify_templated($a->{id}, 'meals_tie', {}, 0);
                    }
                    push @{$stats->{actions}}, "Notified admins of tie";
                } else {
                    # Auto-lock winner (This updates status to 'locked', stopping other workers)
                    $c->db->lock_suggestion($today_plan->{id}, $winner->{id});
                    
                    # Notify everyone of the final choice
                    my $users = $c->db->get_family_users();
                    
                    # De-duplicate recipients
                    my %seen_users;
                    foreach my $u (@$users) {
                        next if $seen_users{$u->{id}}++;
                        $c->notify_templated($u->{id}, 'meals_locked_in', { 
                            meal_name    => $winner->{meal_name}, 
                            vote_count   => $winner->{vote_count}, 
                            suggested_by => $winner->{suggested_by_name} 
                        }, 0);
                    }
                    push @{$stats->{actions}}, "Locked in: $winner->{meal_name}";
                }
            } else {
                # No suggestions at 2PM? Notify Family (Widened from Admin-only)
                my $users = $c->db->get_family_users();
                
                # De-duplicate recipients
                my %seen_users;
                foreach my $u (@$users) {
                    next if $seen_users{$u->{id}}++;
                    $c->notify_templated($u->{id}, 'meals_empty', {}, 0);
                }
                push @{$stats->{actions}}, "Notified family of empty plan";
            }
        }
    }

    return $stats;
}

# Internal helper to handle asynchronous weather fetching from OpenWeatherMap (OWM).
# Parameters:
#   - now : DateTime object representing the current execution minute.
# Returns:
#   Stats HashRef { checked_time, locations_checked, updates_triggered, errors }
sub run_weather_maintenance {
    my ($self, $now) = @_;
    
    my $stats = {
        checked_time => $now->strftime('%H:%M'),
        locations_checked => 0,
        updates_triggered => 0,
        errors => 0
    };

    # 1. Retrieve the OWM API Key from global settings
    my $api_key = $self->db->get_owm_api_key();
    unless ($api_key) {
        $self->app->log->warn("Weather: OWM API Key not configured. Skipping maintenance.");
        return $stats;
    }

    # 2. Identify locations due for a fresh observation
    my $due_locations = $self->db->get_due_weather_locations();
    $stats->{locations_checked} = scalar @$due_locations;

    foreach my $l (@$due_locations) {
        # OWM One Call 3.0 Endpoint
        my $url = sprintf(
            "https://api.openweathermap.org/data/3.0/onecall?lat=%s&lon=%s&appid=%s&units=metric",
            $l->{lat}, $l->{lon}, $api_key
        );
        
        # Use the persistent app-wide UserAgent (Non-blocking)
        $self->ua->get($url => sub {
            my ($ua, $tx) = @_;
            
            if (my $res = $tx->result) {
                if ($res->is_success) {
                    # Store the raw JSON payload for client-side parsing
                    my $raw_json = $res->body;
                    my $observed_at = $now->strftime('%Y-%m-%d %H:%M:%S');

                    eval {
                        $self->db->save_weather_observation($l->{id}, $raw_json, $observed_at);
                        $self->app->log->info("Weather: Updated location '$l->{name}' with fresh OWM One Call data.");
                    };
                    if ($@) {
                        $self->app->log->error("Weather: Database save failed for '$l->{name}': $@");
                    }
                } else {
                    $self->app->log->error("Weather: OWM request failed for '$l->{name}' (HTTP " . $res->code . "): " . $res->body);
                }
            } else {
                $self->app->log->error("Weather: OWM connection failed for '$l->{name}': " . $tx->error->{message});
            }
        });
        
        $stats->{updates_triggered}++;
    }

    return $stats;
}

# Internal helper to handle daily room cleaning reminders.
# Parameters:
#   - now : DateTime object representing the current execution minute.
# Returns:
#   Stats HashRef { checked_time, reminders_sent }
sub run_room_reminders {
    my ($c, $now) = @_;
    
    my $stats = {
        checked_time => $now->strftime('%H:%M'),
        reminders_sent => 0
    };

    my $today = $now->strftime('%Y-%m-%d');
    my $needing_reminders = $c->db->get_users_needing_room_reminders($today);
    
    foreach my $r (@$needing_reminders) {
        my $comments = $c->db->get_room_failed_comments($r->{user_id}, $today);
        
        my $comments_str = "";
        if (@$comments) {
            $comments_str = "\n\n⚠️ **Items to fix from your previous upload:**\n";
            foreach my $comment (@$comments) {
                $comments_str .= " - $comment\n";
            }
        }
        
        # Mark as sent FIRST to prevent double-firing across workers
        $c->db->update_room_reminder_sent($r->{user_id});
        
        if ($c->notify_templated($r->{user_id}, 'room_reminder', { 
            comments => $comments_str 
        }, 0)) {
            $stats->{reminders_sent}++;
            $c->app->log->info("Room reminder sent to $r->{username}");
        }
    }

    return $stats;
}

# Internal helper to handle recurring reminders.
# Parameters:
#   - now : DateTime object representing the current execution minute.
# Returns:
#   Stats HashRef { checked_minute, due_found, notified, errors }
sub run_reminder_maintenance {
    my ($c, $now) = @_;
    
    my $stats = {
        checked_minute => $now->strftime('%H:%M'),
        day_number     => $now->day_of_week, # 1=Mon, 7=Sun
        due_found      => 0,
        notified       => 0,
        errors         => 0
    };

    # Fetch reminders that should trigger NOW
    my $due_reminders = $c->db->get_due_reminders($stats->{day_number}, $stats->{checked_minute});
    $stats->{due_found} = scalar @$due_reminders;

    # Track processed reminder IDs to avoid double-marking for multi-recipient rules
    my %processed_reminder_ids;

    foreach my $r (@$due_reminders) {
        # CRITICAL: Mark as sent BEFORE notifying.
        # Since notify_user is non-blocking, we must ensure another worker 
        # doesn't see this reminder as "unsent" while the first worker's 
        # notification is still "in flight" via async promise.
        unless ($processed_reminder_ids{$r->{id}}) {
            if ($r->{is_one_off}) {
                $c->db->delete_reminder($r->{id});
            } else {
                my $today_iso = $now->strftime('%Y-%m-%d');
                my $intended_at = "$today_iso $r->{reminder_time}";
                $c->db->mark_reminder_sent($r->{id}, $intended_at);
            }
            $processed_reminder_ids{$r->{id}} = 1;
        }

        # Dispatch notification to EVERY recipient in the join list
        if ($c->notify_templated($r->{user_id}, 'reminder_alert', { 
            title       => $r->{title}, 
            description => $r->{description} 
        }, 0)) {
            $stats->{notified}++;
            
            # Automated chore generation for child recipients
            if (defined $r->{chore_points} && $r->{is_child}) {
                my $chore_ok = eval {
                    $c->db->add_chore($r->{title}, $r->{chore_points}, $r->{user_id});
                    1;
                };

                if ($chore_ok) {
                    $c->app->log->info("Chores: Created automatic chore from reminder $r->{id} for user $r->{user_id}.");
                    $c->notify_templated($r->{user_id}, 'chore_new_linked', { 
                        user   => $r->{username},
                        icon   => $c->getUserIcon($r->{username}),
                        task   => $r->{title}, 
                        points => $r->{chore_points} 
                    }, 0);
                }
 else {
                    $c->app->log->error("Chores: Failed to create auto-chore from reminder $r->{id}: $@");
                }
            }
        } else {
            $stats->{errors}++;
        }
    }

    return $stats;
}

# Internal helper to handle medication dose reminder dispatch and re-alert.
# Called every 60 seconds by the maintenance system.
# Parameters:
#   - now : DateTime object
# Returns:
#   Stats HashRef { checked_minute, initial_fired, re_alerts_sent, errors }
sub run_medication_reminder_maintenance {
    my ($c, $now) = @_;

    my $stats = {
        checked_minute => $now->strftime('%H:%M'),
        day_number     => $now->day_of_week, # 1=Mon, 7=Sun
        initial_fired  => 0,
        re_alerts_sent => 0,
        errors         => 0
    };

    my $current_date = $now->strftime('%Y-%m-%d');
    my $current_time = $now->strftime('%H:%M');

    # PHASE 1: INITIAL FIRE — due reminders with no today's event yet, matching current day of week
    my $due = $c->db->get_due_medication_reminders($current_date, $current_time, $stats->{day_number});
    foreach my $r (@$due) {
        eval {
            # Create event FIRST (marks as "in flight", prevents double-fire)
            $c->db->create_medication_reminder_event($r->{id}, $current_date, $r->{reminder_time});

            # Notify the family member (the person who needs to take it)
            my $time_display = substr($r->{reminder_time}, 0, 5);
            $c->notify_templated($r->{family_member_id}, 'medication_dose_reminder', {
                medication    => $r->{medication_name},
                dosage        => $r->{dosage},
                family_member => $r->{family_member_name},
                time          => $time_display
            }, 0);

            $stats->{initial_fired}++;
        };
        if ($@) {
            $c->app->log->error("Medication reminder initial fire failed for reminder $r->{id}: $@");
            $stats->{errors}++;
        }
    }

    # PHASE 2: RE-ALERT — overdue confirmations (unconfirmed + last_fired_at > 30 min ago or never fired)
    my $overdue = $c->db->get_overdue_medication_confirmations($current_date);
    foreach my $o (@$overdue) {
        eval {
            # Update last_fired_at to NOW() (prevents re-trigger for another 30 min)
            $c->db->touch_medication_reminder_event($o->{event_id});

            # Dispatch re-alert notification
            my $time_display = substr($o->{scheduled_time}, 0, 5);
            $c->notify_templated($o->{family_member_id}, 'medication_dose_overdue', {
                medication    => $o->{medication_name},
                dosage        => $o->{dosage},
                family_member => $o->{family_member_name},
                time          => $time_display
            }, 0);

            $stats->{re_alerts_sent}++;
        };
        if ($@) {
            $c->app->log->error("Medication reminder re-alert failed for event $o->{event_id}: $@");
            $stats->{errors}++;
        }
    }

    return $stats;
}

# Internal helper to handle timer-specific maintenance tasks.
# Parameters: None
# Returns:
#   Stats HashRef { cleaned_sessions, updated_timers, warnings_sent, expiry_sent }
sub run_timer_maintenance {
    my $c = shift;
    
    my $stats = {
        cleaned_sessions => 0,
        updated_timers => 0,
        warnings_sent => 0,
        expiry_sent => 0
    };

    # A. Clean up old sessions (via Model encapsulation)
    $stats->{cleaned_sessions} = $c->db->cleanup_timer_sessions();
    
    # B. Update running timers
    $stats->{updated_timers} = $c->db->update_running_timers();
    
    # C. Send warning notifications
    my $warning_timers = $c->db->get_timers_needing_warning();
    foreach my $timer (@$warning_timers) {
        my $minutes_remaining = int($timer->{remaining_seconds} / 60);
        next if $minutes_remaining <= 0;
        
        if ($c->notify_templated($timer->{user_id}, 'timers_warning', { 
            name     => $timer->{name}, 
            category => $timer->{category}, 
            minutes  => $minutes_remaining 
        }, 0)) {
            $c->db->mark_warning_sent($timer->{timer_id});
            $stats->{warnings_sent}++;
        }
    }
    
    # D. Send expiry notifications
    my $expired_timers = $c->db->get_expired_timers();
    foreach my $timer (@$expired_timers) {
        # Notify User
        $c->notify_templated($timer->{user_id}, 'timers_expired_user', { 
            name     => $timer->{name}, 
            category => $timer->{category}, 
            limit    => $timer->{limit_minutes}, 
            usage    => int($timer->{elapsed_seconds} / 60) 
        }, 0);
        
        # Notify Admins
        my $admins = $c->db->get_admins();
        foreach my $admin (@$admins) {
            $c->notify_templated($admin->{id}, 'timers_expired_admin', { 
                name     => $timer->{name}, 
                category => $timer->{category}, 
                user     => $timer->{username}, 
                limit    => $timer->{limit_minutes}, 
                usage    => int($timer->{elapsed_seconds} / 60) 
            }, 0);
        }
        
        $c->db->mark_expired_sent($timer->{timer_id});
        $stats->{expiry_sent}++;
    }

    return $stats;
}

# Internal helper to handle impending calendar notifications.
# Parameters:
#   - now : DateTime object representing the current minute.
# Returns:
#   Stats HashRef { checked_time, notifications_sent, errors }
sub run_calendar_notifications {
    my ($c, $now) = @_;
    
    my $stats = {
        checked_time => $now->strftime('%H:%M'),
        notifications_sent => 0,
        errors => 0
    };

    # Select events that need notification within the next minute.
    # We use a 2-minute window (NOW to NOW + notification_minutes + 2) 
    # to catch up on any missed checks without double-firing (due to last_notified_at check).
    my $sql = qq{
        SELECT * FROM calendar_events 
        WHERE notification_minutes > 0 
        AND last_notified_at IS NULL
        AND start_date <= DATE_ADD(?, INTERVAL notification_minutes MINUTE)
        AND start_date > ?
    };
    
    my $query_now = $now->strftime('%Y-%m-%d %H:%M:%S');
    my $sth = $c->db->{dbh}->prepare($sql);
    $sth->execute($query_now, $query_now);
    
    my $events = $sth->fetchall_arrayref({});
    
    foreach my $event (@$events) {
        # 1. ATOMIC MARK: Update last_notified_at immediately
        $c->db->{dbh}->do("UPDATE calendar_events SET last_notified_at = NOW() WHERE id = ?", undef, $event->{id});
        
        # 2. RESOLVE RECIPIENTS & DATA
        my $attendee_ids = $event->{attendees} // '';
        next unless $attendee_ids;
        
        my @uids = split(',', $attendee_ids);
        my @attendee_names;
        foreach my $uid (map { trim($_) } @uids) {
            my $user = $c->db->get_user_by_id($uid);
            push @attendee_names, $user->{username} if $user;
        }
        my $attendees_str = join(', ', @attendee_names);
        
        my $formatted_start = $c->format_datetime($event->{start_date}, $event->{all_day});
        my $formatted_end   = $c->format_datetime($event->{end_date}, $event->{all_day});
        my $mins  = $event->{notification_minutes} // 0;
        my $d     = int($mins / 1440);
        my $h     = int(($mins % 1440) / 60);
        my $m     = $mins % 60;
        my @parts;
        push @parts, $d == 1 ? '1 day'    : "$d days"    if $d;
        push @parts, $h == 1 ? '1 hour'   : "$h hours"   if $h;
        push @parts, $m == 1 ? '1 minute' : "$m minutes" if $m;
        my $time_label = @parts ? join(' ', @parts) : '0 minutes';
        
        # 3. DISPATCH via Templated System
        foreach my $uid (map { trim($_) } @uids) {
            $c->notify_templated($uid, 'calendar_reminder', {
                title      => $event->{title},
                time_label => $time_label,
                start      => $formatted_start,
                end        => $formatted_end,
                attendees  => $attendees_str,
                id         => $event->{id},
                date       => substr($event->{start_date} // '', 0, 10)
            }, $event->{id});
        }

        $stats->{notifications_sent}++;
    }

    my $recurring = $c->db->get_due_recurring_reminders($query_now);

    foreach my $event (@$recurring) {
        my $attendee_ids = $event->{attendees} // '';
        next unless $attendee_ids;

        $c->db->{dbh}->do("UPDATE calendar_events SET last_notified_at = ? WHERE id = ?", undef, $event->{start_date}, $event->{id});

        my @uids = split(',', $attendee_ids);
        my @attendee_names;
        foreach my $uid (map { trim($_) } @uids) {
            my $user = $c->db->get_user_by_id($uid);
            push @attendee_names, $user->{username} if $user;
        }
        my $attendees_str = join(', ', @attendee_names);

        my $formatted_start = $c->format_datetime($event->{start_date}, $event->{all_day});
        my $formatted_end   = $c->format_datetime($event->{end_date},   $event->{all_day});
        my $mins  = $event->{notification_minutes} // 0;
        my $d     = int($mins / 1440);
        my $h     = int(($mins % 1440) / 60);
        my $m     = $mins % 60;
        my @parts;
        push @parts, $d == 1 ? '1 day'    : "$d days"    if $d;
        push @parts, $h == 1 ? '1 hour'   : "$h hours"   if $h;
        push @parts, $m == 1 ? '1 minute' : "$m minutes" if $m;
        my $time_label = @parts ? join(' ', @parts) : '0 minutes';

        foreach my $uid (map { trim($_) } @uids) {
            $c->notify_templated($uid, 'calendar_reminder', {
                title      => $event->{title},
                time_label => $time_label,
                start      => $formatted_start,
                end        => $formatted_end,
                attendees  => $attendees_str,
                id         => $event->{id},
                date       => substr($event->{start_date} // '', 0, 10)
            }, $event->{id});
        }

        $stats->{notifications_sent}++;
    }

    return $stats;
}

# Internal helper to handle asynchronous emoji prepending across all modules.
# Parameters: None
# Returns:
#   Stats HashRef { processed, ai_calls, dict_hits, fallback_hits }
# Behavior:
#   - Iterates supported tables (batch of 5 per table to prevent API rate limits).
#   - Skips texts that already begin with an Emoji sequence.
#   - Fallback 1: Isolated AI Dictionary (ai_emoji_dictionary).
#   - Fallback 2: Standard UI Dictionary (emojis).
#   - Fallback 3: Configured AI provider generation.
sub run_emoji_maintenance_p {
    my $c = shift;
    
    my $promise = Mojo::Promise->new;
    my $dict_hits = 0;

    # 1. Parent Process: Fetch unprocessed records and dictionary state
    my @targets = (
        { table => 'todo_list',       id_col => 'id', text_col => 'task_name' },
        { table => 'shopping_list',   id_col => 'id', text_col => 'item_name' },
        { table => 'calendar_events', id_col => 'id', text_col => 'title' },
        { table => 'reminders',       id_col => 'id', text_col => 'title' },
        { table => 'meals',           id_col => 'id', text_col => 'name' }
    );

    my @batch;
    foreach my $t (@targets) {
        my $records = $c->db->get_unprocessed_emojis($t->{table}, $t->{id_col}, $t->{text_col}, 10);
        foreach my $r (@$records) {
            my $raw_text = Mojo::Util::trim($r->{text_value} // '');
            next unless $raw_text;
            
            # Skip paragraphs/long blocks (Max 200 chars for emojis)
            if (length($raw_text) > 200) {
                $c->db->mark_emoji_processed($t->{table}, $t->{id_col}, $r->{id});
                next;
            }
            
            # Skip if already has emoji, but ensure we mark it as processed in DB
            if ($raw_text =~ /^\p{Extended_Pictographic}/) {
                $c->db->update_record_emoji($t->{table}, $t->{id_col}, $t->{text_col}, $r->{id}, $raw_text);
                $dict_hits++;
                next;
            }

            # Parent Check: Dictionary Lookups
            my $emoji = $c->db->check_ai_dictionary($raw_text) // $c->db->check_standard_dictionary($raw_text);
            
            if ($emoji) {
                # Immediate local update for cached hits
                my $updated_text = "$emoji $raw_text";
                $c->db->update_record_emoji($t->{table}, $t->{id_col}, $t->{text_col}, $r->{id}, $updated_text);
                $dict_hits++;
            } else {
                # Add to background batch for AI processing
                push @batch, { %$t, id => $r->{id}, text => $raw_text };
            }
        }
    }

    # If no background work needed, resolve early with dictionary stats
    unless (@batch) {
        return $promise->resolve({ processed => $dict_hits, ai_calls => 0, dict_hits => $dict_hits });
    }

    # 2. Subprocess: Handle heavy network/AI logic
    Mojo::IOLoop->subprocess(
        sub {
            my $subprocess = shift;
            my @results;
            my $ai_calls = 0;
            my $max_calls = 10; 

            foreach my $item (@batch) {
                last if $ai_calls >= $max_calls;
                $ai_calls++;

                my $ua = Mojo::UserAgent->new->request_timeout(10);
                my $data = eval {
                    my $emoji_profile = $c->db->get_ai_model_profile('emoji_lookup');
                    my $emoji_engine = $c->db->get_ai_engine($emoji_profile->{provider});
                    MyApp::Plugin::AI::ai_prompt_sync(
                        ua             => $ua,
                        provider       => $emoji_profile->{provider},
                        model          => $emoji_profile->{model},
                        engine         => $emoji_engine,
                        contents       => [ { role => 'user', parts => [ { text => "Reply with exactly one emoji for: $item->{text}" } ] } ],
                        temp           => 0.1,
                        max_tokens     => 2048,
                        timeout        => 10,
                        debug          => ($c->app->config->{debug} || 0)
                    );
                };

                if ($data) {
                    my $ai_response = Mojo::Util::trim($data->{candidates}[0]{content}{parts}[0]{text} // '');
                    $ai_response =~ s/^['"]+|['"]+$//g;
                    $ai_response = substr($ai_response, 0, 10) if length($ai_response) > 10;
                    if (length($ai_response) > 0 && $ai_response !~ /[a-zA-Z]{3,}/) {
                        push @results, { %$item, emoji => $ai_response };
                    }
                }
            }
            return { results => \@results, ai_calls => $ai_calls };
        },
        sub {
            my ($subprocess, $err, $data) = @_;
            if ($err) {
                $promise->reject($err);
                return;
            }

            # 3. Parent Process: Finalize DB updates
            my $ai_hits = 0;
            foreach my $res (@{$data->{results}}) {
                my $updated_text = "$res->{emoji} $res->{text}";
                $c->db->update_record_emoji($res->{table}, $res->{id_col}, $res->{text_col}, $res->{id}, $updated_text);
                $c->db->save_to_ai_dictionary($res->{text}, $res->{emoji});
                $ai_hits++;
            }
            
            $promise->resolve({ 
                processed => ($dict_hits + $ai_hits), 
                ai_calls  => $data->{ai_calls},
                dict_hits => $dict_hits,
                ai_hits   => $ai_hits
            });
        }
    );

    return $promise;
}

# Internal helper for daily normalization of whiteboard z-indices.
# Only performs work at 3:00 AM to avoid disrupting active users.
# Parameters:
#   - now : DateTime object representing the current execution minute.
# Returns: None
sub run_notes_znorm_maintenance {
    my ($self, $now) = @_;
    return unless $now && $now->hour == 3 && $now->minute == 0;
    my $rows = $self->db->normalize_note_z_indices();
    if ($rows > 0) {
        $self->app->log->info("Notes Maintenance: Normalized $rows z-index values across canvases.");
    }
}

# Internal helper for collaborative locking recovery: prunes abandoned note locks.
# Parameters: None
# Returns: None
sub run_notes_lock_maintenance {
    my ($self) = @_;
    $self->db->clear_expired_note_locks(5); # 5 minute threshold
}

# Internal helper to process all pending items in the notifications queue.
# Each item is retried up to 3 times with automated channel fallbacks.
# Parameters: None
# Returns: None
sub run_notification_queue {
    my ($c) = @_;

    # Recover orphaned rows left in 'processing' by a previous interrupted cycle
    $c->db->{dbh}->do(
        "UPDATE notifications_queue SET status = 'pending'
         WHERE status = 'processing'
         AND updated_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)"
    );

    $c->db->{dbh}->do(
        "DELETE FROM notifications_queue
         WHERE (status = 'sent'   AND updated_at < DATE_SUB(NOW(), INTERVAL 7 DAY))
            OR (status = 'failed' AND updated_at < DATE_SUB(NOW(), INTERVAL 30 DAY))"
    );

    my $pending = $c->db->get_pending_queue_items();
    return unless $pending && @$pending;

    for my $item (@$pending) {
        if ($item->{type} eq 'discord') {
            $c->_queue_attempt_discord($item);
        } elsif ($item->{type} eq 'email') {
            $c->_queue_attempt_email($item);
        }
    }
}

# Internal helper to prune expired login failure and lockout records.
# Parameters: None
# Returns: None
sub run_login_security_maintenance {
    my ($c) = @_;
    $c->db->prune_login_security();
}

# Attempts a Discord DM delivery for a single queue item.
sub _queue_attempt_discord {
    my ($c, $item) = @_;

    my $token = $c->db->get_discord_token();
    unless ($token) {
        $c->_handle_queue_failure($item, 'Bot token not configured');
        return;
    }

    my $api_base = 'https://discord.com/api/v10';
    my $headers  = { Authorization => "Bot $token", 'Content-Type' => 'application/json' };

    $c->app->ua->post_p(
        "$api_base/users/\@me/channels" => $headers => json => { recipient_id => "$item->{recipient}" }
    )->then(sub {
        my $tx = shift;
        my $res = $tx->result;
        die "open_dm HTTP " . $res->code . ": " . $res->body unless $res->is_success;
        my $channel_id = $res->json->{id} or die "no channel id in response";
        return $c->app->ua->post_p(
            "$api_base/channels/$channel_id/messages" => $headers => json => { content => $item->{message} }
        );
    })->then(sub {
        my $tx = shift;
        die "send_message HTTP " . $tx->result->code . ": " . $tx->result->body unless $tx->result->is_success;
        $c->db->mark_queue_item_sent($item->{id});
        $c->db->log_notification(
            user_id   => $item->{user_id},
            type      => 'discord',
            recipient => $item->{recipient},
            message   => $item->{message},
            status    => 'success'
        );
    })->catch(sub {
        $c->_handle_queue_failure($item, shift);
    });
}

# Attempts an email delivery for a single queue item.
sub _queue_attempt_email {
    my ($c, $item) = @_;

    my $settings = $c->db->get_email_settings();
    unless ($settings->{gmail_email} && $settings->{gmail_app_password}) {
        $c->_handle_queue_failure($item, 'Email credentials not configured');
        return;
    }

    Mojo::IOLoop->subprocess(
        sub {
            require Net::SMTP;
            my $smtp = Net::SMTP->new('smtp.gmail.com', Port => 587, Timeout => 30) or die $!;
            $smtp->starttls();
            $smtp->auth($settings->{gmail_email}, $settings->{gmail_app_password}) or die $smtp->message;
            (my $safe_from    = $settings->{gmail_email}) =~ s/[\r\n]//g;
            (my $safe_to      = $item->{recipient})        =~ s/[\r\n]//g;
            (my $safe_subject = $item->{subject} || 'Notification') =~ s/[\r\n]//g;
            $smtp->mail($safe_from);
            $smtp->to($safe_to);
            $smtp->data();
            $smtp->datasend("From: $safe_from\n");
            $smtp->datasend("To: $safe_to\n");
            $smtp->datasend("Subject: $safe_subject\n");
            $smtp->datasend("Content-Type: text/plain; charset=UTF-8\n\n");
            $smtp->datasend("$item->{message}\n");
            $smtp->dataend();
            $smtp->quit();
            return 1;
        },
        sub {
            my ($subprocess, @results) = @_;
            my $err = $subprocess->err;
            if ($err) {
                $c->_handle_queue_failure($item, $err);
            } else {
                $c->db->mark_queue_item_sent($item->{id});
                $c->db->log_notification(
                    user_id   => $item->{user_id},
                    type      => 'email',
                    recipient => $item->{recipient},
                    subject   => $item->{subject},
                    message   => $item->{message},
                    status    => 'success'
                );
            }
        }
    );
}

# Handles a failed delivery attempt for a queue item.
# Increments retry_count; on exhaustion escalates to email fallback or admin alert.
sub _handle_queue_failure {
    my ($c, $item, $err) = @_;
    $err //= 'unknown error';

    # Re-read from DB to get the authoritative count, avoiding stale in-memory snapshots.
    my ($current_count) = $c->db->{dbh}->selectrow_array(
        "SELECT retry_count FROM notifications_queue WHERE id = ?", undef, $item->{id}
    );
    $current_count //= $item->{retry_count};
    my $new_count = $current_count + 1;

    if ($new_count < 3) {
        $c->db->increment_queue_retry($item->{id}, "$err");
        $c->app->log->warn("Queue item $item->{id} ($item->{type}) retry $new_count/3: $err");
        return;
    }

    # Exhausted — mark failed
    $c->db->mark_queue_item_failed($item->{id}, "$err");
    $c->db->log_notification(
        user_id       => $item->{user_id},
        type          => $item->{type},
        recipient     => $item->{recipient},
        subject       => $item->{subject},
        message       => $item->{message},
        status        => 'failed',
        error_details => "gave up after 3 retries: $err"
    );
    $c->app->log->error("Queue item $item->{id} ($item->{type}) permanently failed: $err");

    # Discord exhausted — try email fallback
    if ($item->{type} eq 'discord' && $item->{user_id}) {
        my $user = $c->db->get_user_by_id($item->{user_id});
        if ($user && $user->{email}) {
            $c->db->enqueue_notification(
                user_id   => $item->{user_id},
                type      => 'email',
                recipient => $user->{email},
                subject   => 'Missed notification',
                message   => $item->{message},
            );
            return;
        }
    }

    # No fallback available — alert admins via direct email
    $c->_alert_admins_delivery_failed($item);
}

# Sends a best-effort direct email to all admin users when all delivery channels fail.
# Does not queue — avoids recursion.
sub _alert_admins_delivery_failed {
    my ($c, $item) = @_;

    my $settings = $c->db->get_email_settings();
    return unless $settings->{gmail_email} && $settings->{gmail_app_password};

    my $target = $item->{user_id}
        ? do { my $u = $c->db->get_user_by_id($item->{user_id}); $u ? $u->{username} : "user #$item->{user_id}" }
        : 'unknown user';

    my $alert = "Notification delivery failed for $target after all retries.\n\nMessage: $item->{message}";

    my $admins = $c->db->{dbh}->selectall_arrayref(
        "SELECT email FROM users WHERE is_admin = 1 AND email IS NOT NULL AND email != ''",
        { Slice => {} }
    );
    return unless $admins && @$admins;

    for my $admin (@$admins) {
        Mojo::IOLoop->subprocess(sub {
            require Net::SMTP;
            my $smtp = Net::SMTP->new('smtp.gmail.com', Port => 587, Timeout => 30) or die;
            $smtp->starttls();
            $smtp->auth($settings->{gmail_email}, $settings->{gmail_app_password}) or die $smtp->message;
            (my $safe_from  = $settings->{gmail_email}) =~ s/[\r\n]//g;
            (my $safe_to    = $admin->{email})           =~ s/[\r\n]//g;
            $smtp->mail($safe_from);
            $smtp->to($safe_to);
            $smtp->data();
            $smtp->datasend("From: $safe_from\n");
            $smtp->datasend("To: $safe_to\n");
            $smtp->datasend("Subject: Notification Delivery Failure\n");
            $smtp->datasend("Content-Type: text/plain; charset=UTF-8\n\n");
            $smtp->datasend("$alert\n");
            $smtp->dataend();
            $smtp->quit();
        }, sub {
            my ($subprocess, @results) = @_;
            my $err = $subprocess->err;
            $c->app->log->error("Admin alert email failed: $err") if $err;
        });
    }
}

# Internal helper to dispatch the daily brief notification to family users at 08:00.
# Parameters:
#   - now : DateTime object representing the current execution minute.
# Returns: None
sub run_brief_notification {
    my ($c, $now) = @_;
    return unless $now->hour == 8 && $now->minute == 0;

    # Idempotency: Ensure brief only fires once per day
    my $today = $now->strftime('%Y-%m-%d');
    return unless $c->db->try_set_brief_sent_date($today);

    $c->app->log->info("Brief: Dispatching daily overview to family.");

    for my $user (@{ $c->db->get_family_users() }) {
        # caller_id 0 indicates a system-originated notification
        $c->notify_templated($user->{id}, 'brief_daily', {}, 0);
    }
}

# Internal helper to notify users when Trakt watchlist episodes have aired.
# Queries trakt_upcoming for episodes with first_aired in the last 48 hours that
# have not yet been logged in trakt_episode_notifications, atomically inserts
# a row to prevent double-firing, then dispatches via notify_templated. Notification
# log rows older than 14 days are removed on each run.
#
# Parameters:
#   - now : DateTime object representing the current execution minute.
# Returns:
#   Stats HashRef { checked_time, cleanup_deleted, rows_found, notifications_sent, already_notified, errors }
sub run_trakt_episode_notifications {
    my ($c, $now) = @_;

    my $stats = {
        checked_time       => $now->strftime('%Y-%m-%d %H:%M'),
        cleanup_deleted    => 0,
        rows_found         => 0,
        notifications_sent => 0,
        already_notified   => 0,
        errors             => 0,
    };

    my $now_utc = $now->clone;
    $now_utc->set_time_zone('UTC');

    my $now_str          = $now_utc->strftime('%Y-%m-%d %H:%M:%S');
    my $cutoff           = $now_utc->clone()->subtract(hours => 48)->strftime('%Y-%m-%d %H:%M:%S');
    my $retention_cutoff = $now_utc->clone()->subtract(days => 14)->strftime('%Y-%m-%d %H:%M:%S');

    my $cleanup_rv = $c->db->{dbh}->do(
        "DELETE FROM trakt_episode_notifications WHERE notified_at < ?",
        undef,
        $retention_cutoff
    );
    $stats->{cleanup_deleted} = 0 + ($cleanup_rv || 0);

    my $sql = qq{
        SELECT u.user_id, u.episode_trakt_id, u.show_title, u.season, u.episode,
               u.title, u.first_aired, u.network
        FROM trakt_upcoming u
        WHERE u.first_aired <= ?
          AND u.first_aired >= ?
          AND u.episode_trakt_id IS NOT NULL
    };

    my $sth = $c->db->{dbh}->prepare($sql);
    $sth->execute($now_str, $cutoff);
    my $rows = $sth->fetchall_arrayref({});
    $stats->{rows_found} = scalar @$rows;

    foreach my $row (@$rows) {
        my $episode_label = sprintf("S%02dE%02d", $row->{season} // 0, $row->{episode} // 0);

        # 1. ATOMIC MARK: INSERT IGNORE to prevent double-firing.
        #    If the row already exists, affected_rows is 0 and we skip.
        my $rv = $c->db->{dbh}->do(
            "INSERT IGNORE INTO trakt_episode_notifications
             (user_id, episode_trakt_id, show_title, episode_label, title, first_aired, notified_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            undef,
            $row->{user_id},
            $row->{episode_trakt_id},
            $row->{show_title}   || '',
            $episode_label,
            $row->{title}        || '',
            $row->{first_aired},
            $now_str,
        );

        unless ($rv && $rv > 0) {
            $stats->{already_notified}++;
            next;
        }

        # 2. DISPATCH via Templated System
        eval {
            $c->notify_templated(
                $row->{user_id},
                'trakt_episode_airing',
                {
                    show_title    => $row->{show_title} || '',
                    episode_label => $episode_label,
                    title         => $row->{title}      || '',
                    network       => $row->{network}    || '',
                },
                0  # caller_id: system-originated notification
            );
        };
        if ($@) {
            $c->app->log->error("Trakt notification dispatch failed for user_id=$row->{user_id} episode_trakt_id=$row->{episode_trakt_id}: $@");
            $stats->{errors}++;
        } else {
            $stats->{notifications_sent}++;
        }
    }

    return $stats;
}

# Internal helper to remove expired UNO sessions: finished games (>1h), abandoned lobbies (>2h), and stale active games (>4h).
# Parameters: None
# Returns: None
sub cleanup_stale_uno_sessions {
    my ($self) = @_;
    $self->db->cleanup_stale_uno_sessions();
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{auth}->get('/api/fcm/web-config')->to('system#api_fcm_web_config');
    $r->{auth}->post('/api/fcm/register')->to('system#api_fcm_register');
    $r->{admin}->get('/admin/restart')->to('system#restart');
}

1;
