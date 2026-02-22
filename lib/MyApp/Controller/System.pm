# /lib/MyApp/Controller/System.pm

package MyApp::Controller::System;
use Mojo::Base 'Mojolicious::Controller';

# Controller for System-level operations and maintenance.
# Features:
#   - Service lifecycle management (Hot Restart)
# Integration points:
#   - Interacts directly with the operating system shell
#   - Controls the Hypnotoad application server process

use DateTime;

# Initiates a hot restart of the application server.
# Route: POST /system/restart (or GET depending on router config)
# Parameters: None
# Returns:
#   Text confirmation if command initiated successfully
#   HTTP 500 if the system process fork fails
# Behavior:
#   - Forks a background process to avoid blocking the HTTP response
#   - Executes 'hypnotoad -s' (hot deployment) followed by a start command
#   - Changes working directory to app home to ensure relative paths resolve
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

# Run automated system maintenance tasks (Timers, Reminders, etc.)
# Route: GET /api/maintenance (Called by cron)
# Security: Restricted to Localhost
sub maintenance {
    my $c = shift;

    # Security: Only allow from localhost
    my $remote_addr = $c->tx->remote_address;
    unless ($remote_addr eq '127.0.0.1' || $remote_addr eq '::1') {
        return $c->render(json => { error => 'Access denied' }, status => 403);
    }

    my $now = DateTime->now(time_zone => 'Australia/Melbourne');
    my $result = {
        timestamp => $now->strftime('%Y-%m-%d %H:%M:%S'),
        timers    => {},
        reminders => {}, # Placeholder for future reminders logic
    };

    # 1. Run Timer Maintenance
    $result->{timers} = $c->_run_timer_maintenance();

    # 2. Run Reminders Maintenance
    $result->{reminders} = $c->_run_reminder_maintenance($now);

    $c->render(json => $result);
}

# Internal helper to handle recurring reminders.
sub _run_reminder_maintenance {
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
        my $msg = "🔔 REMINDER: $r->{title}\n\n$r->{description}";
        
        # Dispatch notification using standardized helper
        if ($c->notify_user($r->{user_id}, $msg, "Reminder: $r->{title}")) {
            $stats->{notified}++;
            
            # Mark as sent for today if not already done
            unless ($processed_reminder_ids{$r->{id}}) {
                $c->db->mark_reminder_sent($r->{id});
                $processed_reminder_ids{$r->{id}} = 1;
            }
        } else {
            $stats->{errors}++;
        }
    }

    return $stats;
}

# Internal helper to handle timer-specific maintenance tasks.
sub _run_timer_maintenance {
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

1;