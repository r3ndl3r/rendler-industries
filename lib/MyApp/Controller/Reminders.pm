# /lib/MyApp/Controller/Reminders.pm

package MyApp::Controller::Reminders;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for managing recurring reminders and notification rules.
#
# Features:
#   - Synchronized state-driven interface for task awareness.
#   - CRUD operations for weekly recurring tasks via JSON API.
#   - Multi-recipient selection for targeted notifications.
#   - Real-time status toggling with instant reconciliation.
#
# Integration Points:
#   - Depends on DB::Reminders for data persistence.
#   - Coordinates with global maintenance API for execution triggers.
#   - Integrates with Discord and Email dispatch systems.

# Renders the main reminders management dashboard skeleton.
# Route: GET /reminders
# Returns: Template (reminders.html.ep)
sub index {
    my $c = shift;
    
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family;

    $c->render('reminders');
}

# Returns the consolidated state for the module.
# Route: GET /reminders/api/state
# Returns: JSON object { reminders, recipients, is_admin, current_user, success }
sub api_state {
    my $c = shift;
    
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in && $c->is_family;

    my $state = {
        reminders    => $c->db->get_all_reminders(),
        recipients   => $c->db->get_family_users(),
        is_admin     => $c->is_admin ? 1 : 0,
        current_user => $c->session('user') // '',
        success      => 1
    };

    $c->render(json => $state);
}

# Processes the creation of a new recurring reminder rule.
# Route: POST /reminders/api/add
# Returns: JSON object { success, message, error }
sub api_add {
    my $c = shift;
    
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in && $c->is_family;

    my $title = trim($c->param('title') // '');
    my $desc  = trim($c->param('description') // '');
    my $time  = trim($c->param('reminder_time') // '');
    my @days  = $c->every_param('days[]');
    my @uids  = $c->every_param('recipients[]');
    
    # Robust flattening: Ensure we have a list of scalars
    @days = map { ref($_) eq 'ARRAY' ? @$_ : $_ } @days;
    @uids = map { ref($_) eq 'ARRAY' ? @$_ : $_ } @uids;
    
    # Validate required fields
    unless ($title && $time && @days && @uids) {
        return $c->render(json => { success => 0, error => "Title, Time, Days, and Recipients are all required." });
    }
    
    # Standardize time format to HH:MM:SS for database compatibility
    $time .= ":00" if $time =~ /^\d{2}:\d{2}$/;
    
    my $days_str = join(',', @days);
    my $user_id = $c->current_user_id;
    my $is_one_off = $c->param('is_one_off') ? 1 : 0;
    
    eval {
        $c->db->create_reminder($title, $desc, $days_str, $time, $user_id, \@uids, $is_one_off);
    };
    
    if ($@) {
        $c->app->log->error("Failed to create reminder: $@");
        return $c->render(json => { success => 0, error => "Database error while creating reminder." });
    }
    
    return $c->render(json => { success => 1, message => "Reminder '$title' created successfully." });
}

# Processes updates to an existing reminder.
# Route: POST /reminders/api/update/:id
# Returns: JSON object { success, message, error }
sub api_update {
    my $c = shift;
    
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in && $c->is_family;

    my $id    = $c->param('id');
    my $title = trim($c->param('title') // '');
    my $desc  = trim($c->param('description') // '');
    my $time  = trim($c->param('reminder_time') // '');
    my @days  = $c->every_param('days[]');
    my @uids  = $c->every_param('recipients[]');
    
    # Robust flattening
    @days = map { ref($_) eq 'ARRAY' ? @$_ : $_ } @days;
    @uids = map { ref($_) eq 'ARRAY' ? @$_ : $_ } @uids;
    
    unless ($id && $title && $time && @days && @uids) {
        return $c->render(json => { success => 0, error => "All required fields must be provided." });
    }
    
    # Standardize time format
    $time .= ":00" if $time =~ /^\d{2}:\d{2}$/;
    
    my $days_str = join(',', @days);
    my $is_one_off = $c->param('is_one_off') ? 1 : 0;
    
    eval {
        $c->db->update_reminder($id, $title, $desc, $days_str, $time, \@uids, $is_one_off);
    };
    
    if ($@) {
        $c->app->log->error("Failed to update reminder $id: $@");
        return $c->render(json => { success => 0, error => "Database error while updating reminder." });
    }
    
    return $c->render(json => { success => 1, message => "Reminder '$title' updated successfully." });
}

# Permanently removes a reminder rule and its mappings.
# Route: POST /reminders/api/delete/:id
# Returns: JSON object { success, message, error }
sub api_delete {
    my $c = shift;
    
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in && $c->is_family;

    my $id = $c->param('id');
    
    # Validate ID format before processing
    if ($id && $id =~ /^\d+$/) {
        eval {
            $c->db->delete_reminder($id);
        };
        if ($@) {
            $c->app->log->error("Failed to delete reminder $id: $@");
            return $c->render(json => { success => 0, error => "Failed to delete reminder." });
        }
        return $c->render(json => { success => 1, message => "Reminder deleted." });
    }
    
    return $c->render(json => { success => 0, error => "Invalid ID" });
}

# Toggles the operational status of a reminder rule.
# Route: POST /reminders/api/toggle/:id
# Returns: JSON object { success, message, error }
sub api_toggle {
    my $c = shift;
    
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in && $c->is_family;

    my $id = $c->param('id');
    my $active = $c->param('active') ? 1 : 0;
    
    if ($id && $id =~ /^\d+$/) {
        eval {
            $c->db->toggle_reminder_status($id, $active);
        };
        if ($@) {
            $c->app->log->error("Failed to toggle reminder $id status: $@");
            return $c->render(json => { success => 0, error => "Database error" });
        }
        return $c->render(json => { 
            success => 1, 
            message => ($active ? "Reminder resumed" : "Reminder paused") 
        });
    }
    
    return $c->render(json => { success => 0, error => 'Invalid parameters' });
}

# Toggles a specific day for a reminder rule schedule.
# Route: POST /reminders/api/toggle_day
# Returns: JSON object { success, message, error }
sub api_toggle_day {
    my $c = shift;
    
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in && $c->is_family;

    my $id = $c->param('id');
    my $day = $c->param('day');
    my $active = $c->param('active') ? 1 : 0;
    
    if ($id && $id =~ /^\d+$/ && $day && $day =~ /^[1-7]$/) {
        eval {
            $c->db->toggle_reminder_day($id, $day, $active);
        };
        if ($@) {
            $c->app->log->error("Failed to toggle reminder $id day $day: $@");
            return $c->render(json => { success => 0, error => "Database error" });
        }
        return $c->render(json => { success => 1, message => "Schedule updated" });
    }
    
    return $c->render(json => { success => 0, error => 'Invalid parameters' });
}

1;
