# /lib/MyApp/Controller/Reminders.pm

package MyApp::Controller::Reminders;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for managing recurring reminders and notification rules.
# Features:
#   - CRUD operations for weekly recurring tasks
#   - Multi-recipient selection for targeted notifications
#   - Real-time status toggling (Pause/Resume)
#   - Integration with Discord and Email dispatch systems
# Integration points:
#   - Restricted to family/admin members via router bridge
#   - Depends on DB::Reminders for data persistence
#   - Coordinates with global maintenance API for execution triggers

# Renders the main reminders management dashboard skeleton.
# Route: GET /reminders
# Parameters: None
# Returns: Rendered HTML template 'reminders'.
sub index {
    my $c = shift;
    $c->stash(title => 'Manage Reminders');
    $c->render('reminders');
}

# Returns the consolidated state for the module.
# Route: GET /reminders/api/state
# Parameters: None
# Returns: JSON object { reminders, recipients, is_admin, current_user, success }
sub api_state {
    my $c = shift;
    
    my $state = {
        reminders    => $c->db->get_all_reminders(),
        recipients   => [ grep { 
            ($_->{status} // '') eq 'approved' && 
            (($_->{is_family} // 0) == 1 || ($_->{is_admin} // 0) == 1)
        } @{$c->db->get_all_users() || []} ],
        is_admin     => $c->is_admin ? 1 : 0,
        current_user => $c->session('user') // '',
        success      => 1
    };

    $c->render(json => $state);
}

# Processes the creation of a new recurring reminder rule.
# Route: POST /reminders/add
# Parameters:
#   title         : Main heading for the reminder
#   description   : Detailed notes/context (Optional)
#   reminder_time : Target trigger time (HH:MM)
#   days[]        : Array of active day numbers (1=Mon, 7=Sun)
#   recipients[]  : Array of target User IDs
#   is_one_off    : Boolean flag for single-use reminders
# Returns: JSON object { success, message, error }
sub add {
    my $c = shift;
    
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
# Route: POST /reminders/update/:id
# Parameters:
#   id            : Target Reminder ID
#   title         : Updated heading
#   description   : Updated notes
#   reminder_time : Updated trigger time
#   days[]        : Updated active days
#   recipients[]  : Updated target users
#   is_one_off    : Boolean flag
# Returns: JSON object { success, message, error }
sub update {
    my $c = shift;
    
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
# Route: POST /reminders/delete/:id
# Parameters:
#   id : Unique Reminder ID
# Returns: JSON object { success, message, error }
sub delete {
    my $c = shift;
    my $id = $c->param('id');
    
    # Validate ID format before processing
    if ($id && $id =~ /^\d+$/) {
        eval {
            $c->db->delete_reminder($id);
        };
        if ($@) {
            return $c->render(json => { success => 0, error => "Failed to delete reminder." });
        }
        return $c->render(json => { success => 1, message => "Reminder deleted." });
    }
    
    return $c->render(json => { success => 0, error => "Invalid ID" });
}

# Toggles the operational status of a reminder rule.
# Route: POST /reminders/toggle/:id
# Parameters:
#   id     : Unique Reminder ID
#   active : Target status (1 or 0)
# Returns: JSON object { success, message, error }
sub toggle {
    my $c = shift;
    my $id = $c->param('id');
    my $active = $c->param('active') ? 1 : 0;
    
    if ($id && $id =~ /^\d+$/) {
        $c->db->toggle_reminder_status($id, $active);
        return $c->render(json => { 
            success => 1, 
            message => ($active ? "Reminder resumed" : "Reminder paused") 
        });
    }
    
    return $c->render(json => { success => 0, error => 'Invalid parameters' });
}

# Toggles a specific day for a reminder rule schedule.
# Route: POST /reminders/toggle_day
# Parameters:
#   id     : Unique Reminder ID
#   day    : Day number (1-7)
#   active : Target status (1 or 0)
# Returns: JSON object { success, message, error }
sub toggle_day {
    my $c = shift;
    my $id = $c->param('id');
    my $day = $c->param('day');
    my $active = $c->param('active') ? 1 : 0;
    
    if ($id && $id =~ /^\d+$/ && $day && $day =~ /^[1-7]$/) {
        $c->db->toggle_reminder_day($id, $day, $active);
        return $c->render(json => { success => 1, message => "Schedule updated" });
    }
    
    return $c->render(json => { success => 0, error => 'Invalid parameters' });
}

1;
