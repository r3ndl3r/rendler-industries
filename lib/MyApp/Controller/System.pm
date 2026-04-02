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

    my $admins = $c->db->get_admins() || [];

    for my $chore (@$stale_chores) {
        my $target_name = $chore->{target_user} // 'Everyone';
        my $msg = sprintf(
            "⏳ **Chore Reminder:** '%s' has been waiting for an hour! Grab the %d pts. (Assigned to: %s)",
            $chore->{title},
            $chore->{points} || 0,
            $target_name
        );

        if ($chore->{assigned_to}) {
            $c->notify_user($chore->{assigned_to}, $msg, "Pending Chore: $chore->{title}");
        } else {
            for my $admin (@$admins) {
                $c->notify_user($admin->{id}, $msg, "Pending Chore: $chore->{title}");
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
            
            # Find all family members with Discord IDs
            my $users = $c->db->get_family_users();
            foreach my $u (@$users) {
                # Target family/admins with Discord who have NOT suggested AND have NOT voted
                if ($u->{discord_id}) {
                    if (!$has_suggested{$u->{id}} && !$has_voted{$u->{id}}) {
                        my $msg = "🍳 MEAL PLANNER REMINDER 🍳\n\nYou haven't added a suggestion or voted for today's meal yet! Lock-in is at 2PM.\n\nhttps://rendler.org/meals";
                        $c->send_discord_dm($u->{discord_id}, $msg, $u->{id});
                    }
                }
            }
            push @{$stats->{actions}}, "Sent $hour:00 targeted reminders";
        }
    }

    # 2. Lock-in (Exactly 2 PM)
    if ($hour == 14 && $minute == 0) {
        my $today_plan = $c->db->get_active_plan(0)->[0]; # user_id=0 (system context)
        # Check status again - another worker might have already locked it
        if ($today_plan && $today_plan->{status} eq 'open') {
            my $suggestions = $today_plan->{suggestions};
            
            if (scalar @$suggestions > 0) {
                # Find winner (get_suggestions_for_day returns sorted by vote count)
                my $winner = $suggestions->[0];
                
                # Check for ties
                if (scalar @$suggestions > 1 && $suggestions->[0]{vote_count} == $suggestions->[1]{vote_count}) {
                    # Notify admin to decide (mark as locked status 'tie' or similar if we wanted, 
                    # but for now we rely on the fact that if status is still 'open' we keep notifying.
                    # To prevent tie-spamming within the same minute, we should check if we already notified.
                    # Let's just lock it to 'open' and rely on the minute check.
                    my $admin_msg = "⚖️ MEAL PLANNER TIE: Today's meal plan is TIED. Please go to /meals and pick a winner!\n\nhttps://rendler.org/meals";
                    my $admins = $c->db->get_admins();
                    foreach my $a (@$admins) {
                        $c->send_discord_dm($a->{discord_id}, $admin_msg, $a->{id}) if $a->{discord_id};
                    }
                    push @{$stats->{actions}}, "Notified admins of tie";
                } else {
                    # Auto-lock winner (This updates status to 'locked', stopping other workers)
                    $c->db->lock_suggestion($today_plan->{id}, $winner->{id});
                    
                    # Notify everyone of the final choice
                    my $announcement = "🍽️ TODAY'S MENU LOCKED: $winner->{meal_name} wins with $winner->{vote_count} votes! (Suggested by $winner->{suggested_by_name})\n\nhttps://rendler.org/meals";
                    my $users = $c->db->get_family_users();
                    foreach my $u (@$users) {
                        if ($u->{discord_id}) {
                            $c->send_discord_dm($u->{discord_id}, $announcement, $u->{id});
                        }
                    }
                    push @{$stats->{actions}}, "Locked in: $winner->{meal_name}";
                }
            } else {
                # No suggestions at 2PM? Notify admin
                my $admin_msg = "⚠️ MEAL PLANNER EMPTY: No suggestions made by 2PM. Please set a blackout or manual meal.\n\nhttps://rendler.org/meals";
                my $admins = $c->db->get_admins();
                foreach my $a (@$admins) {
                    $c->send_discord_dm($a->{discord_id}, $admin_msg, $a->{id}) if $a->{discord_id};
                }
                push @{$stats->{actions}}, "Notified admins of empty plan";
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
        
        my $msg = "🧹 **ROOM CLEANING REMINDER** 🧹\n\nIt's time to clean your room and upload photos for review!";
        
        if (@$comments) {
            $msg .= "\n\n⚠️ **Items to fix from your previous upload:**\n";
            foreach my $comment (@$comments) {
                $msg .= " - $comment\n";
            }
        }
        
        $msg .= "\n\nUpload: https://rendler.org/room";
        
        # Mark as sent FIRST to prevent double-firing across workers
        $c->db->update_room_reminder_sent($r->{user_id});
        
        if ($c->notify_user($r->{user_id}, $msg, "Room Cleaning Reminder")) {
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

            my $msg = "🔔 REMINDER 🔔\n\n$r->{title}\n\n$r->{description}\n\nhttps://rendler.org/reminders";
            if ($c->notify_user($r->{user_id}, $msg, "Reminder: $r->{title}")) {
                $stats->{notified}++;
            } else {
                $stats->{errors}++;
            }
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
        
        my $subject = "Timer Warning: $timer->{name} ($timer->{category})";
        my $message = "⏱️ **TIMER WARNING: $timer->{name}** ⏱️\n\n"
                    . "Your session for **$timer->{name}** ($timer->{category}) is running low on time.\n\n"
                    . "**Time Remaining:** $minutes_remaining minutes\n\n"
                    . "Please wrap up your current activity soon.\n"
                    . "https://rendler.org/timers";
        
        if ($c->notify_user($timer->{user_id}, $message, $subject)) {
            $c->db->mark_warning_sent($timer->{timer_id});
            $stats->{warnings_sent}++;
        }
    }
    
    # D. Send expiry notifications
    my $expired_timers = $c->db->get_expired_timers();
    foreach my $timer (@$expired_timers) {
        my $subject = "Timer Expired: $timer->{name} ($timer->{category})";
        my $user_msg = "🚨 **TIMER EXPIRED: $timer->{name}** 🚨\n\n"
                     . "Your session for **$timer->{name}** ($timer->{category}) has expired.\n\n"
                     . "**Daily Limit:** $timer->{limit_minutes} minutes\n"
                     . "**Usage Today:** " . int($timer->{elapsed_seconds} / 60) . " minutes\n\n"
                     . "Please stop using this device immediately.\n"
                     . "https://rendler.org/timers";
        
        # Notify User
        $c->notify_user($timer->{user_id}, $user_msg, $subject);
        
        # Notify Admins
        my $admin_msg = "🚨 **TIMER EXPIRED: $timer->{name}** 🚨\n\n"
                      . "The timer **$timer->{name}** ($timer->{category}) for **$timer->{username}** has reached its daily limit and expired.\n\n"
                      . "**Limit:** $timer->{limit_minutes} minutes\n"
                      . "**Usage:** " . int($timer->{elapsed_seconds} / 60) . " minutes\n\n"
                      . "Manage: https://rendler.org/timers/manage";
        
        my $admins = $c->db->get_admins();
        foreach my $admin (@$admins) {
            $c->notify_user($admin->{id}, $admin_msg, "Admin Alert: $timer->{username} Timer Expired");
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
        
        my $channels = $event->{notification_channels} // 'email';
        my $formatted_start = $c->format_datetime($event->{start_date}, $event->{all_day});
        my $formatted_end   = $c->format_datetime($event->{end_date}, $event->{all_day});
        my $time_label      = $event->{notification_minutes} == 60 ? "1 hour" : "$event->{notification_minutes} minutes";
        
        # --- Channel Specific Formatting ---
        
        # A. EMAIL FORMAT (Full Fidelity)
        my $email_subject = "🔔 Upcoming Event Reminder: $event->{title} 🔔\n";
        my $email_body = qq{🔔 Upcoming Event Reminder 🔔
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The following event is starting in $time_label:

Title: $event->{title}};
        $email_body .= "\nDescription: $event->{description}" if $event->{description};
        $email_body .= qq{

Start: $formatted_start
End: $formatted_end};
        $email_body .= "\nCategory: $event->{category}" if $event->{category};
        $email_body .= "\n\nAttendees: $attendees_str" if $attendees_str;
        $email_body .= qq{

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
View Calendar: https://rendler.org/calendar};

        # B. DISCORD FORMAT (Markdown Enhanced)
        my $discord_msg = qq{🔔 **Upcoming Event Reminder** 🔔
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**$event->{title}** is starting in **$time_label**!};
        $discord_msg .= "\n\n> $event->{description}" if $event->{description};
        $discord_msg .= "\n\n📅 **Start:** $formatted_start";
        $discord_msg .= "\n📍 **Category:** $event->{category}" if $event->{category};
        $discord_msg .= "\n\n👥 **Attendees:** $attendees_str" if $attendees_str;
        $discord_msg .= "\n\n🔗 https://rendler.org/calendar";

        # C. PUSH FORMAT (Mobile Optimized - Gotify/Pushover)
        my $push_msg = qq{🔔 **Upcoming Event Reminder** 🔔
━━━━━━━━━━━━━━━━━━━━━━━

$event->{title} starts in $time_label!

Start: $formatted_start

};
        $push_msg .= "\nCategory: $event->{category}" if $event->{category};
        $push_msg .= "\nAttendees: $attendees_str" if $attendees_str;

        # 3. DISPATCH
        foreach my $uid (map { trim($_) } @uids) {
            my $user = $c->db->get_user_by_id($uid);
            next unless $user;
            
            # Email
            if ($channels =~ /email/) {
                $c->send_email_via_gmail([$user->{email}], $email_subject, $email_body, $user->{id}) if $user->{email};
            }
            
            # Discord
            if ($channels =~ /discord/) {
                if ($user->{discord_id}) {
                    $c->send_discord_dm($user->{discord_id}, $discord_msg, $user->{id});
                } elsif ($user->{email} && $channels !~ /email/) {
                    # Fallback to email if discord_id is missing
                    $c->send_email_via_gmail([$user->{email}], "[Discord Fallback] $email_subject", $email_body, $user->{id});
                }
            }
        }
        
        # 4. ADMIN CHANNELS
        $c->push_pushover($push_msg) if $channels =~ /pushover/;
        $c->push_gotify($push_msg, $email_subject) if $channels =~ /gotify/;
        
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

1;
