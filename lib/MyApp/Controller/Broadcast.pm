# /lib/MyApp/Controller/Broadcast.pm

package MyApp::Controller::Broadcast;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for the Broadcast System.
# Facilitates the dispatch of high-priority alerts to administrators through 
# integrated communication channels (Discord, Email, Pushover, Gotify).
#
# Features:
#   - Individual and global channel transmission.
#   - User role validation for secure access.
#   - Automated identification of the dispatching user.
#   - Informational logging for system auditing.

# Renders the broadcast interface skeleton.
# Route: GET /broadcast
# Returns: Rendered HTML template 'broadcast'.
sub index {
    my $c = shift;
    
    # Security: Authenticated and authorized access only
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family || $c->is_admin;
    
    $c->render(template => 'broadcast');
}

# Distributes a broadcast message to all administrators.
# Route: POST /broadcast/api/send
# Parameters:
#   message : The raw text content to distribute.
# Returns: JSON object { success, message }.
sub api_send {
    my $c = shift;
    
    # Security: Permission verification for the data endpoint
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_family || $c->is_admin;

    my $message = trim($c->param('message') // '');
    unless ($message) {
        return $c->render(json => { success => 0, error => 'Message content is required.' });
    }

    my $sender = $c->session('user');
    my $user_id = $c->current_user_id;
    my $full_msg = "Broadcast from $sender: $message";
    my $subject = "🔔 BROADCAST: From $sender 🔔";

    # Logs the distribution attempt for audit purposes
    $c->app->log->info("BROADCAST: User '$sender' is sending a broadcast alert: $message");

    # 1. Target Administrator Resolution
    my $users = $c->db->get_all_users();
    my @admins = grep { $_->{is_admin} && $_->{status} eq 'approved' } @$users;

    # 2. Individual Channel Dispatch
    foreach my $admin (@admins) {
        if ($admin->{discord_id}) {
            $c->send_discord_dm($admin->{discord_id}, "🚨 **SYSTEM BROADCAST** 🚨\n\n$full_msg", $user_id);
        }

        if ($admin->{email}) {
            $c->send_email_via_gmail([$admin->{email}], $subject, $full_msg, $user_id);
        }
    }

    # 3. Global Channel Dispatch
    $c->push_pushover($full_msg, $user_id);
    $c->push_gotify($full_msg, $subject, undef, $user_id);

    $c->render(json => { 
        success => 1, 
        message => 'Broadcast successfully dispatched to administrators and system channels.' 
    });
}

1;
