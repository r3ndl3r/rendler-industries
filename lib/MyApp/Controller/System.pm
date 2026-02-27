# /lib/MyApp/Controller/System.pm

package MyApp::Controller::System;
use Mojo::Base 'Mojolicious::Controller';

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
        if ($today_plan && $today_plan->{status} eq 'open') {
            my $participation = $c->db->get_plan_participation($today_plan->{id});
            my %has_suggested = map { $_ => 1 } @{$participation->{suggested_ids}};
            my %has_voted     = map { $_ => 1 } @{$participation->{voted_ids}};
            
            # Find all family members with Discord IDs
            my $users = $c->db->get_all_users();
            foreach my $u (@$users) {
                # Target family/admins with Discord who have NOT suggested AND have NOT voted
                if ($u->{discord_id} && ($u->{is_family} || $u->{is_admin})) {
                    if (!$has_suggested{$u->{id}} && !$has_voted{$u->{id}}) {
                        my $msg = "🍳 MEAL PLANNER REMINDER: You haven't added a suggestion or voted for today's meal yet! Lock-in is at 2PM.\n\nhttps://rendler.org/meals";
                        $c->send_discord_dm($u->{discord_id}, $msg);
                    }
                }
            }
            push @{$stats->{actions}}, "Sent $hour:00 targeted reminders";
        }
    }

    # 2. Lock-in (Exactly 2 PM)
    if ($hour == 14 && $minute == 0) {
        my $today_plan = $c->db->get_active_plan(0)->[0]; # user_id=0 (system context)
        if ($today_plan && $today_plan->{status} eq 'open') {
            my $suggestions = $today_plan->{suggestions};
            
            if (scalar @$suggestions > 0) {
                # Find winner (get_suggestions_for_day returns sorted by vote count)
                my $winner = $suggestions->[0];
                
                # Check for ties
                if (scalar @$suggestions > 1 && $suggestions->[0]{vote_count} == $suggestions->[1]{vote_count}) {
                    # Notify admin to decide
                    my $admin_msg = "⚖️ MEAL PLANNER TIE: Today's meal plan is TIED. Please go to /meals and pick a winner!\n\nhttps://rendler.org/meals";
                    my $admins = $c->db->get_all_users();
                    foreach my $a (grep { $_->{is_admin} } @$admins) {
                        $c->send_discord_dm($a->{discord_id}, $admin_msg) if $a->{discord_id};
                    }
                    push @{$stats->{actions}}, "Notified admins of tie";
                } else {
                    # Auto-lock winner
                    $c->db->lock_suggestion($today_plan->{id}, $winner->{id});
                    
                    # Notify everyone of the final choice
                    my $announcement = "🍽️ TODAY'S MENU LOCKED: $winner->{meal_name} wins with $winner->{vote_count} votes! (Suggested by $winner->{suggested_by_name})\n\nhttps://rendler.org/meals";
                    my $users = $c->db->get_all_users();
                    foreach my $u (@$users) {
                        if ($u->{discord_id} && ($u->{is_family} || $u->{is_admin})) {
                            $c->send_discord_dm($u->{discord_id}, $announcement);
                        }
                    }
                    push @{$stats->{actions}}, "Locked in: $winner->{meal_name}";
                }
            } else {
                # No suggestions at 2PM? Notify admin to blackout or decide
                my $admin_msg = "⚠️ MEAL PLANNER EMPTY: No suggestions made by 2PM. Please set a blackout or manual meal.\n\nhttps://rendler.org/meals";
                my $admins = $c->db->get_all_users();
                foreach my $a (grep { $_->{is_admin} } @$admins) {
                    $c->send_discord_dm($a->{discord_id}, $admin_msg) if $a->{discord_id};
                }
                push @{$stats->{actions}}, "Notified admins of empty plan";
            }
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
        my $msg = "🔔 REMINDER: $r->{title}\n\n$r->{description}\n\nhttps://rendler.org/reminders";
        
        # Dispatch notification using standardized helper
        if ($c->notify_user($r->{user_id}, $msg, "Reminder: $r->{title}")) {
            $stats->{notified}++;
            
            # Mark as sent for today if not already done
            unless ($processed_reminder_ids{$r->{id}}) {
                if ($r->{is_one_off}) {
                    $c->db->delete_reminder($r->{id});
                } else {
                    $c->db->mark_reminder_sent($r->{id});
                }
                $processed_reminder_ids{$r->{id}} = 1;
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

    # A. Clean up old sessions
    my $today = $c->db->_get_current_date();
    my $sql = "DELETE FROM timer_sessions WHERE session_date < ?";
    $stats->{cleaned_sessions} = $c->db->{dbh}->do($sql, undef, $today) || 0;
    
    # B. Update running timers
    $stats->{updated_timers} = $c->db->update_running_timers();
    
    # C. Send warning emails
    my $warning_timers = $c->db->get_timers_needing_warning();
    foreach my $timer (@$warning_timers) {
        my $minutes_remaining = int($timer->{remaining_seconds} / 60);
        next if $minutes_remaining <= 0;
        
        my $email_subject = "Timer Warning: $timer->{name} ($timer->{category})";
        my $email_body = qq{Hello $timer->{username},

Your timer "$timer->{name}" ($timer->{category}) is running low on time.

Time Remaining: $minutes_remaining minutes

Please wrap up your current activity soon.

https://rendler.org/timers

- Rendler Industries Timer System};
        
        if ($c->send_email_via_gmail([$timer->{email}], $email_subject, $email_body)) {
            $c->db->mark_warning_sent($timer->{timer_id});
            $stats->{warnings_sent}++;
        }
    }
    
    # D. Send expiry notifications
    my $expired_timers = $c->db->get_expired_timers();
    foreach my $timer (@$expired_timers) {
        my $email_subject = "Timer Expired: $timer->{name} ($timer->{category})";
        my $email_body = qq{Hello $timer->{username},

Your timer "$timer->{name}" ($timer->{category}) has expired.

Daily Limit: $timer->{limit_minutes} minutes
Usage Today: } . int($timer->{elapsed_seconds} / 60) . qq{ minutes

Please stop using this device immediately.

https://rendler.org/timers

- Rendler Industries Timer System};
        
        my $all_users = $c->db->get_all_users();
        my @admin_emails = map { $_->{email} } grep { $_->{is_admin} && $_->{email} } @$all_users;
        my @recipients = ($timer->{email}, @admin_emails);
        
        if ($c->send_email_via_gmail(\@recipients, $email_subject, $email_body)) {
            $c->db->mark_expired_sent($timer->{timer_id});
            $stats->{expiry_sent}++;
        }
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
sub run_emoji_maintenance {
    my $c = shift;
    
    my $stats = { processed => 0, ai_calls => 0, dict_hits => 0, fallback_hits => 0 };
    
    # Exact mappings verified against MariaDB schema
    my @targets = (
        { table => 'todo_list',       id_col => 'id', text_col => 'task_name' },
        { table => 'shopping_list',   id_col => 'id', text_col => 'item_name' },
        { table => 'calendar_events', id_col => 'id', text_col => 'title' },
        { table => 'reminders',       id_col => 'id', text_col => 'title' },
        { table => 'meals',           id_col => 'id', text_col => 'name' }
    );

    # Initialize Gemini API configuration
    my $ua = Mojo::UserAgent->new;
    my $api_key = $c->db->get_gemini_key();
    
    my $active_model = $c->db->get_gemini_active_model() // 'gemini-2.5-flash'; 

    my $endpoint = "https://generativelanguage.googleapis.com/v1beta/models/$active_model:generateContent?key=$api_key";

    # Enforce strictly 1 character
    my $sys_prompt = "You are a text-to-emoji converter. Respond ONLY with a single emoji character. Do not provide punctuation, quotes, words, or explanations. Just the emoji.";

    # Limit total AI calls per cycle to prevent rate limiting/costs
    my $max_ai_calls_per_cycle = 10;
    my $ai_calls_this_cycle = 0;

    foreach my $t (@targets) {
        my $records = $c->db->get_unprocessed_emojis($t->{table}, $t->{id_col}, $t->{text_col}, 5);
        
        foreach my $row (@$records) {
            my $raw_text = Mojo::Util::trim($row->{text_value} // '');
            
            unless ($raw_text) {
                $c->db->mark_emoji_processed($t->{table}, $t->{id_col}, $row->{id});
                next;
            }
            
            # Skip strings that already start with typical emoji ranges or Unicode pictographs
            if ($raw_text =~ /^\p{Extended_Pictographic}/) {
                $c->db->mark_emoji_processed($t->{table}, $t->{id_col}, $row->{id});
                $stats->{processed}++;
                next;
            }

            my $emoji;
            my $api_failed = 0;

            # 1. Check Isolated AI Dictionary
            $emoji = $c->db->check_ai_dictionary($raw_text);
            
            if ($emoji) {
                $stats->{dict_hits}++;
            } else {
                # 2. Check Standard UI Dictionary
                $emoji = $c->db->check_standard_dictionary($raw_text);
                
                if ($emoji) {
                    $stats->{fallback_hits}++;
                } elsif ($ai_calls_this_cycle < $max_ai_calls_per_cycle) {
                    # 3. Fallback to AI Generation
                    $ai_calls_this_cycle++;
                    
                    my $tx = $ua->post($endpoint => json => {
                        contents => [ { role => 'user', parts => [ { text => $raw_text } ] } ],
                        system_instruction => { parts => [ { text => $sys_prompt } ] },
                        generationConfig => { temperature => 0.1, maxOutputTokens => 5 }
                    });

                    if (my $res = $tx->result) {
                        if ($res->is_success) {
                            my $data = $res->json;
                            if ($data->{candidates} && $data->{candidates}[0]{content}{parts}[0]{text}) {
                                my $ai_response = Mojo::Util::trim($data->{candidates}[0]{content}{parts}[0]{text});
                                
                                # Strip accidental quotes or punctuation from AI response
                                $ai_response =~ s/^['"]+|['"]+$//g;
                                $ai_response = Mojo::Util::trim($ai_response);
                                
                                # If it's a short response and isn't clearly a word/sentence, accept it.
                                if (length($ai_response) > 0 && $ai_response !~ /[a-zA-Z]{3,}/) {
                                    $emoji = $ai_response;
                                    $c->db->save_to_ai_dictionary($raw_text, $emoji);
                                    $stats->{ai_calls}++;
                                } else {
                                    $c->app->log->warn("AI returned invalid emoji for '$raw_text': $ai_response");
                                    $api_failed = 1; # Determined invalid, don't retry immediately
                                }
                            }
                        } else {
                            $c->app->log->warn("API Error for '$raw_text': " . $res->message . " | " . $res->body);
                            $api_failed = 1; # Transient failure
                        }
                    } else {
                        $api_failed = 1; # Connection failure
                    }
                }
            }

            # Apply the update
            if ($emoji) {
                my $updated_text = "$emoji $raw_text";
                $c->db->update_record_emoji($t->{table}, $t->{id_col}, $t->{text_col}, $row->{id}, $updated_text);
                $stats->{processed}++;
            } elsif (!$api_failed) {
                # Only mark as processed if we actually checked it (dictionary hit or non-transient empty)
                # If the API failed, we LEAVE it has_emoji=0 so it retries next cycle.
                
                # If we skipped AI because of rate limit, just continue to next record
                next if $ai_calls_this_cycle >= $max_ai_calls_per_cycle && !$emoji;

                # If we checked dictionaries and found nothing, and AI was either skipped or returned nothing definitively
                $c->db->mark_emoji_processed($t->{table}, $t->{id_col}, $row->{id});
                $stats->{processed}++;
            }
        }
    }

    return $stats;
}

1;
