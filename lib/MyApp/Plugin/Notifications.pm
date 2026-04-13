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

sub register {
    my ($self, $app, $config) = @_;

    # --- EMAIL (GMAIL SMTP) ---
    # Parameters: to (string or arrayref), subject, body, user_id (opt)
    $app->helper(send_email_via_gmail => sub {
        my ($c, $to, $subject, $body, $user_id) = @_;
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
        my ($c, $message, $user_id) = @_;
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
        my ($c, $message, $title, $priority, $user_id) = @_;
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
        my ($c, $user_id, $message, $subject) = @_;
        $subject //= "System Notification";
        
        my $user = $c->db->get_user_by_id($user_id);
        return 0 unless $user;

        # Try Discord first
        if ($user->{discord_id}) {
            return 1 if $c->send_discord_dm($user->{discord_id}, $message, $user_id) >= 1;
        }

        # Fallback to Email
        if ($user->{email}) {
            return $c->send_email_via_gmail($user->{email}, $subject, $message, $user_id);
        }

        $c->app->log->warn("No notification channels for user $user_id");
        $c->db->log_notification(
            user_id       => $user_id,
            type          => 'email',
            recipient     => 'None',
            message       => $message,
            status        => 'failed',
            error_details => 'No notification channels configured for user'
        );
        return 0;
    });
}

1;
