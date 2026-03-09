# /lib/MyApp/Plugin/Notifications.pm

package MyApp::Plugin::Notifications;

use Mojo::Base 'Mojolicious::Plugin';
use Mojo::UserAgent;
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
# - Provides standardized logging for delivery tracking.

sub register {
    my ($self, $app, $config) = @_;

    # --- DISCORD DMs ---
    # Parameters: discord_id, text
    $app->helper(send_discord_dm => sub {
        my ($c, $discord_id, $text) = @_;
        return 0 unless $discord_id;
        
        my $url = "http://127.0.0.1:3000/message/dm/$discord_id";
        
        # Non-blocking fire-and-forget using persistent app agent
        $c->app->ua->request_timeout(15)->post_p($url => json => { text => $text })->then(sub {
            my $tx = shift;
            if (my $res = $tx->result) {
                if ($res->is_success) {
                    $c->app->log->info("Discord DM sent to $discord_id: $text");
                } else {
                    $c->app->log->error("Discord API error ($discord_id): Status " . $res->code);
                }
            }
        })->catch(sub {
            my $err = shift;
            $c->app->log->error("Discord API Exception ($discord_id): $err");
        });
        
        return 1; # Optimistic success for callers
    });

    # --- EMAIL (GMAIL SMTP) ---
    # Parameters: to (string or arrayref), subject, body
    $app->helper(send_email_via_gmail => sub {
        my ($c, $to, $subject, $body) = @_;
        my $settings = $c->db->get_email_settings();
        
        unless ($settings->{gmail_email} && $settings->{gmail_app_password}) {
            $c->app->log->error("Email credentials missing in DB");
            return 0;
        }
        
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
                $smtp->datasend("To: $settings->{gmail_email}\n"); # BCC pattern
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
                } else {
                    $c->app->log->info("Email sent to $count recipient(s): $subject");
                }
            }
        );
        
        return 1; # Optimistic success for callers
    });

    # --- PUSHOVER ---
    # Parameters: message
    $app->helper(push_pushover => sub {
        my ($c, $message) = @_;
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
            } else {
                $c->app->log->error("Pushover failed: " . $tx->result->body);
            }
        })->catch(sub {
            my $err = shift;
            $c->app->log->error("Pushover Exception: $err");
        });
        return 1;
    });

    # --- GOTIFY ---
    # Parameters: message, title (opt), priority (opt)
    $app->helper(push_gotify => sub {
        my ($c, $message, $title, $priority) = @_;
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
            } else {
                $c->app->log->error("Gotify failed: " . $tx->result->body);
            }
        })->catch(sub {
            my $err = shift;
            $c->app->log->error("Gotify Exception: $err");
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
            return 1 if $c->send_discord_dm($user->{discord_id}, $message) >= 1;
        }

        # Fallback to Email
        if ($user->{email}) {
            return $c->send_email_via_gmail($user->{email}, $subject, $message);
        }

        $c->app->log->warn("No notification channels for user $user_id");
        return 0;
    });
}

1;
