# /lib/MyApp/Controller/Rubiks.pm

package MyApp::Controller::Rubiks;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim b64_encode);
use Mojo::JSON qw(encode_json);

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

    $family->get('/rubiks')->to('rubiks#stopwatch');
    $family->get('/rubiks/generator')->to('rubiks#index');
    $family->get('/rubiks/stopwatch')->to('rubiks#stopwatch_redirect');
    $family->get('/rubiks/solve')->to('rubiks#solve_redirect');
    $family->get('/rubiks/solver')->to('rubiks#solver');
    $family->get('/rubiks/api/state')->to('rubiks#api_state');
    $family->post('/rubiks/api/save')->to('rubiks#api_save');
    $family->post('/rubiks/api/delete/:id')->to('rubiks#api_delete');
    $family->get('/rubiks/api/solves')->to('rubiks#api_solves');
    $family->get('/rubiks/api/solves/top/:cube_type')->to('rubiks#api_top_solves');
    $family->post('/rubiks/api/solves/save')->to('rubiks#api_save_solve');
    $family->post('/rubiks/api/solves/delete/:id')->to('rubiks#api_delete_solve');
    $family->post('/rubiks/api/solves/reassign/:id')->to('rubiks#api_reassign_solve');
    $family->post('/rubiks/api/solver/upload')->to('rubiks#api_upload_solver');
}

# Renders the moves generator interface.
# Route: GET /rubiks/generator
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render('rubiks');
}

# Renders the personal stopwatch and statistics interface.
# Route: GET /rubiks
sub stopwatch {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render('rubiks/stopwatch');
}

# Redirects legacy stopwatch URLs to the canonical route.
# Routes: GET /rubiks/stopwatch, GET /rubiks/solve
sub stopwatch_redirect {
    my $c = shift;
    return $c->redirect_to('/rubiks');
}

sub solve_redirect {
    my $c = shift;
    return $c->redirect_to('/rubiks');
}

# Renders the AI Solver interface.
# Route: GET /rubiks/solver
sub solver {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render('rubiks/solver');
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

# API Endpoint: Returns the global top 5 fastest solves for a cube type.
# Route: GET /rubiks/api/solves/top/:cube_type
sub api_top_solves {
    my $c = shift;
    my $cube_type = $c->param('cube_type') || '3x3';

    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_logged_in;

    my $top = $c->db->get_top_rubiks_solves($cube_type);
    $c->render(json => { success => 1, top => $top });
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

# API Endpoint: Processes two images of a Rubik's cube and extracts the state via AI.
# Route: POST /rubiks/api/solver/upload
sub api_upload_solver {
    my $c = shift;

    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_logged_in;

    my $img1 = $c->req->upload('image1');
    my $img2 = $c->req->upload('image2');

    unless ($img1 && $img2) {
        return $c->render(json => { success => 0, error => 'Both images are required' });
    }

    my $data1 = $img1->asset->slurp;
    my $data2 = $img2->asset->slurp;

    # Vision prompt for lossy color mapping
    my $requested_dim = $c->param('dimension') || 'auto';
    my $dim = $requested_dim =~ /^[34]$/ ? int($requested_dim) : 'auto';
    my $sticker_goal = $dim eq 'auto'
        ? '54 characters for a 3x3 cube or 96 characters for a 4x4 cube'
        : ($dim * $dim * 6) . " characters for a ${dim}x${dim} cube";
    my $order_goal = $dim eq 'auto'
        ? 'For 3x3 use 9 chars per face. For 4x4 use 16 chars per face.'
        : 'Order: ' . ($dim * $dim) . ' chars for U, then ' . ($dim * $dim) . ' for R, F, D, L, B.';
    my $system_instructions = "You are a lossy computer vision extractor for Rubik's cubes.
Analyze the two provided photos. Photo 1 shows Front (F), Top (U), and Right (R). Photo 2 shows Back (B), Down (D), and Left (L).
First determine whether the photographed cube is 3x3 or 4x4. Then map stickers to a single Kociemba string: $sticker_goal. Return every sticker you can identify.
Faces: U (Top), R (Right), F (Front), D (Down), L (Left), B (Back).
$order_goal
Use '?' for any sticker that is missing, hidden, blurry, uncertain, or not confidently mapped.
Do not reject the entire image because some stickers are unclear. Preserve all visible/certain sticker data.

Only return an 'error' if there is no Rubik's cube data visible at all.
Otherwise return a JSON object with:
- dimension: 3 or 4
- state_string: the lossy state string containing only U,R,F,D,L,B,?
- notes: short human-readable notes about missing or uncertain areas

Return ONLY a JSON object with either the 'state_string' field OR the 'error' field.";

    my @user_parts = (
        { text => "Map stickers from these two photos to a lossy cube state string. Detect dimension 3 or 4. Use '?' for unknown stickers." },
        { inlineData => { mimeType => $img1->headers->content_type // 'image/jpeg', data => b64_encode($data1, '') } },
        { inlineData => { mimeType => $img2->headers->content_type // 'image/jpeg', data => b64_encode($data2, '') } }
    );

    $c->render_later;

    $c->ai_prompt(
        contents => [{ role => 'user', parts => \@user_parts }],
        system   => $system_instructions,
        timeout  => 60,
        response_format => 'application/json',
        app_profile     => 'rubiks'
    )->then(sub {
        my $data = shift;

        if ($data && $data->{candidates} && @{$data->{candidates}}) {
            my $json_text = $data->{candidates}[0]{content}{parts}[0]{text} // '';
            eval {
                my $parsed = $c->ai_decode_json($json_text);
                if ($parsed && $parsed->{error}) {
                    $c->render(json => { success => 0, error => $parsed->{error} });
                } elsif ($parsed && $parsed->{state_string}) {
                    my $state = uc($parsed->{state_string});
                    $state =~ s/[^URFDLB?]/?/g;
                    my $detected_dim = ($parsed->{dimension} // '') =~ /^[34]$/ ? int($parsed->{dimension}) : undef;
                    $detected_dim ||= length($state) > 70 ? 4 : 3;
                    my $stickers = $detected_dim * $detected_dim * 6;
                    $state = substr($state . ('?' x $stickers), 0, $stickers);
                    my $missing = ($state =~ tr/?/?/);
                    $c->render(json => {
                        success => 1,
                        dimension => $detected_dim,
                        state_string => $state,
                        missing_count => $missing,
                        notes => $parsed->{notes} // ''
                    });
                } else {
                    die "Invalid state string format";
                }
            };
            if ($@) {
                $c->render(json => { success => 0, error => "AI returned invalid format. Try clearer photos." });
            }
        } else {
            $c->render(json => { success => 0, error => "AI service returned no analysis." });
        }
    })->catch(sub {
        my $err = shift;
        $c->app->log->error("Rubiks Solver AI error: $err");
        $c->render(json => { success => 0, error => "AI processing timed out or failed." });
    });
}

1;
