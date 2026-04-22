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

# Stores a device FCM token for the currently logged-in user.
# Route: POST /api/fcm/register
# Parameters:
#   token : FCM registration token string from the Capacitor plugin.
# Returns: JSON object { success }
sub api_fcm_register {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $token = trim($c->param('token') // '');
    return $c->render(json => { success => 0, error => 'Token required' }) unless $token;

    my $user_id = $c->current_user_id;
    eval { $c->db->save_fcm_token($user_id, $token) };
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

# Automatically reminds users of chores pending for > 60 minutes.
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

# Internal helper to handle meal planner automation (Lock-in at 2PM, Reminders at 8AM/12PM).
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
                attendees  => $attendees_str
            }, 0); # caller_id 0 for system
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
#   - Fallback 3: Google Gemini API generation.
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

                # We call the helper via the controller instance passed into the subprocess
                # or replicate the logic if the instance is not safely shared.
                # In Mojo subprocesses, we should use a fresh UA and the logic from the plugin.
                my $api_key = $c->db->get_gemini_key();
                my $active_model = $c->db->get_gemini_active_model();
                my $api_version = ($active_model =~ /preview|exp|2\.[05]|3\./) ? 'v1beta' : 'v1';
                my $endpoint = "https://generativelanguage.googleapis.com/$api_version/models/$active_model:generateContent?key=$api_key";

                my $ua = Mojo::UserAgent->new->request_timeout(10);
                my $tx = $ua->post($endpoint => json => {
                    contents => [ { role => 'user', parts => [ { text => $item->{text} } ] } ],
                    system_instruction => { parts => [ { text => "Respond ONLY with one emoji character." } ] },
                    generationConfig => { temperature => 0.1, maxOutputTokens => 5 }
                });

                if (my $res = $tx->result) {
                    if ($res->is_success) {
                        my $ai_response = Mojo::Util::trim($res->json->{candidates}[0]{content}{parts}[0]{text} // '');
                        $ai_response =~ s/^['"]+|['"]+$//g;
                        # Truncate AI response to prevent log bloat if it returns a paragraph
                        $ai_response = substr($ai_response, 0, 10) if length($ai_response) > 10;
                        if (length($ai_response) > 0 && $ai_response !~ /[a-zA-Z]{3,}/) {
                            push @results, { %$item, emoji => $ai_response };
                        }
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

# Maintenance: Daily normalization of whiteboard z-indices.
sub run_notes_znorm_maintenance {
    my $self = shift;
    my $rows = $self->db->normalize_note_z_indices();
    if ($rows > 0) {
        $self->app->log->info("Notes Maintenance: Normalized $rows z-index values across canvases.");
    }
}

# Collaborative Locking Recovery: Prunes abandoned note locks.
sub run_notes_lock_maintenance {
    my ($self) = @_;
    $self->db->clear_expired_note_locks(5); # 5 minute threshold
}

# Processes all pending items in the notifications_queue.
# Each item is retried up to 3 times. On discord exhaustion, an email fallback
# is enqueued if the user has an email address. If all channels are exhausted,
# a best-effort direct email alert is sent to all admin users.
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

1;
