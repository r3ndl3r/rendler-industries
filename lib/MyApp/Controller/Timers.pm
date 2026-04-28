# /lib/MyApp/Controller/Timers.pm

package MyApp::Controller::Timers;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for Timer Management and Real-time Session Tracking.
#
# Features:
#   - User dashboard with synchronized live timer updates.
#   - Admin management interface for cross-user timer control.
#   - Real-time state handshake via api_state endpoints.
#   - Lifecycle management for Start/Pause/Stop operations.
#   - Automated daily limit enforcement and bonus time grants.
#
# Integration Points:
#   - DB::Timers for all data persistence and interval calculation.
#   - MyApp::Plugin::Icons for semantic status indicators.
#   - Dashboard Poller for high-frequency client-side updates.

# Renders the user dashboard skeleton.
# Route: GET /timers
sub dashboard {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family;
    
    # Redirection: admins and parents utilize the unified management interface
    return $c->redirect_to('/timers/manage') if $c->is_parent;

    $c->render('timers/dashboard');
}

# Renders the administrative management skeleton.
# Route: GET /timers/manage
sub manage {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_parent;
    $c->render('timers/manage');
}

# Returns the consolidated state for the active user's timers.
# Route: GET /timers/api/state
# Returns: JSON object { timers, success }
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    my $user_id = $c->current_user_id;
    
    # Maintenance: ensure all running intervals are reconciled before fetch
    $c->db->update_running_timers();
    
    my $timers = $c->db->get_user_timers($user_id);
    my $points = $c->db->get_user_points($user_id);
    my $reset  = $c->db->get_timer_reset_hour();
    
    $c->render(json => { 
        success          => 1,
        timers           => $timers,
        user_points      => $points,
        is_child         => $c->is_child ? 1 : 0,
        timer_reset_hour => $reset
    });
}

# Returns the administrative state for all timers or specific user filter.
# Route: GET /timers/api/manage/state
# Parameters:
#   user_id : Optional filter
# Returns: JSON object { timers, users, success }
sub api_manage_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_parent;

    my $filter_user_id = $c->param('user_id');
    my $timers = $c->db->get_all_timers($filter_user_id);
    my $users  = $c->db->get_family_users();
    
    $c->render(json => {
        success => 1,
        timers  => $timers,
        users   => $users
    });
}

# Initiates a timer session.
# Route: POST /timers/api/start
sub start_timer {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $timer_id = $c->param('timer_id');
    my $user_id  = $c->current_user_id;
    
    unless ($timer_id && $timer_id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => 'Invalid timer identification' });
    }
    
    if ($c->db->start_timer($timer_id, $user_id)) {
        $c->render(json => { success => 1, message => 'Session initiated' });
    } else {
        $c->render(json => { success => 0, error => 'Operation rejected: Timer expired or already active' });
    }
}

# Finalizes a running timer session.
# Route: POST /timers/api/stop
sub stop_timer {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $timer_id = $c->param('timer_id');
    my $user_id  = $c->current_user_id;
    
    unless ($timer_id && $timer_id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => 'Invalid timer identification' });
    }
    
    if ($c->db->stop_timer($timer_id, $user_id)) {
        $c->render(json => { success => 1, message => 'Session finalized' });
    } else {
        $c->render(json => { success => 0, error => 'Operation rejected: Stop command failed' });
    }
}

# Reconciles the pause state for a timer.
# Route: POST /timers/api/pause
sub toggle_pause {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $timer_id = $c->param('timer_id');
    my $user_id  = $c->current_user_id;
    
    unless ($timer_id && $timer_id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => 'Invalid timer identification' });
    }
    
    if ($c->db->toggle_pause($timer_id, $user_id)) {
        $c->render(json => { success => 1, message => 'State reconciled' });
    } else {
        $c->render(json => { success => 0, error => 'Operation rejected: State transition failed' });
    }
}

# Creates a new timer definition (Admin).
# Route: POST /timers/api/create
sub create {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_parent;
    
    my $user_id         = $c->param('user_id');
    my $name            = trim($c->param('name') // '');
    my $category        = $c->param('category');
    my $weekday_minutes = $c->param('weekday_minutes');
    my $weekend_minutes = $c->param('weekend_minutes');
    
    unless ($user_id && $name && $category && defined $weekday_minutes && defined $weekend_minutes) {
        return $c->render(json => { success => 0, error => 'Missing mandatory configuration fields' });
    }
    
    eval {
        my $admin_id = $c->current_user_id;
        $c->db->create_timer($user_id, $name, $category, $weekday_minutes, $weekend_minutes, $admin_id);
        $c->render(json => { success => 1, message => "Definition '$name' created" });
    };
    
    if ($@) {
        $c->app->log->error("Timer Creation Error: $@");
        $c->render(json => { success => 0, error => 'Database synchronization failed' });
    }
}

# Modifies an existing timer definition (Admin).
# Route: POST /timers/api/update/:id
sub update {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_parent;
    
    my $id              = $c->param('id');
    my $name            = trim($c->param('name') // '');
    my $category        = $c->param('category');
    my $weekday_minutes = $c->param('weekday_minutes');
    my $weekend_minutes = $c->param('weekend_minutes');
    
    eval {
        my $admin_id = $c->current_user_id;
        if ($c->db->update_timer($id, $name, $category, $weekday_minutes, $weekend_minutes, $admin_id)) {
            $c->render(json => { success => 1, message => 'Definition updated' });
        } else {
            $c->render(json => { success => 0, error => 'Update rejected: Record not found' });
        }
    };
    
    if ($@) {
        $c->render(json => { success => 0, error => 'Database synchronization failed' });
    }
}

# Removes a timer definition from the roster (Admin).
# Route: POST /timers/api/delete/:id
sub delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_parent;

    my $id = $c->param('id');
    
    eval {
        my $admin_id = $c->current_user_id;
        if ($c->db->delete_timer($id, $admin_id)) {
            $c->render(json => { success => 1, message => 'Definition removed' });
        } else {
            $c->render(json => { success => 0, error => 'Removal rejected: Record not found' });
        }
    };
    
    if ($@) {
        $c->render(json => { success => 0, error => 'Database synchronization failed' });
    }
}

# Appends bonus time to a specific session (Admin).
# Route: POST /timers/api/bonus
sub grant_bonus {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_parent;
    
    my $timer_id      = $c->param('timer_id');
    my $bonus_minutes = $c->param('bonus_minutes');
    
    unless ($timer_id && defined $bonus_minutes) {
        return $c->render(json => { success => 0, error => 'Invalid grant parameters' });
    }
    
    my $admin_id = $c->current_user_id;
    if ($c->db->grant_bonus_time($timer_id, $bonus_minutes, $admin_id)) {
        $c->render(json => { success => 1, message => "Bonus granted: $bonus_minutes minutes" });
    } else {
        $c->render(json => { success => 0, error => 'Grant rejected: Operation failed' });
    }
}

# Processes a point-to-time redemption request (Child context).
# Route: POST /timers/api/redeem
sub api_redeem {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_child;

    my $timer_id = $c->param('timer_id');
    my $points   = int($c->param('points') // 0);
    my $user_id  = $c->current_user_id;
    my $username = $c->session('user');

    unless ($timer_id && $points > 0) {
        return $c->render(json => { success => 0, error => 'Invalid redemption parameters' });
    }

    my ($success, $message) = $c->db->redeem_points_for_time($user_id, $timer_id, $points);

    if ($success) {
        # Notify Admins via Discord
        my $mins = $points * 10;
        my $timer = $c->db->_get_timer_by_id($timer_id);
        my $timer_name = $timer ? $timer->{name} : "Unknown Timer";
        
        my $admins = $c->db->get_admins();
        foreach my $admin (@$admins) {
            $c->notify_templated($admin->{id}, 'timers_points_redeemed', { 
                user       => $username, 
                points     => $points, 
                minutes    => $mins, 
                timer_name => $timer_name 
            }, $c->current_user_id);
        }

        $c->render(json => { success => 1, message => $message });
    } else {
        $c->render(json => { success => 0, error => $message });
    }
}

# Transfers remaining time between user timers (Admin Only).
# Route: POST /timers/api/transfer
sub api_transfer {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_parent;
    
    my $from_id = $c->param('from_timer_id');
    my $to_id   = $c->param('to_timer_id');
    my $user_id = $c->current_user_id;
    
    unless ($from_id && $to_id) {
        return $c->render(json => { success => 0, error => 'Missing transfer identification' });
    }
    
    my ($success, $message) = $c->db->transfer_timer_time($from_id, $to_id, $user_id);
    
    if ($success) {
        $c->render(json => { success => 1, message => $message });
    } else {
        $c->render(json => { success => 0, error => $message });
    }
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{family}->get('/timers')->to('timers#dashboard');
    $r->{family}->get('/timers/api/state')->to('timers#api_state');
    $r->{family}->post('/timers/api/start')->to('timers#start_timer');
    $r->{family}->post('/timers/api/stop')->to('timers#stop_timer');
    $r->{family}->post('/timers/api/pause')->to('timers#toggle_pause');
    $r->{family}->post('/timers/api/redeem')->to('timers#api_redeem');
    $r->{parent}->post('/timers/api/transfer')->to('timers#api_transfer');
    $r->{parent}->get('/timers/manage')->to('timers#manage');
    $r->{parent}->get('/timers/api/manage/state')->to('timers#api_manage_state');
    $r->{parent}->post('/timers/api/create')->to('timers#create');
    $r->{parent}->post('/timers/api/update/:id')->to('timers#update');
    $r->{parent}->post('/timers/api/delete/:id')->to('timers#delete');
    $r->{parent}->post('/timers/api/bonus')->to('timers#grant_bonus');
}

1;
