# /lib/DB/Notifications.pm

package DB::Notifications;

use strict;
use warnings;
use LWP::UserAgent;

# Database helper and client for external notification services.
# Features:
#   - Integration with Pushover API
#   - Integration with self-hosted Gotify instance
# Integration points:
#   - Extends DB package via package injection
#   - Uses LWP::UserAgent for outbound HTTP requests
#   - Retrieves API credentials securely from database tables

# Inject methods into the main DB package

# Sends a notification via the Pushover service.
# Parameters:
#   message : The text content to send
# Returns:
#   Void (Result of HTTP request is discarded)
sub DB::push_over {
    my ($self, $message) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Retrieve credentials from database
    my $sth = $self->{dbh}->prepare("SELECT * FROM pushover");
    $sth->execute();
    my $pushOver = $sth->fetchrow_hashref();
    
    # Dispatch request to Pushover API
    my $ua = LWP::UserAgent->new();
    my $res = $ua->post(
        'https://api.pushover.net/1/messages.json',
        [
            token   => $pushOver->{token},
            user    => $pushOver->{user},
            message => $message
        ]
    );
}

# Sends a notification via a Gotify server.
# Parameters:
#   message  : The text content to send
#   title    : (Optional) Notification title
#   priority : (Optional) Priority level (integer)
# Returns:
#   HTTP::Response object from the LWP request
sub DB::push_gotify {
    my ($self, $message, $title, $priority) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Retrieve credentials from database
    my $sth = $self->{dbh}->prepare("SELECT * FROM gotify");
    $sth->execute();
    my $gotify = $sth->fetchrow_hashref();
    
    # Construct API endpoint with token
    my $ua = LWP::UserAgent->new();
    my $url = 'https://go.rendler.org/message?token=' . $gotify->{token};
    
    # Build parameter list, handling optional fields
    my @params = (message => $message);
    push @params, (title => $title) if defined $title;
    push @params, (priority => $priority) if defined $priority;
    
    # Dispatch request
    my $res = $ua->post($url, \@params);
    
    return $res;
}

1;