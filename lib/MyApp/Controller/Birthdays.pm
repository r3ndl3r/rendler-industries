# /lib/MyApp/Controller/Birthdays.pm

package MyApp::Controller::Birthdays;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for the Birthday Calendar feature.
#
# Features:
#   - Automated countdown to upcoming birthdays.
#   - Zodiac and Chinese Zodiac metadata enrichment.
#   - Full AJAX CRUD operations for administrative management.
#
# Integration Points:
#   - Uses DB::Birthdays for data persistence.
#   - Restricted administrative actions via backend is_admin checks.
#   - Standardized JSON responses for interface synchronization.

# Renders the birthday interface.
# Route: GET /birthdays
# Returns: Template (birthdays.html.ep)
sub index {
    my $c = shift;
    
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family;

    $c->render('birthdays');
}

# Returns all birthday records with enriched metadata.
# Route: GET /birthdays/api/state
# Returns: JSON object { birthdays, is_admin, success }
sub api_state {
    my $c = shift;

    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in && $c->is_family;

    my @birthdays = $c->db->get_all_birthdays();
    
    # Enrich with zodiac emojis and formatted dates
    foreach my $b (@birthdays) {
        my ($year, $month, $day) = split('-', $b->{birth_date});
        $b->{formatted_date} = sprintf("%02d/%02d/%04d", $day, $month, $year);
        $b->{zodiac} = $c->zodiac_emoji($month, $day);
        $b->{chinese_zodiac} = $c->chinese_zodiac_emoji($year);
    }
    
    $c->render(json => { 
        success   => 1, 
        birthdays => \@birthdays,
        is_admin  => $c->is_admin ? 1 : 0
    });
}

# Processes the creation of a new birthday record.
# Route: POST /birthdays/api/add
# Returns: JSON object { success, message/error }
sub api_add {
    my $c = shift;

    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in && $c->is_admin;

    my $name       = trim($c->param('name') // '');
    my $birth_date = trim($c->param('birth_date') // '');
    
    unless ($name && $birth_date) {
        return $c->render(json => { success => 0, error => 'Name and Date are required' });
    }
    
    eval { 
        $c->db->add_birthday($name, $birth_date); 
    };
    if ($@) {
        $c->app->log->error("Failed to add birthday: $@");
        return $c->render(json => { success => 0, error => "Database error occurred" });
    }
    
    $c->render(json => { success => 1, message => "Birthday added for $name" });
}

# Updates an existing birthday record.
# Route: POST /birthdays/api/edit/:id
# Returns: JSON object { success, message/error }
sub api_edit {
    my $c = shift;

    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in && $c->is_admin;

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
        $c->app->log->error("Failed to update birthday $id: $@");
        return $c->render(json => { success => 0, error => "Database update failed" });
    }
    
    $c->render(json => { success => 1, message => "Birthday updated for $name" });
}

# Permanently removes a birthday record.
# Route: POST /birthdays/api/delete/:id
# Returns: JSON object { success, message/error }
sub api_delete {
    my $c = shift;

    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in && $c->is_admin;

    my $id = $c->param('id');
    
    eval { 
        $c->db->delete_birthday($id); 
    };
    if ($@) {
        $c->app->log->error("Failed to delete birthday $id: $@");
        return $c->render(json => { success => 0, error => "Database deletion failed" });
    }
    
    $c->render(json => { success => 1, message => "Birthday record removed" });
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{family}->get('/birthdays')->to('birthdays#index');
    $r->{family}->get('/birthdays/api/state')->to('birthdays#api_state');
    $r->{admin}->post('/birthdays/api/add')->to('birthdays#api_add');
    $r->{admin}->post('/birthdays/api/edit/:id')->to('birthdays#api_edit');
    $r->{admin}->post('/birthdays/api/delete/:id')->to('birthdays#api_delete');
}

1;
