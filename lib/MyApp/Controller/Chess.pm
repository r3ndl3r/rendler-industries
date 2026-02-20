# /lib/MyApp/Controller/Chess.pm

package MyApp::Controller::Chess;
use Mojo::Base 'Mojolicious::Controller', -signatures;

# Controller for Chess game routing and request handling.
# Delegates database operations to DB::Chess and renders appropriate templates.
# The approach separates lobby management from active gameplay to mirror the Connect 4 architecture.

# Renders the chess lobby showing available games to join.
# Fetches all games currently in 'waiting' status and the user's active games.
# Parameters:
#   $c : Mojolicious::Controller object
# Returns:
#   Renders 'chess/lobby' template with 'lobbies' and 'user_games' arrays
sub lobby ($c) {
    my $user_id = $c->current_user_id;
    my $lobbies = $c->db->get_open_chess_lobbies();
    my $user_games = $c->db->get_user_chess_games($user_id);
    
    # Filter out user's own games from the general "Open Games" list
    # to avoid duplication and encourage joining other people's games.
    my @filtered_lobbies = grep { $_->{player1_id} != $user_id } @$lobbies;
    
    $c->render('chess/lobby', 
        lobbies => \@filtered_lobbies,
        user_games => $user_games
    );
}

# API Endpoint: Returns lobby status (open games and user games) as JSON.
sub lobby_status ($c) {
    my $user_id = $c->current_user_id;
    my $lobbies = $c->db->get_open_chess_lobbies();
    my $user_games = $c->db->get_user_chess_games($user_id);
    
    my @filtered_lobbies = grep { $_->{player1_id} != $user_id } @$lobbies;
    
    $c->render(json => {
        open_games => \@filtered_lobbies,
        user_games => $user_games
    });
}

# Creates a new chess game and redirects the host to the play screen.
# Uses the active session to identify the host player.
# Parameters:
#   $c : Mojolicious::Controller object
# Returns:
#   Redirects to /chess/play/:id
sub create ($c) {
    my $user_id = $c->current_user_id;
    my $game_id = $c->db->create_chess_lobby($user_id);
    $c->redirect_to("/chess/play/$game_id");
}

# Handles a user joining an existing waiting game.
# Validates the join attempt against the database to prevent a host joining their own game.
# Parameters:
#   $c : Mojolicious::Controller object (expects 'id' in POST body)
# Returns:
#   Redirects to /chess/play/:id on success, or back to lobby on failure
sub join_game ($c) {
    my $game_id = $c->param('id');
    my $user_id = $c->current_user_id;
    
    if ($c->db->join_chess_lobby($game_id, $user_id)) {
        $c->redirect_to("/chess/play/$game_id");
    } else {
        $c->redirect_to('/chess/lobby');
    }
}

# Renders the active game board for a specific game ID.
# Verifies the game exists and passes the full game state (including FEN) to the frontend.
# Parameters:
#   $c : Mojolicious::Controller object (expects 'id' in stash via route)
# Returns:
#   Renders 'chess/chess' template with 'game' HashRef, or 404 if not found
sub play ($c) {
    my $game_id = $c->param('id');
    my $game = $c->db->get_chess_game_state($game_id);
    
    return $c->reply->not_found unless $game;
    
    $c->render('chess/chess', game => $game);
}

# Processes an AJAX request for a chess move.
# Because chess move validation (en passant, castling) is highly complex,
# the frontend logic generates the new FEN string, which is then persisted here.
# Parameters:
#   $c : Mojolicious::Controller object (expects JSON payload with game_id, fen, next_turn_id, status, winner_id)
# Returns:
#   JSON response with boolean success status
sub move ($c) {
    my $json = $c->req->json;
    my $game_id = $json->{game_id};
    my $new_fen = $json->{fen};
    my $next_turn_id = $json->{next_turn_id};
    my $status = $json->{status} || 'active';
    my $winner_id = $json->{winner_id};
    my $last_move = $json->{last_move};
    
    my $success = $c->db->update_chess_game_state(
        $game_id, $next_turn_id, $new_fen, $status, $winner_id, $last_move
    );
    
    $c->render(json => { success => $success ? \1 : \0 });
}

# API Endpoint: Returns current game status for frontend polling.
# Returns JSON: { fen, turn, status, winner_id, draw_offered_by, last_move }
sub poll_status ($c) {
    my $game_id = $c->param('id');
    my $game = $c->db->get_chess_game_state($game_id);
    
    return $c->render(json => { error => 'Game not found' }, status => 404) unless $game;
    
    $c->render(json => {
        fen => $game->{fen_state},
        turn => $game->{current_turn},
        status => $game->{status},
        winner_id => $game->{winner_id},
        draw_offered_by => $game->{draw_offered_by},
        last_move => $game->{last_move}
    });
}

# API Endpoint: Initiates a draw offer.
sub offer_draw ($c) {
    my $game_id = $c->param('id');
    my $user_id = $c->current_user_id;
    
    my $success = $c->db->offer_chess_draw($game_id, $user_id);
    $c->render(json => { success => $success ? \1 : \0 });
}

# API Endpoint: Responds to a draw offer (accept or refuse).
sub respond_draw ($c) {
    my $game_id = $c->param('id');
    my $accepted = $c->param('accept') ? 1 : 0;
    
    my $success = $c->db->respond_chess_draw($game_id, $accepted);
    $c->render(json => { success => $success ? \1 : \0 });
}

1;