# /lib/MyApp/Plugin/Email.pm

package MyApp::Plugin::Email;

use Mojo::Base 'Mojolicious::Plugin', -signatures;
use strict;
use warnings;
use utf8;
use Encode qw(encode);

# Email delivery system plugin for calendar notifications.
# Responsibilities:
# - Provides Gmail SMTP integration with TLS encryption and authentication
# - Handles email notifications for calendar events
# Integration points:
# - Uses DB helpers for email settings and credential management
# - Integrates with logging system for delivery tracking and error reporting

# Register email delivery helpers with the application.
# Parameters:
#   $self   : Instance of plugin.
#   $app    : Mojolicious app object.
#   $config : Hashref of configuration overrides (optional).
# Returns:
#   None. Registers email helpers in $app.
sub register ($self, $app, $config = {}) {
    # Configuration defaults for SMTP connection and behavior settings
    my $smtp_timeout = $config->{smtp_timeout} || 30;
    my $smtp_host = $config->{smtp_host} || 'smtp.gmail.com';
    my $smtp_port = $config->{smtp_port} || 587;
    my $debug_email = $config->{debug_email} || 0;

    # Helper: send_email_via_gmail
    # Core Gmail SMTP email delivery with TLS encryption.
    # Parameters:
    #   $c      : Mojolicious controller (calling context).
    #   $to     : Recipient email address (single string OR arrayref of emails).
    #   $subject: Email subject line.
    #   $body   : Email message body.
    # Returns:
    #   Boolean: 1 on successful delivery, 0 on failure.
    $app->helper(send_email_via_gmail => sub ($c, $to, $subject, $body) {
        my $email_settings = $c->db->get_email_settings();
        
        unless ($email_settings->{gmail_email} && $email_settings->{gmail_app_password}) {
            $c->app->log->error("Email settings not configured properly - missing credentials");
            return 0;
        }
        
        require Net::SMTP;
        
        my $success = 0;
        
        eval {
            my $smtp = Net::SMTP->new($smtp_host,
                Port => $smtp_port,
                Timeout => $smtp_timeout,
                Debug => $debug_email
            ) or die "Cannot connect to SMTP server $smtp_host:$smtp_port: $!";
            
            $smtp->starttls() or die "STARTTLS negotiation failed";
            
            $smtp->auth($email_settings->{gmail_email}, $email_settings->{gmail_app_password}) 
                or die "SMTP authentication failed: " . $smtp->message;
            
            $smtp->mail($email_settings->{gmail_email}) or die "MAIL FROM command failed";
            
            # Handle multiple recipients (array) or single recipient (string)
            my @recipients = ref($to) eq 'ARRAY' ? @$to : ($to);
            
            foreach my $recipient (@recipients) {
                next unless $recipient;
                $smtp->to($recipient) or die "RCPT TO command failed for recipient: $recipient";
            }
            
            $smtp->data() or die "DATA command failed";
            
            my $from_header = $email_settings->{from_name} 
                ? "$email_settings->{from_name} <$email_settings->{gmail_email}>"
                : $email_settings->{gmail_email};
            
            # Encode subject and body to UTF-8 bytes for SMTP transmission
            my $encoded_subject = encode('MIME-Header', $subject);
            my $encoded_body = encode('UTF-8', $body);
                
            $smtp->datasend("From: $from_header\n");
            $smtp->datasend("To: $email_settings->{gmail_email}\n");  # Show sender as To (BCC everyone else)
            $smtp->datasend("Subject: $encoded_subject\n");
            $smtp->datasend("Content-Type: text/plain; charset=UTF-8\n");
            $smtp->datasend("Content-Transfer-Encoding: 8bit\n");
            $smtp->datasend("\n");
            $smtp->datasend("$encoded_body\n");
            $smtp->dataend() or die "Failed to complete message data transmission";
            
            $smtp->quit();
            
            $success = 1;
            my $recipient_count = scalar(@recipients);
            $c->app->log->info("Email sent successfully to $recipient_count recipient(s) (Subject: $subject)");
        };
        
        if (my $error = $@) {
            $c->app->log->error("Failed to send email: $error");
            return 0;
        }
        
        return $success;
    });
}

1;
