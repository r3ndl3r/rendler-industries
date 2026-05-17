# /lib/MyApp/Controller/Admin/Maintenance.pm

package MyApp::Controller::Admin::Maintenance;

use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Admin controller for the Maintenance Task Manager.
# All routes require the $admin bridge (is_admin check).
#
# Routes:
#   GET  /admin/maintenance             — renders template
#   GET  /admin/maintenance/api/state   — returns all task configs as JSON
#   POST /admin/maintenance/api/update  — updates is_enabled + interval_minutes
#   POST /admin/maintenance/api/run     — fires one task immediately by function_name

# Renders the maintenance task manager page.
sub index {
    my $c = shift;
    return $c->render('noperm') unless $c->is_admin;
    $c->render('admin/maintenance');
}

# Mobile Auth Callback
# Route: GET /admin/auth/callback
# Behavior: Renders a success page for the app to intercept during the Cloudflare login flow.
sub mobile_auth_callback {
    my $c = shift;
    $c->render('admin/auth_callback');
}

# Returns all maintenance task configs for the admin UI.
# Route: GET /admin/maintenance/api/state
# Returns: JSON { success, tasks[] }
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_admin;

    my $tasks = $c->db->get_all_maintenance_tasks();
    $c->render(json => { success => 1, tasks => $tasks });
}

# Updates the enabled flag and minimum interval for a single task.
# Route: POST /admin/maintenance/api/update
# Parameters: name (string), is_enabled (0|1), interval_minutes (int >= 1)
# Returns: JSON { success, error }
sub api_update {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_admin;

    my $name     = trim($c->param('name')            // '');
    my $enabled  = $c->param('is_enabled') ? 1 : 0;
    my $interval = int($c->param('interval_minutes') // 1);

    return $c->render(json => { success => 0, error => 'Task name is required' })
        unless $name;
    return $c->render(json => { success => 0, error => 'Interval must be at least 1 minute' })
        unless $interval >= 1;

    eval { $c->db->update_maintenance_task($name, $enabled, $interval) };
    if ($@) {
        $c->app->log->error("Maintenance task update failed [$name]: $@");
        return $c->render(json => { success => 0, error => 'Database error' });
    }

    $c->render(json => { success => 1 });
}

# Saves all editable fields for an existing task (full record edit from modal).
# Route: POST /admin/maintenance/api/edit
# Parameters: name, label, function_name, description, is_async (0|1),
#             is_enabled (0|1), interval_minutes (int >= 1)
# Returns: JSON { success, error }
sub api_edit {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_admin;

    my $name          = trim($c->param('name')            // '');
    my $label         = trim($c->param('label')           // '');
    my $description   = trim($c->param('description')     // '');
    my $function_name = trim($c->param('function_name')   // '');
    my $is_async      = $c->param('is_async')    ? 1 : 0;
    my $run_last      = $c->param('run_last')    ? 1 : 0;
    my $is_enabled    = $c->param('is_enabled')  ? 1 : 0;
    my $interval      = int($c->param('interval_minutes') // 1);

    return $c->render(json => { success => 0, error => 'Name is required'          }) unless $name;
    return $c->render(json => { success => 0, error => 'Label is required'         }) unless $label;
    return $c->render(json => { success => 0, error => 'Function name is required' }) unless $function_name;
    return $c->render(json => { success => 0, error => 'Interval must be >= 1'     }) unless $interval >= 1;

    eval { $c->db->edit_maintenance_task($name, $label, $description, $function_name, $is_async, $run_last, $is_enabled, $interval) };
    if ($@) {
        $c->app->log->error("Maintenance task edit failed [$name]: $@");
        return $c->render(json => { success => 0, error => 'Database error' });
    }

    $c->render(json => { success => 1 });
}

# Creates a new maintenance task record.
# Route: POST /admin/maintenance/api/add
# Parameters: name, label, function_name, description, is_async (0|1),
#             is_enabled (0|1), interval_minutes (int >= 1)
# Returns: JSON { success, error }
sub api_add {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_admin;

    my $name          = trim($c->param('name')            // '');
    my $label         = trim($c->param('label')           // '');
    my $description   = trim($c->param('description')     // '');
    my $function_name = trim($c->param('function_name')   // '');
    my $is_async      = $c->param('is_async')    ? 1 : 0;
    my $run_last      = $c->param('run_last')    ? 1 : 0;
    my $is_enabled    = $c->param('is_enabled')  ? 1 : 0;
    my $interval      = int($c->param('interval_minutes') // 1);

    return $c->render(json => { success => 0, error => 'Name is required'          }) unless $name;
    return $c->render(json => { success => 0, error => 'Label is required'         }) unless $label;
    return $c->render(json => { success => 0, error => 'Function name is required' }) unless $function_name;
    return $c->render(json => { success => 0, error => 'Interval must be >= 1'     }) unless $interval >= 1;

    eval { $c->db->create_maintenance_task($name, $label, $description, $function_name, $is_async, $run_last, $is_enabled, $interval) };
    if ($@) {
        my $err = $@ =~ /Duplicate entry/i ? "A task with that name already exists" : 'Database error';
        $c->app->log->error("Maintenance task create failed [$name]: $@");
        return $c->render(json => { success => 0, error => $err });
    }

    $c->render(json => { success => 1 });
}

# Deletes a maintenance task by name.
# Route: POST /admin/maintenance/api/delete
# Parameters: name (string)
# Returns: JSON { success, error }
sub api_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_admin;

    my $name = trim($c->param('name') // '');
    return $c->render(json => { success => 0, error => 'Name is required' }) unless $name;

    eval { $c->db->delete_maintenance_task($name) };
    if ($@) {
        $c->app->log->error("Maintenance task delete failed [$name]: $@");
        return $c->render(json => { success => 0, error => 'Database error' });
    }

    $c->render(json => { success => 1 });
}

# Fires a single task immediately by looking up its function_name from the DB.
# Bypasses the interval gate. Async tasks (is_async=1) are launched and return immediately.
# Route: POST /admin/maintenance/api/run
# Parameters: name (string)
# Returns: JSON { success, message, error }
sub api_run {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_admin;

    my $name = trim($c->param('name') // '');
    return $c->render(json => { success => 0, error => 'Task name is required' }) unless $name;

    my $configs = $c->db->get_maintenance_task_configs();
    my ($task)  = grep { $_->{name} eq $name } @$configs;
    return $c->render(json => { success => 0, error => 'Unknown task' }) unless $task;

    my $fn = $task->{function_name};
    require MyApp::Controller::System;
    my $sys = MyApp::Controller::System->new(app => $c->app, tx => $c->tx);
    my $now = $c->now;

    if ($task->{is_async}) {
        $c->db->mark_maintenance_task_ran($name);
        $sys->$fn($now)->catch(sub {
            $c->app->log->error("Manual async task [$name] failed: $_[0]");
        });
        return $c->render(json => { success => 1, message => 'Task queued (runs asynchronously)' });
    }

    eval { $sys->$fn($now) };
    if ($@) {
        $c->app->log->error("Manual task run failed [$name]: $@");
        return $c->render(json => { success => 0, error => 'Task execution failed — check server log' });
    }

    $c->db->mark_maintenance_task_ran($name);
    $c->render(json => { success => 1, message => 'Task completed' });
}

sub register_routes {
    my ($class, $r) = @_;
    $r->{admin}->get( '/admin/maintenance'            )->to('admin-maintenance#index'     );
    $r->{admin}->get( '/admin/auth/callback'          )->to('admin-maintenance#mobile_auth_callback');
    $r->{admin}->get( '/admin/maintenance/api/state'  )->to('admin-maintenance#api_state' );
    $r->{admin}->post('/admin/maintenance/api/update' )->to('admin-maintenance#api_update');
    $r->{admin}->post('/admin/maintenance/api/edit'   )->to('admin-maintenance#api_edit'  );
    $r->{admin}->post('/admin/maintenance/api/add'    )->to('admin-maintenance#api_add'   );
    $r->{admin}->post('/admin/maintenance/api/delete' )->to('admin-maintenance#api_delete');
    $r->{admin}->post('/admin/maintenance/api/run'    )->to('admin-maintenance#api_run'   );
}

1;
