# /lib/MyApp/Controller/Timers.pm

package MyApp::Controller::Timers;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for Timer Management and Real-time Session Tracking.
# Features:
#   - User dashboard with live timer updates
#   - Admin management interface (create, edit, delete timers)
#   - Real-time AJAX API for start/stop/pause operations
#   - Email notification triggers for warnings and expiry
#   - Individual and aggregate timer views for admins
# Integration points:
#   - Uses DB::Timers for all data operations
#   - Coordinates with Email plugin for notification delivery
#   - Restricted to authenticated users via router bridge

# Render user's personal timer dashboard.
# Route: GET /timers
# Parameters: None
# Returns:
#   Rendered HTML template 'timers/dashboard' with user's active timers
sub dashboard {
    my $c = shift;
    
    my $user_id = $c->current_user_id;
    my $timers = $c->db->get_user_timers($user_id);
    
    $c->render('timers/dashboard', timers => $timers, current => 'timers');
}

# Render admin management interface (all users or specific user).
# Route: GET /timers/manage
# Parameters:
#   user_id : Optional query parameter to filter by specific user
# Returns:
#   Rendered HTML template 'timers/manage' with timer list
sub manage {
    my $c = shift;
    
    my $filter_user_id = $c->param('user_id');
    my $timers = $c->db->get_all_timers($filter_user_id);
    my $users = $c->db->get_all_users();
    
    $c->render('timers/manage', 
        timers => $timers, 
        users => $users,
        filter_user_id => $filter_user_id,
        current => 'timers'
    );
}

# AJAX API endpoint to get current state of user's timers.
# Route: GET /timers/api/status
# Parameters: None
# Returns:
#   JSON array of timer objects with real-time elapsed/remaining values
sub api_status {
    my $c = shift;
    my $userid = $c->current_user_id;
    
    $c->db->update_running_timers();
    
    my $timers = $c->db->get_user_timers($userid);

    # Notifications are handled by scripts/timer_maintenance.pl cron job 
    $c->render(json => { timers => $timers });
}

# Start a timer session.
# Route: POST /timers/start
# Parameters:
#   timer_id : Unique timer ID
# Returns:
#   JSON object { success => 1/0, message => "..." }
sub start_timer {
    my $c = shift;
    
    my $json = $c->req->json || {};
    my $timer_id = $json->{timer_id};
    my $user_id = $c->current_user_id;
    
    unless ($timer_id && $timer_id =~ /^\d+$/) {
        return $c->render(json => { success => 0, message => 'Invalid timer ID' });
    }
    
    my $success = $c->db->start_timer($timer_id, $user_id);
    
    if ($success) {
        $c->render(json => { success => 1, message => 'Timer started' });
    } else {
        $c->render(json => { success => 0, message => 'Cannot start timer (expired or paused)' });
    }
}

# Stop a running timer.
# Route: POST /timers/stop
# Parameters:
#   timer_id : Unique timer ID
# Returns:
#   JSON object { success => 1/0, message => "..." }
sub stop_timer {
    my $c = shift;
    
    my $json = $c->req->json || {};
    my $timer_id = $json->{timer_id};
    my $user_id = $c->current_user_id;
    
    unless ($timer_id && $timer_id =~ /^\d+$/) {
        return $c->render(json => { success => 0, message => 'Invalid timer ID' });
    }
    
    my $success = $c->db->stop_timer($timer_id, $user_id);
    
    if ($success) {
        $c->render(json => { success => 1, message => 'Timer stopped' });
    } else {
        $c->render(json => { success => 0, message => 'Failed to stop timer' });
    }
}

# Toggle pause state for a timer.
# Route: POST /timers/pause
# Parameters:
#   timer_id : Unique timer ID
# Returns:
#   JSON object { success => 1/0, paused => 1/0, message => "..." }
sub toggle_pause {
    my $c = shift;
    
    my $json = $c->req->json || {};
    my $timer_id = $json->{timer_id};
    my $user_id = $c->current_user_id;
    
    unless ($timer_id && $timer_id =~ /^\d+$/) {
        return $c->render(json => { success => 0, message => 'Invalid timer ID' });
    }
    
    my $success = $c->db->toggle_pause($timer_id, $user_id);
    
    if ($success) {
        # Get updated state to return current pause status
        my $timers = $c->db->get_user_timers($user_id);
        my ($timer) = grep { $_->{id} == $timer_id } @$timers;
        
        my $paused = $timer ? $timer->{is_paused} : 0;
        my $message = $paused ? 'Timer paused' : 'Timer unpaused';
        
        $c->render(json => { success => 1, paused => $paused, message => $message });
    } else {
        $c->render(json => { success => 0, message => 'Failed to toggle pause' });
    }
}

# Create a new timer (Admin only).
# Route: POST /timers/create
# Parameters:
#   user_id          : Target user ID
#   name             : Timer display name
#   category         : Device category
#   weekday_minutes  : Daily limit for weekdays
#   weekend_minutes  : Daily limit for weekends
# Returns:
#   Redirects to manage page on success, renders error on failure
sub create {
    my $c = shift;
    
    my $user_id = $c->param('user_id');
    my $name = trim($c->param('name') // '');
    my $category = $c->param('category');
    my $weekday_minutes = $c->param('weekday_minutes');
    my $weekend_minutes = $c->param('weekend_minutes');
    
    # Validation
    return $c->render_error('Invalid user') unless $user_id && $user_id =~ /^\d+$/;
    return $c->render_error('Timer name required') unless $name;
    return $c->render_error('Invalid category') unless $category && $category =~ /^(Computer|Phone|Tablet|Gaming Console|TV)$/;
    return $c->render_error('Invalid weekday minutes') unless defined $weekday_minutes && $weekday_minutes =~ /^\d+$/;
    return $c->render_error('Invalid weekend minutes') unless defined $weekend_minutes && $weekend_minutes =~ /^\d+$/;
    
    eval {
        my $admin_id = $c->current_user_id;
        $c->db->create_timer($user_id, $name, $category, $weekday_minutes, $weekend_minutes, $admin_id);
    };
    
    if (my $error = $@) {
        $c->app->log->error("Failed to create timer: $error");
        return $c->render_error("Error creating timer: $error", 500);
    }
    
    $c->flash(success => "Timer '$name' created successfully");
    $c->redirect_to('/timers/manage');
}

# Update an existing timer (Admin only).
# Route: POST /timers/update/:id
# Parameters:
#   id               : Timer ID (from route)
#   name             : New display name
#   category         : New category
#   weekday_minutes  : New weekday limit
#   weekend_minutes  : New weekend limit
# Returns:
#   Redirects to manage page on success, renders error on failure
sub update {
    my $c = shift;
    
    my $timer_id = $c->param('id');
    my $name = trim($c->param('name') // '');
    my $category = $c->param('category');
    my $weekday_minutes = $c->param('weekday_minutes');
    my $weekend_minutes = $c->param('weekend_minutes');
    
    # Validation
    return $c->render_error('Invalid timer ID') unless $timer_id && $timer_id =~ /^\d+$/;
    return $c->render_error('Timer name required') unless $name;
    return $c->render_error('Invalid category') unless $category && $category =~ /^(Computer|Phone|Tablet|Gaming Console|TV)$/;
    return $c->render_error('Invalid weekday minutes') unless defined $weekday_minutes && $weekday_minutes =~ /^\d+$/;
    return $c->render_error('Invalid weekend minutes') unless defined $weekend_minutes && $weekend_minutes =~ /^\d+$/;
    
    my $admin_id = $c->current_user_id;
    my $success = $c->db->update_timer($timer_id, $name, $category, $weekday_minutes, $weekend_minutes, $admin_id);
    
    if ($success) {
        $c->flash(success => "Timer updated successfully");
        $c->redirect_to('/timers/manage');
    } else {
        $c->render_error('Failed to update timer', 500);
    }
}

# Delete a timer (Admin only).
# Route: POST /timers/delete/:id
# Parameters:
#   id : Timer ID (from route)
# Returns:
#   Redirects to manage page on success, renders error on failure
sub delete {
    my $c = shift;
    
    my $timer_id = $c->param('id');
    
    return $c->render_error('Invalid timer ID') unless $timer_id && $timer_id =~ /^\d+$/;
    
    my $admin_id = $c->current_user_id;
    my $success = $c->db->delete_timer($timer_id, $admin_id);
    
    if ($success) {
        $c->flash(success => "Timer deleted successfully");
        $c->redirect_to('/timers/manage');
    } else {
        $c->render_error('Failed to delete timer', 500);
    }
}

# Grant bonus time to a timer (Admin only).
# Route: POST /timers/bonus
# Parameters:
#   timer_id       : Unique timer ID
#   bonus_minutes  : Additional minutes to grant
# Returns:
#   JSON object { success => 1/0, message => "..." }
sub grant_bonus {
    my $c = shift;
    
    my $json = $c->req->json || {};
    my $timer_id = $json->{timer_id};
    my $bonus_minutes = $json->{bonus_minutes};
    
    unless ($timer_id && $timer_id =~ /^\d+$/ && defined $bonus_minutes && $bonus_minutes =~ /^\d+$/) {
        return $c->render(json => { success => 0, message => 'Invalid parameters' });
    }
    
    my $admin_id = $c->current_user_id;
    my $success = $c->db->grant_bonus_time($timer_id, $bonus_minutes, $admin_id);
    
    if ($success) {
        $c->render(json => { success => 1, message => "$bonus_minutes minutes added" });
    } else {
        $c->render(json => { success => 0, message => 'Failed to grant bonus time' });
    }
}

# ============================================================================
# PRIVATE HELPER METHODS
# ============================================================================

# Internal method to check timers and trigger email notifications.
# Parameters: None
# Returns:
#   HashRef with counts: { warnings_sent => N, expiry_sent => N }
sub _check_and_send_notifications {
    my ($c) = @_;
    
    my $warnings_sent = 0;
    my $expiry_sent = 0;
    
    # Check for warning emails (80% threshold)
    my $warning_timers = $c->db->get_timers_needing_warning();
    
    foreach my $timer (@$warning_timers) {
        my $minutes_remaining = int($timer->{remaining_seconds} / 60);
        
        my $subject = "Timer Warning: $timer->{name} ($timer->{category})";
        my $body = qq{
Hello $timer->{username},

Your timer "$timer->{name}" ($timer->{category}) is running low on time.

Time Remaining: $minutes_remaining minutes

Please wrap up your current activity soon.

- Rendler Industries Timer System
        };
        
        if ($c->send_email_via_gmail($timer->{email}, $subject, $body)) {
            $c->db->mark_warning_sent($timer->{timer_id});
            $warnings_sent++;
        }
    }
    
    # Check for expired timers
    my $expired_timers = $c->db->get_expired_timers();
    
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
        my $admins = $c->db->get_all_users();
        my @admin_emails = map { $_->{email} } grep { $_->{is_admin} } @$admins;
        
        # Send to user and all admins
        my @recipients = ($timer->{email}, @admin_emails);
        
        if ($c->send_email_via_gmail(\@recipients, $subject, $body)) {
            $c->db->mark_expired_sent($timer->{timer_id});
            $expiry_sent++;
        }
    }
    
    return {
        warnings_sent => $warnings_sent,
        expiry_sent => $expiry_sent
    };
}

# Run automated maintenance tasks.
# Route: GET /timers/api/maintenance (Called by cron)
# Parameters: None
# Returns:
#   JSON object with maintenance results
sub run_maintenance {
    my $c = shift;

    # Security: Only allow from localhost
    my $remote_addr = $c->tx->remote_address;
    unless ($remote_addr eq '127.0.0.1' || $remote_addr eq '::1') {
        return $c->render(json => { error => 'Access denied' }, status => 403);
    }
    
    my $result = {
        timestamp => DateTime->now(time_zone => 'Australia/Melbourne')->strftime('%Y-%m-%d %H:%M:%S'),
        cleaned_sessions => 0,
        updated_timers => 0,
        warnings_sent => 0,
        expiry_sent => 0
    };
    
    # 1. Clean up old sessions
    my $today = DateTime->now(time_zone => 'Australia/Melbourne')->ymd;
    my $sql = "DELETE FROM timer_sessions WHERE session_date < ?";
    $result->{cleaned_sessions} = $c->db->{dbh}->do($sql, undef, $today) || 0;
    
    # 2. Update running timers
    $result->{updated_timers} = $c->db->update_running_timers();
    
    # 3. Send warning emails (10 minutes or less remaining)
    my $warning_timers = $c->db->get_timers_needing_warning();
    
    foreach my $timer (@$warning_timers) {
        my $minutes_remaining = int($timer->{remaining_seconds} / 60);
        
        # Skip if already expired
        if ($minutes_remaining <= 0) {
            $c->db->mark_warning_sent($timer->{timer_id});
            next;
        }
        
        my $email_subject = "Timer Warning: $timer->{name} ($timer->{category})";
        my $email_body = qq{Hello $timer->{username},

Your timer "$timer->{name}" ($timer->{category}) is running low on time.

Time Remaining: $minutes_remaining minutes

Please wrap up your current activity soon.

- Rendler Industries Timer System};
        
        if ($c->send_email_via_gmail([$timer->{email}], $email_subject, $email_body)) {
            print "✓ Warning email sent to $timer->{email} for timer $timer->{timer_id}\n";
            $c->db->mark_warning_sent($timer->{timer_id});
            $result->{warnings_sent}++;
        } else {
            print "✗ Failed to send warning email for timer $timer->{timer_id}\n";
        }
    }
    
    # 4. Send expiry notifications
    my $expired_timers = $c->db->get_expired_timers();
    
    foreach my $timer (@$expired_timers) {
        my $email_subject = "Timer Expired: $timer->{name} ($timer->{category})";
        my $email_body = qq{Hello $timer->{username},

Your timer "$timer->{name}" ($timer->{category}) has expired.

Daily Limit: $timer->{limit_minutes} minutes
Usage Today: } . int($timer->{elapsed_seconds} / 60) . qq{ minutes

Please stop using this device immediately.

- Rendler Industries Timer System};
        
        # Get all admin emails (same pattern as Calendar)
        my $all_users = $c->db->get_all_users();
        my @admin_emails;
        for my $user (@$all_users) {
            if ($user->{is_admin} && $user->{email}) {
                push @admin_emails, $user->{email};
            }
        }
        
        # Send to user and all admins
        my @recipients = ($timer->{email}, @admin_emails);
        
        if ($c->send_email_via_gmail(\@recipients, $email_subject, $email_body)) {
            print "✓ Expiry email sent to " . scalar(@recipients) . " recipient(s) for timer $timer->{timer_id}\n";
            $c->db->mark_expired_sent($timer->{timer_id});
            $result->{expiry_sent}++;
        } else {
            print "✗ Failed to send expiry email for timer $timer->{timer_id}\n";
        }
    }
    
    $c->render(json => $result);
}

1;
