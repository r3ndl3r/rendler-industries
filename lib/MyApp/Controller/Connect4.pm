# /lib/MyApp/Controller/Connect4.pm

package MyApp::Controller::Connect4;
use Mojo::Base 'Mojolicious::Controller';

# Controller for the Connect 4 Online multiplayer game.
# Features:
#   - Lobby management (List, Create, Join)
#   - Game interface rendering with state synchronization
#   - AJAX-based move processing
# Integration points:
#   - Uses DB::Connect4 helper for game logic and state persistence
#   - Restricted to authenticated users via router bridge

# Renders the lobby list showing waiting games.
# Route: GET /connect4/lobby
# Parameters: None
# Returns:
#   Rendered HTML template 'connect4/lobby' with list of open games
sub lobby {
    my $c = shift;
    my $lobbies = $c->db->get_open_connect4_lobbies();
    $c->render('connect4/lobby', lobbies => $lobbies);
}

# Initializes a new game session as the host.
# Route: GET /connect4/create
# Parameters: None
# Returns:
#   Redirects to the play screen for the new game ID
sub create {
    my $c = shift;
    my $uid = $c->current_user_id;
    my $game_id = $c->db->create_connect4_lobby($uid);
    $c->redirect_to("/connect4/play/$game_id");
}

# Adds the current user to an existing lobby as player 2.
# Route: POST /connect4/join
# Parameters:
#   id : Unique Game ID to join
# Returns:
#   Redirects to play screen on success
#   Redirects to lobby with error flash on failure
sub join {
    my $c = shift;
    my $uid = $c->current_user_id;
    my $game_id = $c->param('id');
    
    if ($c->db->join_connect4_lobby($game_id, $uid)) {
        $c->redirect_to("/connect4/play/$game_id");
    } else {
        $c->flash(error => "Could not join game (It might be full or closed).");
        $c->redirect_to('/connect4/lobby');
    }
}

# Renders the main game board or returns JSON state for polling.
# Route: GET /connect4/play/:id
# Parameters:
#   id : Unique Game ID
# Returns:
#   Rendered HTML template 'connect4/connect4' (Standard request)
#   JSON object { board, turn, status, winner, player_role, ... } (AJAX request)
sub play {
    my $c = shift;
    my $game_id = $c->param('id');
    my $uid = $c->current_user_id;
    
    my $game = $c->db->get_connect4_game_state($game_id);
    return $c->redirect_to('/connect4/lobby') unless $game;

    # Identify Player Roles
    # 0 = Spectator, 1 = Host, 2 = Joiner
    my $player_role = 0; 
    if ($game->{player1_id} == $uid) { $player_role = 1; }
    elsif ($game->{player2_id} && $game->{player2_id} == $uid) { $player_role = 2; }

    # API Mode: Return JSON for AJAX polling
    if ($c->req->headers->header('X-Requested-With')) {
        return $c->render(json => {
            board       => $game->{board},
            turn        => $game->{current_turn},
            status      => $game->{status},
            winner      => $game->{winner_id},
            player_role => $player_role,
            p1_id       => $game->{player1_id},
            p2_id       => $game->{player2_id},
            p1_name     => $game->{p1_name} // 'Player 1',
            p2_name     => $game->{p2_name} // 'Player 2'
        });
    }

    $c->render('connect4/connect4', game => $game, my_id => $uid, player_role => $player_role);
}

# Processes a player's attempt to drop a disc into a column.
# Route: POST /connect4/move
# Parameters:
#   id  : Unique Game ID
#   col : Column index (0-6)
# Returns:
#   JSON object { success => 1/0 }
sub move {
    my $c = shift;
    my $game_id = $c->param('id');
    my $col = $c->param('col');
    my $uid = $c->current_user_id;
    
    my $success = $c->db->make_connect4_move($game_id, $uid, $col);
    
    $c->render(json => { success => $success });
}

# Resets the game to start over.
# Route: POST /connect4/restart
# Parameters:
#   id : Unique Game ID
# Returns:
#   JSON success status
sub restart {
    my $c = shift;
    my $game_id = $c->param('id');
    
    # In a real app, you might want to check if the user is part of the game
    # But for now, we allow any participant to trigger the restart
    my $success = $c->db->reset_connect4_game($game_id);
    
    $c->render(json => { success => $success });
}

1;