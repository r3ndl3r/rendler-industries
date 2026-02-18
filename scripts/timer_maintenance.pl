#!/usr/bin/env perl
# /scripts/timer_maintenance.pl

use strict;
use warnings;
use FindBin;
use lib "$FindBin::Bin/../lib";
use lib "$ENV{HOME}/perl5/lib/perl5";

use DB;
use DateTime;

# Automated Timer Maintenance Script.
# Responsibilities:
#   - Update elapsed time for all running timers
#   - Check for and send warning emails (80% threshold)
#   - Check for and send expiry notifications
#   - Clean up old timer sessions (older than today)
# Execution:
#   Should be run via cron every 5 minutes
#   Example crontab: */5 * * * * /path/to/scripts/timer_maintenance.pl
# Integration points:
#   - Requires DB connection (uses environment variables)
#   - Sends emails via direct SMTP (replicates Email plugin logic)

my $db = DB->new();

main();

sub main {
    my $now = DateTime->now(time_zone => 'Australia/Melbourne');
    
    print "[" . $now->strftime('%Y-%m-%d %H:%M:%S') . "] Starting timer maintenance\n";
    
    cleanup_old_sessions();
    
    update_running_timers();
    
    check_and_send_notifications();
    
    print "[" . $now->strftime('%Y-%m-%d %H:%M:%S') . "] Timer maintenance complete\n";
}

# Remove timer sessions older than today
sub cleanup_old_sessions {
    my $today = DateTime->now(time_zone => 'Australia/Melbourne')->ymd;
    
    my $sql = "DELETE FROM timer_sessions WHERE session_date < ?";
    my $rows = $db->{dbh}->do($sql, undef, $today);
    
    print "  Cleaned up $rows old session(s)\n" if $rows > 0;
}

# Update elapsed time for all currently running timers
sub update_running_timers {
    my $count = $db->update_running_timers();
    print "  Updated $count running timer(s)\n" if $count > 0;
}

# Check for timers needing notifications and send emails
sub check_and_send_notifications {
    my $warnings_sent = 0;
    my $expiry_sent = 0;
    
    # Check for warning emails (80% threshold)
    my $warning_timers = $db->get_timers_needing_warning();
    
    foreach my $timer (@$warning_timers) {
        my $minutes_remaining = int($timer->{remaining_seconds} / 60);
        
        # Skip if already expired (edge case: limit reduced after 80% threshold hit)
        if ($minutes_remaining <= 0) {
            print "  Skipping warning for timer $timer->{timer_id} (already expired)\n";
            # Mark as sent to prevent repeated attempts
            $db->mark_warning_sent($timer->{timer_id});
            next;
        }
        
        my $subject = "Timer Warning: $timer->{name} ($timer->{category})";
        my $body = qq{
Hello $timer->{username},

Your timer "$timer->{name}" ($timer->{category}) is running low on time.

Time Remaining: $minutes_remaining minutes

Please wrap up your current activity soon.

- Rendler Industries Timer System
        };
        
        if (send_email($timer->{email}, $subject, $body)) {
            $db->mark_warning_sent($timer->{timer_id});
            $warnings_sent++;
            print "  Sent warning email for timer $timer->{timer_id} to $timer->{email}\n";
        } else {
            print "  Failed to send warning email for timer $timer->{timer_id}\n";
        }
    }
    
    # Check for expired timers
    my $expired_timers = $db->get_expired_timers();
    
    foreach my $timer (@$expired_timers) {
        my $subject = "Timer Expired: $timer->{name} ($timer->{category})";
        my $body = qq{
Hello $timer->{username},

Your timer "$timer->{name}" ($timer->{category}) has expired.

Daily Limit: $timer->{limit_minutes} minutes
Usage Today: } . int($timer->{elapsed_seconds} / 60) . qq{ minutes

Please stop using this device immediately.

- Rendler Industries Timer System
        };
        
        # Get all admin emails
        my $admins = $db->get_all_users();
        my @admin_emails = map { $_->{email} } grep { $_->{is_admin} } @$admins;
        
        # Send to user and all admins
        my @recipients = ($timer->{email}, @admin_emails);
        
        if (send_email(\@recipients, $subject, $body)) {
            $db->mark_expired_sent($timer->{timer_id});
            $expiry_sent++;
            print "  Sent expiry notification for timer $timer->{timer_id} to " . scalar(@recipients) . " recipient(s)\n";
        } else {
            print "  Failed to send expiry notification for timer $timer->{timer_id}\n";
        }
    }
    
    print "  Sent $warnings_sent warning email(s)\n" if $warnings_sent > 0;
    print "  Sent $expiry_sent expiry notification(s)\n" if $expiry_sent > 0;
    print "  No notifications needed\n" unless ($warnings_sent || $expiry_sent);
}

# Send email via Gmail SMTP
# Parameters:
#   to      : Email address(es) - string or arrayref
#   subject : Subject line
#   body    : Message body
# Returns: Boolean success status
sub send_email {
    my ($to, $subject, $body) = @_;
    
    require Net::SMTP;
    require Encode;
    
    my $email_settings = $db->get_email_settings();
    
    unless ($email_settings->{gmail_email} && $email_settings->{gmail_app_password}) {
        warn "Email settings not configured\n";
        return 0;
    }
    
    eval {
        my $smtp = Net::SMTP->new('smtp.gmail.com',
            Port => 587,
            Timeout => 30,
            Debug => 0
        ) or die "Cannot connect to SMTP server: $!";
        
        $smtp->starttls() or die "STARTTLS failed";
        
        $smtp->auth($email_settings->{gmail_email}, $email_settings->{gmail_app_password}) 
            or die "SMTP auth failed: " . $smtp->message;
        
        $smtp->mail($email_settings->{gmail_email}) or die "MAIL FROM failed";
        
        my @recipients = ref($to) eq 'ARRAY' ? @$to : ($to);
        
        foreach my $recipient (@recipients) {
            next unless $recipient;
            $smtp->to($recipient) or die "RCPT TO failed for: $recipient";
        }
        
        $smtp->data() or die "DATA command failed";
        
        my $from_header = $email_settings->{from_name} 
            ? "$email_settings->{from_name} <$email_settings->{gmail_email}>"
            : $email_settings->{gmail_email};
        
        my $encoded_subject = Encode::encode('MIME-Header', $subject);
        my $encoded_body = Encode::encode('UTF-8', $body);
        
        $smtp->datasend("From: $from_header\n");
        $smtp->datasend("To: $email_settings->{gmail_email}\n");
        $smtp->datasend("Subject: $encoded_subject\n");
        $smtp->datasend("Content-Type: text/plain; charset=UTF-8\n");
        $smtp->datasend("Content-Transfer-Encoding: 8bit\n");
        $smtp->datasend("\n");
        $smtp->datasend("$encoded_body\n");
        $smtp->dataend() or die "Failed to send message data";
        
        $smtp->quit();
        
        return 1;
    };
    
    if (my $error = $@) {
        warn "Failed to send email: $error\n";
        return 0;
    }
    
    return 1;
}

1;
