# /lib/MyApp/Controller/Reminders.pm

package MyApp::Controller::Reminders;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for Managing Recurring Reminders and Notification Rules.
# Features:
#   - CRUD operations for weekly recurring tasks
#   - Multi-recipient selection for targeted notifications
#   - Real-time status toggling (Pause/Resume)
#   - Integration with Discord and Email dispatch systems
# Integration points:
#   - Restricted to administrators via router bridge
#   - Depends on DB::Reminders for data persistence
#   - Coordinates with global maintenance API for execution triggers

# Renders the main reminders management dashboard.
# Route: GET /reminders
# Parameters: None
# Returns:
#   Rendered HTML template 'reminders' with:
#     - reminders: List of all configured rules
#     - recipients: List of approved users for assignment
sub index {
    my $c = shift;
    
    # Retrieve all reminder rules and recipient mapping
    my $reminders = $c->db->get_all_reminders();
    
    # Retrieve roster for recipient selection
    my $users     = $c->db->get_all_users();
    
    # Filter for approved family/admin users only for selection pool
    my @eligible_recipients = grep { 
        ($_->{status} // '') eq 'approved' && 
        (($_->{is_family} // 0) == 1 || ($_->{is_admin} // 0) == 1)
    } @$users;

    $c->render('reminders', 
        reminders  => $reminders,
        recipients => \@eligible_recipients
    );
}

# Processes the creation of a new recurring reminder rule.
# Route: POST /reminders/add
# Parameters:
#   title         : Main heading for the reminder
#   description   : Detailed notes/context (Optional)
#   reminder_time : Target trigger time (HH:MM)
#   days[]        : Array of active day numbers (1=Mon, 7=Sun)
#   recipients[]  : Array of target User IDs
# Returns:
#   Redirects to '/reminders' on success
#   Renders error on validation or database failure
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
        return $c->render_error("Title, Time, Days, and Recipients are all required.");
    }
    
    # Standardize time format to HH:MM:SS for database compatibility
    $time .= ":00" if $time =~ /^\d{2}:\d{2}$/;
    
    my $days_str = join(',', @days);
    my $user_id = $c->current_user_id;
    
    eval {
        $c->db->create_reminder($title, $desc, $days_str, $time, $user_id, \@uids);
    };
    
    if ($@) {
        $c->app->log->error("Failed to create reminder: $@");
        return $c->render_error("Database error while creating reminder.");
    }
    
    $c->flash(message => "Reminder '$title' created successfully.");
    $c->redirect_to('/reminders');
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
# Returns:
#   Redirects to '/reminders'
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
        return $c->render_error("All required fields must be provided.");
    }
    
    # Standardize time format
    $time .= ":00" if $time =~ /^\d{2}:\d{2}$/;
    
    my $days_str = join(',', @days);
    
    eval {
        $c->db->update_reminder($id, $title, $desc, $days_str, $time, \@uids);
    };
    
    if ($@) {
        $c->app->log->error("Failed to update reminder $id: $@");
        return $c->render_error("Database error while updating reminder.");
    }
    
    $c->flash(message => "Reminder '$title' updated successfully.");
    $c->redirect_to('/reminders');
}

# Permanently deletes a reminder rule and its mappings.
# Route: POST /reminders/delete/:id
# Parameters:
#   id : Unique Reminder ID
# Returns:
#   Redirects to '/reminders'
sub delete {
    my $c = shift;
    my $id = $c->param('id');
    
    # Validate ID format before processing
    if ($id && $id =~ /^\d+$/) {
        $c->db->delete_reminder($id);
    }
    
    $c->redirect_to('/reminders');
}

# Toggles the operational status of a reminder rule via AJAX.
# Route: POST /reminders/toggle/:id
# Parameters:
#   id     : Unique Reminder ID
#   active : Target status (1 or 0)
# Returns:
#   JSON object { success => 1/0 }
sub toggle {
    my $c = shift;
    my $id = $c->param('id');
    my $active = $c->param('active') ? 1 : 0;
    
    if ($id && $id =~ /^\d+$/) {
        $c->db->toggle_reminder_status($id, $active);
        return $c->render(json => { success => 1 });
    }
    
    return $c->render(json => { success => 0, error => 'Invalid parameters' });
}

1;
