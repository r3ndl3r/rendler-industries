# /lib/MyApp/Controller/Admin/Notifications/Logs.pm

package MyApp::Controller::Admin::Notifications::Logs;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for Notification History and Audit Logging.
# Features:
#   - Real-time filtered ledger of system communications.
#   - Detailed diagnostic view for delivery failures.
#   - Administrative maintenance tools for log pruning.

# Renders the notification history skeleton.
# Route: GET /admin/notifications/logs
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_admin;
    $c->render('admin/notifications/logs');
}

# Returns the consolidated state for the notification ledger.
# Route: GET /admin/notifications/logs/api/state
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $filters = {
        search  => trim($c->param('search') // ''),
        type    => $c->param('type'),
        status  => $c->param('status'),
        user_id => $c->param('user_id'),
        days    => $c->param('days')
    };

    my $logs  = $c->db->get_notification_logs($filters);
    my $users = $c->db->get_family_users();

    $c->render(json => {
        success  => 1,
        logs     => $logs,
        users    => $users,
        is_admin => 1
    });
}

# Removes a specific notification log entry.
# Route: POST /admin/notifications/logs/api/delete/:id
sub api_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $id = $c->param('id');
    if ($c->db->delete_notification_log($id)) {
        $c->render(json => { success => 1 });
    } else {
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Prunes logs older than a specific threshold.
# Route: POST /admin/notifications/logs/api/prune
sub api_prune {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $days = int($c->param('days') // 30);
    if ($c->db->prune_notification_logs($days)) {
        $c->app->log->info("Notifications: Admin pruned logs older than $days days.");
        $c->render(json => { success => 1 });
    } else {
        $c->render(json => { success => 0, error => 'Database error' });
    }
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{admin}->get('/admin/notifications/logs')->to('admin-notifications-logs#index');
    $r->{admin}->get('/admin/notifications/logs/api/state')->to('admin-notifications-logs#api_state');
    $r->{admin}->post('/admin/notifications/logs/api/delete/:id')->to('admin-notifications-logs#api_delete');
    $r->{admin}->post('/admin/notifications/logs/api/prune')->to('admin-notifications-logs#api_prune');
}

1;
