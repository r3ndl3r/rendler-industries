# /lib/MyApp/Controller/Connect4.pm

package MyApp::Controller::Connect4;
use Mojo::Base 'Mojolicious::Controller';

# Controller for the Connect 4 multiplayer interface.
#
# Features:
#   - Unified application entry point (/connect4).
#   - JSON APIs for lobby discovery and active game synchronization.
#   - Real-time move processing with gravity-based placement.
#   - Session lifecycle management (Restart/Cleanup).
#
# Integration Points:
#   - Depends on DB::Connect4 for all game state persistence.
#   - Restricted to authenticated users via global session bridge.

# Entry Point: Serves the base skeleton for both lobby and active games.
# Route: GET /connect4 and GET /connect4/play/:id
# Returns: Template (connect4.html.ep)
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render('connect4');
}

# API Endpoint: Retrieves current lobby status for matchmaking.
# Route: GET /connect4/api/lobby
# Returns: JSON object { success, open_games, user_games }
sub api_lobby {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in;
        
    my $user_id = $c->current_user_id;
    my $lobbies = $c->db->get_open_connect4_lobbies();
    
    # Filter out games where the user is already player1
    my @filtered_lobbies = grep { $_->{player1_id} != $user_id } @$lobbies;
    
    # Connect4 doesn't have a dedicated "get_user_games" in DB yet, 
    # but we can filter from all or add it. Let's assume we want to show 
    # their active games for resumption.
    my $user_games = $c->db->get_user_connect4_games($user_id);
    
    $c->render(json => {
        success => 1,
        open_games => \@filtered_lobbies,
        user_games => $user_games
    });
}

# API Endpoint: Initializes a fresh game session.
# Route: POST /connect4/api/create
# Returns: JSON object { success, game_id }
sub api_create {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in;

    my $uid = $c->current_user_id;
    my $game_id = $c->db->create_connect4_lobby($uid);

    $c->render(json => { success => 1, game_id => $game_id });
}

# API Endpoint: Registers the current user as the second participant.
# Route: POST /connect4/api/join
# Returns: JSON object { success, game_id, error }
sub api_join {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in;

    my $uid = $c->current_user_id;
    my $data = $c->req->json || $c->req->params->to_hash;
    my $game_id = $data->{id};

    # Transform serialized "null", "NaN", or empty strings to valid integers.
    $game_id = 0 if !defined $game_id || $game_id eq 'null' || $game_id eq 'NaN' || $game_id eq '';

    my $success = $c->db->join_connect4_lobby($game_id, $uid);

    if ($success) {
        $c->render(json => { success => 1, game_id => $game_id });
    } else {
        $c->render(json => { success => 0, error => "Could not join game" });
    }
}

# API Endpoint: Retrieves full game metadata and board state.
# Route: GET /connect4/api/game/:id
# Returns: JSON object { success, game, error }
sub api_game {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in;
        
    my $game_id = $c->param('id');
    my $uid = $c->current_user_id;
    
    my $game = $c->db->get_connect4_game_state($game_id);
    unless ($game) {
        return $c->render(json => { success => 0, error => 'Game not found' }, status => 404);
    }

    # Resolve participant roles
    my $player_role = 0; 
    if ($game->{player1_id} == $uid) { $player_role = 1; }
    elsif ($game->{player2_id} && $game->{player2_id} == $uid) { $player_role = 2; }

    $c->render(json => {
        success     => 1,
        game        => {
            id          => $game->{id},
            board       => $game->{board},
            turn        => $game->{current_turn},
            status      => $game->{status},
            winner      => $game->{winner_id},
            player_role => $player_role,
            p1_id       => $game->{player1_id},
            p2_id       => $game->{player2_id},
            p1_name     => $game->{p1_name} // 'Player 1',
            p2_name     => $game->{p2_name} // 'Player 2'
        }
    });
}

# API Endpoint: Processes a column selection.
# Route: POST /connect4/api/move
# Returns: JSON object { success, error }
sub api_move {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in;
        
    my $data = $c->req->json || $c->req->params->to_hash;
    my $game_id = $data->{id};
    my $col = $data->{col};
    my $uid = $c->current_user_id;
    
    # Transform serialized "null", "NaN", or empty strings to valid integers or undef.
    $game_id = 0 if !defined $game_id || $game_id eq 'null' || $game_id eq 'NaN' || $game_id eq '';
    $col = 0 if !defined $col || $col eq 'null' || $col eq 'NaN' || $col eq '';

    my $success = $c->db->make_connect4_move($game_id, $uid, $col);
    $c->render(json => { success => $success });
}

# API Endpoint: Resets the game board for a consecutive round.
# Route: POST /connect4/api/restart
# Returns: JSON object { success, error }
sub api_restart {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in;
        
    my $data = $c->req->json || $c->req->params->to_hash;
    my $game_id = $data->{id};
    
    # Transform serialized "null", "NaN", or empty strings to valid integers.
    $game_id = 0 if !defined $game_id || $game_id eq 'null' || $game_id eq 'NaN' || $game_id eq '';

    my $success = $c->db->reset_connect4_game($game_id);
    
    $c->render(json => { success => $success });
}

1;
