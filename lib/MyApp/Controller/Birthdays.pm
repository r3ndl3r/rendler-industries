# /lib/MyApp/Controller/Birthdays.pm

package MyApp::Controller::Birthdays;
use Mojo::Base 'Mojolicious::Controller';

# Controller for the Birthday Calendar feature.
# Features:
#   - Public listing of upcoming birthdays
#   - Administrative management (CRUD operations)
# Integration points:
#   - Depends on authentication context
#   - Enforces Admin-only access for modification actions
#   - Uses DB::Birthdays helper for persistence

# Renders the main birthday list for general users.
# Route: GET /birthdays
# Parameters: None
# Returns:
#   Rendered HTML template 'birthdays/birthdays' with all records
sub index {
    my $c = shift;
    
    # Fetch all records to display
    my @birthdays = $c->db->get_all_birthdays();
    $c->render('birthdays/birthdays', birthdays => \@birthdays);
}

# Renders the administrative management interface.
# Route: GET /birthdays/manage
# Parameters: None
# Returns:
#   Rendered HTML template 'birthdays/manage' if Admin
#   'noperm' template if not Admin
sub manage {
    my $c = shift;
    
    # Fetch records for editing table
    my @birthdays = $c->db->get_all_birthdays();
    $c->render('birthdays/manage', birthdays => \@birthdays);
}

# Adds a new birthday record.
# Route: POST /birthdays/add
# Parameters:
#   name       : Name of the person
#   birth_date : Date string (YYYY-MM-DD format)
#   emoji      : Optional emoji icon (Defaults to '🎂')
# Returns:
#   Redirects to management page on success
sub add {
    my $c = shift;
    my $name = $c->param('name');
    my $birth_date = $c->param('birth_date');
    my $emoji = $c->param('emoji') || '🎂';
    
    # Persist new record
    $c->db->add_birthday($name, $birth_date, $emoji);
    $c->redirect_to('/birthdays/manage');
}

# Updates an existing birthday record.
# Route: POST /birthdays/edit
# Parameters:
#   id         : Unique ID of the record
#   name       : New name
#   birth_date : New date string
#   emoji      : New emoji icon
# Returns:
#   Redirects to management page on success
sub edit {
    my $c = shift;
    my $id = $c->param('id');
    my $name = $c->param('name');
    my $birth_date = $c->param('birth_date');
    my $emoji = $c->param('emoji');
    
    # Update record details
    $c->db->update_birthday($id, $name, $birth_date, $emoji);
    $c->redirect_to('/birthdays/manage');
}

# Permanently deletes a birthday record.
# Route: POST /birthdays/delete
# Parameters:
#   id : Unique ID of the record to remove
# Returns:
#   Redirects to management page on success
sub delete {
    my $c = shift;
    my $id = $c->param('id');
    
    # Execute deletion
    $c->db->delete_birthday($id);
    $c->redirect_to('/birthdays/manage');
}

1;