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
    $family->get('/rubiks/solve')->to('rubiks#solve');
    $family->get('/rubiks/api/state')->to('rubiks#api_state');
    $family->post('/rubiks/api/save')->to('rubiks#api_save');
    $family->post('/rubiks/api/delete/:id')->to('rubiks#api_delete');
    $family->get('/rubiks/api/solves')->to('rubiks#api_solves');
    $family->post('/rubiks/api/solves/save')->to('rubiks#api_save_solve');
    $family->post('/rubiks/api/solves/delete/:id')->to('rubiks#api_delete_solve');
    $family->post('/rubiks/api/solves/reassign/:id')->to('rubiks#api_reassign_solve');
}

# Renders the primary interface.
# Route: GET /rubiks
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render('rubiks');
}

# Renders the personal stopwatch and statistics interface.
# Route: GET /rubiks/solve
sub solve {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render('rubiks/solve');
}

# API Endpoint: Returns the current state (saved algorithms).
# Route: GET /rubiks/api/state
sub api_state {
    my $c = shift;

    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_logged_in;

    my $algorithms = $c->db->get_all_algorithms();
    my $solves     = $c->db->get_rubiks_solves($c->current_user_id);

    $c->render(json => {
        success    => 1,
        algorithms => $algorithms,
        solves     => $solves,
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

# API Endpoint: Returns solve history for the current user.
# Route: GET /rubiks/api/solves
sub api_solves {
    my $c = shift;

    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_logged_in;

    my $solves = $c->db->get_rubiks_solves($c->current_user_id);
    $c->render(json => { success => 1, solves => $solves });
}

# API Endpoint: Records a timed solve for the current user.
# Route: POST /rubiks/api/solves/save
sub api_save_solve {
    my $c = shift;

    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_logged_in;

    my $cube_type   = trim($c->param('cube_type') // '');
    my $duration_ms = int($c->param('duration_ms') // 0);

    unless ($cube_type =~ /^(?:3x3|4x4)$/) {
        return $c->render(json => { success => 0, error => 'Cube type must be 3x3 or 4x4' });
    }

    unless ($duration_ms >= 500 && $duration_ms <= 24 * 60 * 60 * 1000) {
        return $c->render(json => { success => 0, error => 'Solve duration is out of range' });
    }

    eval {
        $c->db->create_rubiks_solve($c->current_user_id, $cube_type, $duration_ms);
    };

    if ($@) {
        $c->app->log->error("Rubiks Solve Save Failed: $@");
        return $c->render(json => { success => 0, error => 'Save failed' });
    }

    my $solves = $c->db->get_rubiks_solves($c->current_user_id);
    $c->render(json => { success => 1, message => 'Solve recorded', solves => $solves });
}

# API Endpoint: Deletes a timed solve owned by the current user.
# Route: POST /rubiks/api/solves/delete/:id
sub api_delete_solve {
    my $c = shift;

    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_logged_in;

    my $id = $c->param('id');
    my $rows;
    eval {
        $rows = $c->db->delete_rubiks_solve($id, $c->current_user_id);
    };

    if ($@ || !$rows || $rows eq '0E0') {
        $c->app->log->error("Rubiks Solve Delete Failed: " . ($@ || "Record not found or unauthorized"));
        return $c->render(json => { success => 0, error => 'Delete failed: record not found or unauthorized' });
    }

    my $solves = $c->db->get_rubiks_solves($c->current_user_id);
    $c->render(json => { success => 1, message => 'Solve deleted', solves => $solves });
}

# API Endpoint: Reassigns the cube type of a timed solve owned by the current user.
# Route: POST /rubiks/api/solves/reassign/:id
sub api_reassign_solve {
    my $c = shift;

    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_logged_in;

    my $id = $c->param('id');
    my $rows;
    eval {
        $rows = $c->db->reassign_rubiks_solve_cube_type($id, $c->current_user_id);
    };

    if ($@ || !$rows || $rows eq '0E0') {
        $c->app->log->error("Rubiks Solve Reassign Failed: " . ($@ || "Record not found or unauthorized"));
        return $c->render(json => { success => 0, error => 'Reassign failed: record not found or unauthorized' });
    }

    my $solves = $c->db->get_rubiks_solves($c->current_user_id);
    $c->render(json => { success => 1, message => 'Cube type updated', solves => $solves });
}

1;
