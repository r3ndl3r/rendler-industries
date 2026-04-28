# /lib/MyApp/Controller/Admin/Notifications/Test.pm

package MyApp::Controller::Admin::Notifications::Test;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for the notification test dispatch tool.
# Allows admins to fire test messages to any approved family user across any supported channel.
# User-specific channels (Discord, Email, FCM) require a target user with the corresponding credential.
# System-wide channels (Gotify, Pushover) fire without a user target.

# Route: GET /admin/notifications/test
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_admin;
    $c->render('admin/notifications/test');
}

# Returns approved family users with per-user channel availability flags.
# Route: GET /admin/notifications/test/api/state
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    $c->render(json => {
        success => 1,
        users   => $c->db->get_family_users_for_test(),
    });
}

# Dispatches a test notification on each selected channel.
# User-specific channels are silently skipped if the target user lacks the required credential.
# All channels are fire-and-forget — results appear in /admin/notifications/logs.
# Route: POST /admin/notifications/test/api/send
# Parameters: user_id (required for Discord/Email/FCM), channels[] (multi-value), subject, message
sub api_send {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $user_id   = $c->param('user_id') || undef;
    my $subject   = trim($c->param('subject') // '') || 'Test Notification';
    my $message   = trim($c->param('message') // '');
    my @channels  = $c->every_param('channels[]');
    @channels     = map { ref($_) eq 'ARRAY' ? @$_ : $_ } @channels;
    my $caller_id = $c->current_user_id;

    return $c->render(json => { success => 0, error => 'Message is required' })        unless $message;
    return $c->render(json => { success => 0, error => 'Select at least one channel' }) unless @channels;

    my @user_channels = grep { /^(?:discord|email|fcm)$/ } @channels;
    if (@user_channels && !$user_id) {
        return $c->render(json => { success => 0, error => 'Select a target user for the chosen channels' });
    }

    my $user = $user_id ? $c->db->get_user_by_id($user_id) : undef;
    my @dispatched;

    for my $ch (@channels) {
        if ($ch eq 'discord' && $user && $user->{discord_id}) {
            $c->send_discord_dm($user->{discord_id}, $message, $user_id);
            push @dispatched, 'discord';
        }
        elsif ($ch eq 'email' && $user && $user->{email}) {
            $c->send_email_via_gmail($user->{email}, $subject, $message, $user_id, $caller_id);
            push @dispatched, 'email';
        }
        elsif ($ch eq 'fcm' && $user_id) {
            my $sent = $c->push_fcm($user_id, $subject, $message, undef, $caller_id);
            push @dispatched, 'fcm' if $sent;
        }
        elsif ($ch eq 'gotify') {
            $c->push_gotify($message, $subject, 5, undef, $caller_id);
            push @dispatched, 'gotify';
        }
        elsif ($ch eq 'pushover') {
            $c->push_pushover($message, undef, $caller_id);
            push @dispatched, 'pushover';
        }
    }

    $c->render(json => {
        success    => 1,
        dispatched => \@dispatched,
    });
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{admin}->get('/admin/notifications/test')->to('admin-notifications-test#index');
    $r->{admin}->get('/admin/notifications/test/api/state')->to('admin-notifications-test#api_state');
    $r->{admin}->post('/admin/notifications/test/api/send')->to('admin-notifications-test#api_send');
}

1;
