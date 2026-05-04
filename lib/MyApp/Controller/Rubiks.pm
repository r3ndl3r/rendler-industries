# /lib/MyApp/Controller/Rubiks.pm

package MyApp::Controller::Rubiks;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for the Rubik's Moves Generator and Algorithm Library.
#
# Features:
#   - 2D grid rendering of algorithm sequences.
#   - Global algorithm storage for family members.
#   - Responsive, glassmorphism-based UI.

# Registers routes for the Rubiks module.
sub register_routes {
    my ($class, $bridges) = @_;
    my $family = $bridges->{family};

    $family->get('/rubiks')->to('rubiks#index');
    $family->get('/rubiks/api/state')->to('rubiks#api_state');
    $family->post('/rubiks/api/save')->to('rubiks#api_save');
    $family->post('/rubiks/api/delete/:id')->to('rubiks#api_delete');
}

# Renders the primary interface.
# Route: GET /rubiks
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render('rubiks');
}

# API Endpoint: Returns the current state (saved algorithms).
# Route: GET /rubiks/api/state
sub api_state {
    my $c = shift;

    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_logged_in;

    my $algorithms = $c->db->get_all_algorithms();

    $c->render(json => {
        success    => 1,
        algorithms => $algorithms,
    });
}

# API Endpoint: Saves or updates an algorithm.
# Route: POST /rubiks/api/save
sub api_save {
    my $c = shift;

    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_logged_in;

    my $id       = $c->param('id');
    my $name     = trim($c->param('name') // '');
    my $sequence = trim($c->param('sequence') // '');
    my $category = trim($c->param('category') // 'General');

    $c->app->log->debug("Rubiks Save Request: ID=$id, Name=$name, Seq=$sequence, User=" . $c->current_user_id);

    unless (length($name) && length($sequence)) {
        $c->app->log->warn("Rubiks Save Blocked: Missing name or sequence");
        return $c->render(json => { success => 0, error => 'Name and sequence are required' });
    }

    my $rows;
    eval {
        if ($id) {
            # Update existing
            $rows = $c->db->update_algorithm($id, $name, $sequence, $category, $c->current_user_id);
        } else {
            # Create new
            $rows = $c->db->create_algorithm($name, $sequence, $category, $c->current_user_id);
        }
    };

    if ($@ || !defined $rows || $rows eq '0E0') {
        $c->app->log->error("Rubiks Save Failed: " . ($@ || "No rows affected (unauthorized or missing ID)"));
        return $c->render(json => { success => 0, error => 'Save failed: record not found or unauthorized' });
    }

    $c->render(json => { success => 1, message => 'Algorithm saved' });
}

# API Endpoint: Deletes an algorithm.
# Route: POST /rubiks/api/delete/:id
sub api_delete {
    my $c = shift;

    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_logged_in;

    my $id = $c->param('id');
    my $rows;

    eval {
        $rows = $c->db->delete_algorithm($id, $c->current_user_id);
    };

    if ($@ || !$rows || $rows eq '0E0') {
        $c->app->log->error("Rubiks Delete Failed: " . ($@ || "Record not found or unauthorized"));
        return $c->render(json => { success => 0, error => 'Delete failed: record not found or unauthorized' });
    }

    $c->render(json => { success => 1, message => 'Algorithm deleted' });
}

1;
