# /lib/MyApp/Plugin/Notifications.pm

package MyApp::Plugin::Notifications;

use Mojo::Base 'Mojolicious::Plugin';
use Mojo::Util qw(b64_encode trim);
use Encode qw(encode);
use strict;
use warnings;

# Unified Notification System Plugin.
# Consolidates all outbound communication channels:
# - Discord Direct Messages (via Bobbot)
# - Email via Gmail SMTP (TLS)
# - Pushover Mobile Alerts
# - Gotify Self-hosted Push
#
# Integration points:
# - Registers high-level helpers in the Mojolicious app.
# - Depends on credentials stored in respective DB tables.
# - Provides both server-file logging and DB audit tracking.

# Centralized Contract Manifest: Defines every template key the application may dispatch.
# Synchronizes the contract manifest with the database; preserves user-customized content.
use constant MANIFEST => {
    # --- CHORES (chore_*) ---
    'chore_complete' => {
        desc    => "Sent to admins when a child finishes a chore.",
        tags    => "user, icon, task, points",
        sample  => { user => "Alex", icon => "👤", task => "Vacuuming", points => 50 },
        default_subject => "Chore Completed by [user]",
        default_body    => "✨ **Chore Completed** ✨\n\n[icon] **[user]** finished: [task] (+[points] pts)\n\n[sys_url]"
    },
    'chore_assigned' => {
        desc    => "Sent to a user when a specific chore is assigned to them.",
        tags    => "user, icon, task, points",
        sample  => { user => "Alex", icon => "👤", task => "Laundry", points => 30 },
        default_subject => "New Chore Assigned",
        default_body    => "✨ **New Chore** ✨\n\n[icon] **[user]**, a new chore is on your board!\n\n**[task]** (+[points] pts)\n\n[sys_url]"
    },
    'chore_global_available' => {
        desc    => "Sent to all children when a global bounty is posted.",
        tags    => "task, points",
        sample  => { task => "Mow Lawn", points => 100 },
        default_subject => "New Global Chore Available",
        default_body    => "✨ **New Chore** ✨\n\n🌍 **GLOBAL CHORE** 🌍\n\n[task] (+[points] pts)\n\n*First to finish and mark as done gets the points!*\n\n[sys_url]"
    },
    'chore_revoked' => {
        desc    => "Sent to a user when their work is revoked and points docked.",
        tags    => "icon, task, points",
        sample  => { icon => "👤", task => "Dishes", points => 20 },
        default_subject => "Work Revoked",
        default_body    => "✨ **Work Revoked** ✨\n\n[icon] **POINT DEDUCTION** [icon]\n\nYour completion of **[task]** has been revoked.\n\n**Adjustment: (-[points] pts)**\n\n[sys_url]"
    },
    'chore_removed' => {
        desc    => "Sent when an assigned chore is deleted by an admin.",
        tags    => "icon, task",
        sample  => { icon => "👤", task => "Clean Windows" },
        default_subject => "Chore Removed",
        default_body    => "✨ **Chore Removed** ✨\n\n[icon] **CHORE DELETED** [icon]\n\n**[task]** is no longer on the board.\n\n[sys_url]"
    },
    'chore_new_linked' => {
        desc    => "Sent when a reminder triggers an automatic chore creation.",
        tags    => "user, icon, task, points",
        sample  => { user => "Alex", icon => "👤", task => "Take Out Trash", points => 10 },
        default_subject => "New Chore: [task]",
        default_body    => "📋 **New Chore Linked:** [icon] **[user]**, '[task]' is now on your board for [points] pts!"
    },
    'chore_stale_reminder' => {
        desc    => "Sent when a chore has been pending for an hour without completion.",
        tags    => "icon, task, points, target",
        sample  => { icon => "🌍", task => "Mow Lawn", points => 100, target => "Everyone" },
        default_subject => "Pending Chore: [task]",
        default_body    => "[icon] **Chore Reminder:** '[task]' has been waiting for an hour!\n\nGrab the [points] pts.\n\n(Assigned to: [target])"
    },

    # --- MEALS (meals_*) ---
    'meals_reminder' => {
        desc    => "8AM/12PM daily reminder to vote for tonight's meal.",
        tags    => "user, deadline",
        sample  => { user => "Dad", deadline => "2:00 PM" },
        default_subject => "Meal Planner Reminder",
        default_body    => "🍳 MEAL PLANNER REMINDER 🍳\n\n[user], you haven't added a suggestion or voted for today's meal yet! Lock-in is at [deadline].\n\n[sys_url]"
    },
    'meals_new_suggestion' => {
        desc    => "Sent to family members when a new meal is suggested.",
        tags    => "user, meal, day",
        sample  => { user => "Mom", meal => "Pizza", day => "Friday" },
        default_subject => "New Meal Suggestion",
        default_body    => "🍳 **MEAL SUGGESTION** 🍳\n\n**[user]** suggested: **[meal]** for [day]!\n\n[sys_url /meals]"
    },
    'meals_tie' => {
        desc    => "Sent to admins when meal voting results in a tie at 2PM.",
        tags    => "",
        sample  => {},
        default_subject => "Meal Planner Tie",
        default_body    => "⚖️ MEAL PLANNER TIE: Today's meal plan is TIED. Please go to [sys_url /meals] and pick a winner!"
    },
    'meals_locked_in' => {
        desc    => "Announcement to all family members of the winning meal at 2PM.",
        tags    => "meal_name, vote_count, suggested_by",
        sample  => { meal_name => "Tacos", vote_count => 3, suggested_by => "Mom" },
        default_subject => "Today's Menu Locked",
        default_body    => "🍽️ TODAY'S MENU LOCKED: [meal_name] wins with [vote_count] votes! (Suggested by [suggested_by])\n\n[sys_url /meals]"
    },
    'meals_empty' => {
        desc    => "Sent to family if no suggestions are made by 2PM lock-in.",
        tags    => "",
        sample  => {},
        default_subject => "Meal Planner Empty",
        default_body    => "⚠️ MEAL PLANNER EMPTY: No suggestions made by 2PM. Please set a blackout or manual meal.\n\n[sys_url /meals]"
    },

    # --- USERS (user_*) ---
    'user_welcome' => {
        desc    => "Sent to newly approved users.",
        tags    => "user",
        sample  => { user => "Alex" },
        default_subject => "Welcome to Rendler Industries",
        default_body    => "Hello [user],\n\nYour account has been approved!\n\nLog in: [sys_url /login]\n\n- Rendler Industries®"
    },

    # --- CALENDAR (calendar_*) ---
    'calendar_reminder' => {
        desc    => "Upcoming event reminder.",
        tags    => "title, time_label, start, end, attendees",
        sample  => { title => "Family Dinner", time_label => "1 hour", start => "18:00", end => "20:00", attendees => "Everyone" },
        default_subject => "Upcoming Event: [title]",
        default_body    => "🔔 **UPCOMING EVENT** 🔔\n\n**[title]** is starting in [time_label]!\n\n📅 **Start:** [start]\n🏁 **End:** [end]\n👥 **Attendees:** [attendees]\n\n[sys_url /calendar]"
    },

    # --- TIMERS (timers_*) ---
    'timers_warning' => {
        desc    => "Sent when a timer is running low on time.",
        tags    => "name, category, minutes",
        sample  => { name => "iPad", category => "Gaming", minutes => 5 },
        default_subject => "Timer Warning: [name] ([category])",
        default_body    => "⏱️ **TIMER WARNING: [name]** ⏱️\n\nYour session for **[name]** ([category]) is running low on time.\n\n**Time Remaining:** [minutes] minutes\n\nPlease wrap up your current activity soon.\n[sys_url]"
    },
    'timers_expired_user' => {
        desc    => "Sent to a user when their timer reaches the daily limit.",
        tags    => "name, category, limit, usage",
        sample  => { name => "PC", category => "Entertainment", limit => 120, usage => 120 },
        default_subject => "Timer Expired: [name] ([category])",
        default_body    => "🚨 **TIMER EXPIRED: [name]** 🚨\n\nYour session for **[name]** ([category]) has expired.\n\n**Daily Limit:** [limit] minutes\n\n**Usage Today:** [usage] minutes\n\nPlease stop using this device immediately.\n[sys_url]"
    },
    'timers_expired_admin' => {
        desc    => "Sent to admins when a user's timer expires.",
        tags    => "name, category, user, limit, usage",
        sample  => { name => "PC", category => "Entertainment", user => "Alex", limit => 120, usage => 120 },
        default_subject => "Admin Alert: [user] Timer Expired",
        default_body    => "🚨 **TIMER EXPIRED: [name]** 🚨\n\nThe timer **[name]** ([category]) for **[user]** has reached its daily limit and expired.\n\n**Limit:** [limit] minutes\n\n**Usage:** [usage] minutes\n\nManage: [sys_url /timers/manage]"
    },
    'timers_points_redeemed' => {
        desc    => "Sent to admins when a child redeems points for more time.",
        tags    => "user, points, minutes, timer_name",
        sample  => { user => "Alex", points => 500, minutes => 30, timer_name => "PC" },
        default_subject => "Points Redeemed: [user]",
        default_body    => "🪙 **Points Redeemed** 🪙\n\n**[user]** just spent **[points] points** for **[minutes] minutes** of time on **[timer_name]**.\n\nManage: [sys_url /timers/manage]"
    },

    # --- ROOM (room_*) ---
    'room_reminder' => {
        desc    => "Recurring reminder for children to clean their room and upload photos.",
        tags    => "comments",
        sample  => { comments => "\n\n⚠️ **Items to fix from your previous upload:**\n - Pick up clothes" },
        default_subject => "Room Cleaning Reminder",
        default_body    => "🧹 **ROOM CLEANING REMINDER** 🧹\n\nIt's time to clean your room and upload photos for review![comments]\n\nUpload: [sys_url /room]"
    },
    'room_review_needed' => {
        desc    => "Sent to admins when a child uploads new room photos.",
        tags    => "user",
        sample  => { user => "Alex" },
        default_subject => "Room Review Needed",
        default_body    => "🧹 **New Room Submission** 🧹\n\n**[user]** has uploaded photos for today's room check.\n\nReview: [sys_url /room]"
    },
    'room_feedback' => {
        desc    => "Consolidated feedback report sent to child after admin review.",
        tags    => "date, feedback",
        sample  => { date => "15-04-2026", feedback => "✅ **Bed**: Passed\n❌ **Desk**: Failed\n> Feedback: Clear off the papers." },
        default_subject => "Room Feedback: [date]",
        default_body    => "🧹 **Room Feedback for [date]** 🧹\n\n[feedback]\n\nView: [sys_url /room]"
    },

    # --- GENERAL ---
    'reminder_alert' => {
        desc    => "Standard alert for user-created reminders.",
        tags    => "title, description",
        sample  => { title => "Take Medicine", description => "Blue pill after dinner" },
        default_subject => "Reminder: [title]",
        default_body    => "🔔 REMINDER 🔔\n\n[title]\n\n[description]\n\n[sys_url /reminders]"
    },
    'points_adjustment' => {
        desc    => "Sent to children when their point balance is manually updated.",
        tags    => "header, amount, reason",
        sample  => { header => "✨ **Points Reward** ✨", amount => "+50", reason => "Helping with groceries" },
        default_subject => "Points Adjustment",
        default_body    => "[header]\n\n🪙 **[amount] pts** 🪙\n\n**Reason:** [reason]"
    }
};

sub register {
    my ($self, $app, $config) = @_;

    # Sync manifest to DB on startup (non-blocking)
    Mojo::IOLoop->next_tick(sub {
        $app->db->sync_manifest(MANIFEST);
    });

    # --- EMAIL (GMAIL SMTP) ---
    # Parameters: to (string or arrayref), subject, body, user_id (opt)
    $app->helper(send_email_via_gmail => sub {
        my ($c, $to, $subject, $body, $user_id, $caller_id) = @_;
        my $settings = $c->db->get_email_settings();
        
        unless ($settings->{gmail_email} && $settings->{gmail_app_password}) {
            $c->app->log->error("Email credentials missing in DB");
            return 0;
        }
        
        my $recipient_str = ref($to) eq 'ARRAY' ? join(', ', @$to) : $to;

        # Fire and forget via subprocess to prevent blocking the Mojo loop
        Mojo::IOLoop->subprocess(
            sub {
                require Net::SMTP;
                my $smtp = Net::SMTP->new('smtp.gmail.com', Port => 587, Timeout => 30) or die $!;
                $smtp->starttls();
                $smtp->auth($settings->{gmail_email}, $settings->{gmail_app_password}) or die $smtp->message;
                $smtp->mail($settings->{gmail_email});
                
                my @recipients = ref($to) eq 'ARRAY' ? @$to : ($to);
                foreach my $r (@recipients) {
                    next unless $r;
                    $smtp->to($r);
                }
                
                my $from = $settings->{from_name} ? "$settings->{from_name} <$settings->{gmail_email}>" : $settings->{gmail_email};
                my $encoded_subject = encode('MIME-Header', $subject);
                my $encoded_body = encode('UTF-8', $body);
                
                $smtp->data();
                $smtp->datasend("From: $from\n");
                $smtp->datasend("To: $settings->{gmail_email}\n"); 
                $smtp->datasend("Subject: $encoded_subject\n");
                $smtp->datasend("Content-Type: text/plain; charset=UTF-8\n\n");
                $smtp->datasend("$encoded_body\n");
                $smtp->dataend();
                $smtp->quit();
                
                return scalar(@recipients);
            },
            sub {
                my ($subprocess, $err, $count) = @_;
                if ($err) {
                    $c->app->log->error("SMTP Subprocess Error: $err");
                    $c->db->log_notification(
                        user_id       => $user_id,
                        caller_id     => $caller_id,
                        type          => 'email',
                        recipient     => $recipient_str,
                        subject       => $subject,
                        message       => $body,
                        status        => 'failed',
                        error_details => "SMTP Error: $err"
                    );
                } else {
                    $c->app->log->info("Email sent to $count recipient(s): $subject");
                    $c->db->log_notification(
                        user_id   => $user_id,
                        caller_id => $caller_id,
                        type      => 'email',
                        recipient => $recipient_str,
                        subject   => $subject,
                        message   => $body,
                        status    => 'success'
                    );
                }
            }
        );
        
        return 1;
    });

    # --- PUSHOVER ---
    # Parameters: message, user_id (opt)
    $app->helper(push_pushover => sub {
        my ($c, $message, $user_id, $caller_id) = @_;
        my $creds = $c->db->{dbh}->selectrow_hashref("SELECT * FROM pushover LIMIT 1");
        
        return 0 unless $creds;
        
        $c->app->ua->post_p('https://api.pushover.net/1/messages.json' => form => {
            token   => $creds->{token},
            user    => $creds->{user},
            message => $message
        })->then(sub {
            my $tx = shift;
            if ($tx->result->is_success) {
                $c->app->log->info("Pushover alert sent: " . substr($message, 0, 30) . "...");
                $c->db->log_notification(
                    user_id   => $user_id,
                    caller_id => $caller_id,
                    type      => 'pushover',
                    recipient => 'Pushover Device',
                    message   => $message,
                    status    => 'success'
                );
            } else {
                my $body = $tx->result->body // '';
                $body = substr($body, 0, 200) . '...' if length($body) > 200;
                $c->app->log->error("Pushover failed: $body");
                $c->db->log_notification(
                    user_id       => $user_id,
                    caller_id     => $caller_id,
                    type          => 'pushover',
                    recipient     => 'Pushover Device',
                    message       => $message,
                    status        => 'failed',
                    error_details => "Status: " . $tx->result->code . " - $body"
                );
            }
        })->catch(sub {
            my $err = shift;
            $c->app->log->error("Pushover Exception: $err");
            $c->db->log_notification(
                user_id       => $user_id,
                caller_id     => $caller_id,
                type          => 'pushover',
                recipient     => 'Pushover Device',
                message       => $message,
                status        => 'failed',
                error_details => "Exception: $err"
            );
        });
        return 1;
    });

    # --- GOTIFY ---
    # Parameters: message, title (opt), priority (opt), user_id (opt)
    $app->helper(push_gotify => sub {
        my ($c, $message, $title, $priority, $user_id, $caller_id) = @_;
        my $creds = $c->db->{dbh}->selectrow_hashref("SELECT * FROM gotify LIMIT 1");
        
        return 0 unless $creds;
        my $url = "https://go.rendler.org/message?token=" . $creds->{token};
        my %params = (message => $message);
        $params{title} = $title if $title;
        $params{priority} = $priority if $priority;
        
        $c->app->ua->post_p($url => form => \%params)->then(sub {
            my $tx = shift;
            if ($tx->result->is_success) {
                $c->app->log->info("Gotify alert sent: " . ($title // 'No Title'));
                $c->db->log_notification(
                    user_id   => $user_id,
                    caller_id => $caller_id,
                    type      => 'gotify',
                    recipient => 'Gotify Client',
                    subject   => $title,
                    message   => $message,
                    status    => 'success'
                );
            } else {
                my $body = $tx->result->body // '';
                $body = substr($body, 0, 200) . '...' if length($body) > 200;
                $c->app->log->error("Gotify failed: $body");
                $c->db->log_notification(
                    user_id       => $user_id,
                    caller_id     => $caller_id,
                    type          => 'gotify',
                    recipient     => 'Gotify Client',
                    subject       => $title,
                    message       => $message,
                    status        => 'failed',
                    error_details => "Status: " . $tx->result->code . " - $body"
                );
            }
        })->catch(sub {
            my $err = shift;
            $c->app->log->error("Gotify Exception: $err");
            $c->db->log_notification(
                user_id       => $user_id,
                caller_id     => $caller_id,
                type          => 'gotify',
                recipient     => 'Gotify Client',
                subject       => $title,
                message       => $message,
                status        => 'failed',
                error_details => "Exception: $err"
            );
        });
        return 1;
    });

    # --- UNIFIED DISPATCHER ---
    # Parameters: user_id, message, subject
    $app->helper(notify_user => sub {
        my ($c, $user_id, $message, $subject, $caller_id) = @_;
        $subject //= "System Notification";
        
        my $user = $c->db->get_user_by_id($user_id);
        return 0 unless $user;

        # Try Discord first
        if ($user->{discord_id}) {
            return 1 if $c->send_discord_dm($user->{discord_id}, $message, $user_id, $caller_id) >= 1;
        }

        # Fallback to Email
        if ($user->{email}) {
            return $c->send_email_via_gmail($user->{email}, $subject, $message, $user_id, $caller_id);
        }

        $c->app->log->warn("No notification channels for user $user_id");
        $c->db->log_notification(
            user_id       => $user_id,
            caller_id     => $caller_id,
            type          => 'email',
            recipient     => 'None',
            message       => $message,
            status        => 'failed',
            error_details => 'No notification channels configured for user'
        );
        return 0;
    });

    # --- TEMPLATED NOTIFICATION ---
    # Renders a DB-stored template and dispatches it through the standard notify_user pipeline.
    # $user_id - Target recipient (used for Discord/email routing and log attribution).
    # $key     - MANIFEST template key (e.g., 'chore_complete').
    # $data    - HashRef of substitution values (must satisfy the key's available_tags).
    $app->helper(notify_templated => sub {
        my ($c, $user_id, $key, $data, $caller_id) = @_;

        # DB::render_template handles substitution and fallback logic.
        my $rendered = $c->db->render_template($key, $data, $c->app->config->{url});

        unless ($rendered && ref($rendered) eq 'HASH' && defined $rendered->{body} && defined $rendered->{subject}) {
            $c->app->log->error("notify_templated: render_template returned invalid result for key '$key'");
            return 0;
        }

        # notify_user signature: ($user_id, $message, $subject, $caller_id)
        return $c->notify_user(
            $user_id,
            $rendered->{body},
            $rendered->{subject},
            $caller_id
        );
    });
}

1;
