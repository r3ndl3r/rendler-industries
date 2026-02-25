# /lib/MyApp/Controller/Chess.pm

package MyApp::Controller::Chess;
use Mojo::Base 'Mojolicious::Controller';

# Controller for the Chess Online multiplayer game.
# Handles game routing, lobby management, and move processing.
#
# Features:
#   - Lobby management (Waiting games list).
#   - Active game tracking and state polling.
#   - Move processing with validation delegation.
#   - Draw offer and response logic.
#
# Integration Points:
#   - DB::Chess for persistence and move validation.
#   - Router: Restricted to authenticated users via bridge.

# Renders the chess lobby showing available games to join.
# Route: GET /chess/lobby
# Parameters: None
# Returns:
#   Rendered HTML template 'chess/lobby' with waiting and active games.
sub lobby {
    my $c = shift;
    my $user_id = $c->current_user_id;
    my $lobbies = $c->db->get_open_chess_lobbies();
    my $user_games = $c->db->get_user_chess_games($user_id);
    
    # Filter out user's own games from the general "Open Games" list
    my @filtered_lobbies = grep { $_->{player1_id} != $user_id } @$lobbies;
    
    $c->render('chess/lobby', 
        lobbies => \@filtered_lobbies,
        user_games => $user_games
    );
}

# API Endpoint: Returns current lobby status as JSON.
# Route: GET /chess/lobby_status
# Parameters: None
# Returns:
#   JSON object { open_games, user_games }
sub lobby_status {
    my $c = shift;
    my $user_id = $c->current_user_id;
    my $lobbies = $c->db->get_open_chess_lobbies();
    my $user_games = $c->db->get_user_chess_games($user_id);
    
    my @filtered_lobbies = grep { $_->{player1_id} != $user_id } @$lobbies;
    
    $c->render(json => {
        open_games => \@filtered_lobbies,
        user_games => $user_games
    });
}

# Creates a new chess game session.
# Route: POST /chess/create
# Parameters: None
# Returns:
#   Redirects to the play screen for the new game ID.
sub create {
    my $c = shift;
    my $uid = $c->current_user_id;
    my $game_id = $c->db->create_chess_lobby($uid);
    $c->redirect_to("/chess/play/$game_id");
}

# Joins an existing chess lobby as player 2.
# Route: POST /chess/join
# Parameters:
#   - game_id : Unique ID of the lobby.
# Returns:
#   Redirects to play screen on success.
sub join_game {
    my $c = shift;
    my $uid = $c->current_user_id;
    my $game_id = $c->param('game_id');
    
    if ($c->db->join_chess_lobby($game_id, $uid)) {
        $c->redirect_to("/chess/play/$game_id");
    } else {
        $c->flash(error => 'Could not join game.');
        $c->redirect_to('/chess/lobby');
    }
}

# Renders the chess board and game interface.
# Route: GET /chess/play/:id
# Parameters:
#   - id : Game session ID.
# Returns:
#   Rendered template 'chess/chess'.
sub play {
    my $c = shift;
    my $game_id = $c->param('id');
    my $user_id = $c->current_user_id;
    
    my $game = $c->db->get_chess_game($game_id);
    return $c->render_error('Game not found', 404) unless $game;
    
    # Verify participation
    return $c->render('noperm') unless $game->{player1_id} == $user_id || $game->{player2_id} == $user_id;
    
    $c->render('chess/chess', game => $game, game_id => $game_id);
}

# Processes a player move.
# Route: POST /chess/move
# Parameters:
#   - game_id : Session ID.
#   - move    : SAN or LAN move string.
# Returns:
#   JSON success/error status.
sub move {
    my $c = shift;
    my $game_id = $c->param('game_id');
    my $move = $c->param('move');
    my $user_id = $c->current_user_id;
    
    my ($success, $error) = $c->db->process_chess_move($game_id, $user_id, $move);
    
    if ($success) {
        $c->render(json => { success => 1 });
    } else {
        $c->render(json => { success => 0, error => $error });
    }
}

# API Endpoint: Returns the latest game state for long-polling.
# Route: GET /chess/status/:id
# Parameters:
#   - id : Game session ID.
# Returns:
#   JSON object with full game state.
sub poll_status {
    my $c = shift;
    my $game_id = $c->param('id');
    my $game = $c->db->get_chess_game($game_id);
    $c->render(json => $game);
}

# Issues a draw offer to the opponent.
# Route: POST /chess/offer_draw/:id
# Parameters:
#   - id : Game session ID.
sub offer_draw {
    my $c = shift;
    my $game_id = $c->param('id');
    my $user_id = $c->current_user_id;
    
    if ($c->db->offer_chess_draw($game_id, $user_id)) {
        $c->render(json => { success => 1 });
    } else {
        $c->render(json => { success => 0 });
    }
}

# Responds to a pending draw offer.
# Route: POST /chess/respond_draw/:id
# Parameters:
#   - id     : Game session ID.
#   - accept : Boolean (1 to accept).
sub respond_draw {
    my $c = shift;
    my $game_id = $c->param('id');
    my $accept = $c->param('accept');
    my $user_id = $c->current_user_id;
    
    if ($c->db->respond_chess_draw($game_id, $user_id, $accept)) {
        $c->render(json => { success => 1 });
    } else {
        $c->render(json => { success => 0 });
    }
}

1;
