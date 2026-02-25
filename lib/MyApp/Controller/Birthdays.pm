# /lib/MyApp/Controller/Birthdays.pm

package MyApp::Controller::Birthdays;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for the Birthday Calendar feature.
# Features:
#   - Automated countdown to upcoming birthdays
#   - Zodiac and Chinese Zodiac metadata enrichment
#   - Full AJAX CRUD operations for administrative management
# Integration points:
#   - Uses DB::Birthdays for data persistence
#   - Restricted administrative actions via backend is_admin checks
#   - Standardized JSON responses for SPA integration

# Renders the main birthdays dashboard.
# Route: GET /birthdays
# Parameters: None
# Returns:
#   Rendered HTML template 'birthdays' (SPA container)
sub index {
    my $c = shift;
    $c->render('birthdays');
}

# Returns all birthday records with enriched metadata.
# Route: GET /birthdays/api/data
# Parameters: None
# Returns:
#   JSON object containing:
#     - success   : Boolean status
#     - birthdays : Array of records with zodiac and formatted dates
#     - is_admin  : Permission flag for UI toggles
sub api_data {
    my $c = shift;
    my @birthdays = $c->db->get_all_birthdays();
    
    # Enrich with zodiac emojis and formatted dates
    foreach my $b (@birthdays) {
        my ($year, $month, $day) = split('-', $b->{birth_date});
        $b->{formatted_date} = sprintf("%02d/%02d/%04d", $day, $month, $year);
        $b->{zodiac} = Tools::get_zodiac_emoji($month, $day);
        $b->{chinese_zodiac} = Tools::get_chinese_zodiac_emoji($year);
    }
    
    $c->render(json => { 
        success   => 1, 
        birthdays => \@birthdays,
        is_admin  => $c->is_admin ? 1 : 0
    });
}

# Processes the creation of a new birthday record.
# Route: POST /birthdays/add
# Parameters:
#   name       : Name of the individual
#   birth_date : ISO date string (YYYY-MM-DD)
# Returns:
#   JSON object { success, message/error }
sub add {
    my $c = shift;
    
    # Enforce administrative permissions
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $name       = trim($c->param('name') // '');
    my $birth_date = trim($c->param('birth_date') // '');
    
    # Validate required payload
    unless ($name && $birth_date) {
        return $c->render(json => { success => 0, error => 'Name and Date are required' });
    }
    
    eval {
        $c->db->add_birthday($name, $birth_date);
    };
    
    if ($@) {
        $c->app->log->error("Birthday creation failed: $@");
        return $c->render(json => { success => 0, error => "Database error occurred" });
    }
    
    $c->render(json => { success => 1, message => "Birthday added for $name" });
}

# Updates an existing birthday record.
# Route: POST /birthdays/edit/:id
# Parameters:
#   id         : Target record ID
#   name       : Updated name
#   birth_date : Updated ISO date string
# Returns:
#   JSON object { success, message/error }
sub edit {
    my $c = shift;
    
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $id         = $c->param('id');
    my $name       = trim($c->param('name') // '');
    my $birth_date = trim($c->param('birth_date') // '');
    
    unless ($id && $name && $birth_date) {
        return $c->render(json => { success => 0, error => 'All fields are required' });
    }
    
    eval {
        $c->db->update_birthday($id, $name, $birth_date);
    };
    
    if ($@) {
        $c->app->log->error("Birthday update failed for ID $id: $@");
        return $c->render(json => { success => 0, error => "Database update failed" });
    }
    
    $c->render(json => { success => 1, message => "Birthday updated for $name" });
}

# Permanently removes a birthday record.
# Route: POST /birthdays/delete/:id
# Parameters:
#   id : Unique record ID
# Returns:
#   JSON object { success, message/error }
sub delete {
    my $c = shift;
    
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $id = $c->param('id');
    
    eval {
        $c->db->delete_birthday($id);
    };
    
    if ($@) {
        $c->app->log->error("Birthday deletion failed for ID $id: $@");
        return $c->render(json => { success => 0, error => "Database deletion failed" });
    }
    
    $c->render(json => { success => 1, message => "Birthday record removed" });
}

1;
