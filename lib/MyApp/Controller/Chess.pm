# /lib/MyApp/Controller/Chess.pm

package MyApp::Controller::Chess;
use Mojo::Base 'Mojolicious::Controller';

# Controller for the Chess multiplayer interface.
#
# Features:
#   - Unified application entry point (/chess).
#   - JSON APIs for lobby discovery and active game synchronization.
#   - Validation-integrated move processing and FEN state management.
#   - Collaborative draw negotiation and resignation logic.
#
# Integration Points:
#   - Depends on DB::Chess for all game state persistence.
#   - Restricted to authenticated users via global session bridge.

# Entry Point: Serves the base skeleton for both lobby and active games.
# Route: GET /chess and GET /chess/play/:id
# Returns: Template (chess.html.ep)
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render('chess');
}

# API Endpoint: Retrieves current lobby status for matchmaking.
# Route: GET /chess/api/lobby
# Returns: JSON object { success, open_games, user_games }
sub api_lobby {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in;
        
    my $user_id = $c->current_user_id;
    my $lobbies = $c->db->get_open_chess_lobbies();
    my $user_games = $c->db->get_user_chess_games($user_id);
    
    my @filtered_lobbies = grep { $_->{player1_id} != $user_id } @$lobbies;
    
    $c->render(json => {
        success => 1,
        open_games => \@filtered_lobbies,
        user_games => $user_games
    });
}

# API Endpoint: Initializes a fresh game session.
# Route: POST /chess/api/create
# Returns: JSON object { success, game_id }
sub api_create {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in;

    my $uid = $c->current_user_id;
    my $game_id = $c->db->create_chess_lobby($uid);

    $c->render(json => { success => 1, game_id => $game_id });
}

# API Endpoint: Registers the current user as the second participant.
# Route: POST /chess/api/join
# Returns: JSON object { success, game_id, error }
sub api_join {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in;

    my $uid = $c->current_user_id;
    
    my $data = $c->req->json || $c->req->params->to_hash;
    my $game_id = $data->{id};

    my $success = $c->db->join_chess_lobby($game_id, $uid);

    if ($success) {
        return $c->render(json => { success => 1, game_id => $game_id });
    } else {
        return $c->render(json => { success => 0, error => "Could not join game" });
    }
}

# API Endpoint: Retrieves full game metadata and FEN state.
# Route: GET /chess/api/game/:id
# Returns: JSON object { success, game, error }
sub api_game {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in;
        
    my $game_id = $c->param('id');
    my $user_id = $c->current_user_id;
    
    my $game = $c->db->get_chess_game_state($game_id);
    
    unless ($game) {
        return $c->render(json => { success => 0, error => 'Game not found' }, status => 404);
    }
    
    # Security: Verify participation (spectators currently disabled)
    unless ($game->{player1_id} == $user_id || ($game->{player2_id} && $game->{player2_id} == $user_id)) {
        return $c->render(json => { success => 0, error => 'Not a participant' }, status => 403);
    }
    
    $c->render(json => { success => 1, game => $game });
}

# API Endpoint: Processes a validated move from the client engine.
# Route: POST /chess/api/move
# Returns: JSON object { success, error }
sub api_move {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in;
        
    my $data = $c->req->json || $c->req->params->to_hash;
    unless ($data && $data->{game_id}) {
        return $c->render(json => { success => 0, error => 'Invalid payload' });
    }

    my $game_id      = $data->{game_id};
    my $new_fen      = $data->{fen};
    my $next_turn_id = $data->{next_turn_id} // 0;
    my $status       = $data->{status} // 'active';
    my $winner_id    = $data->{winner_id};
    my $last_move    = $data->{last_move};

    # Transform serialized "null", "NaN", or empty strings to Perl undef for nullable columns.
    $winner_id = undef if !defined $winner_id || $winner_id eq 'null' || $winner_id eq 'NaN' || $winner_id eq '';
    $last_move = undef if !defined $last_move || $last_move eq 'null' || $last_move eq 'NaN' || $last_move eq '';
    
    # Ensure next_turn_id defaults to 0 for non-nullable integer constraints.
    $next_turn_id = 0 if !defined $next_turn_id || $next_turn_id eq 'null' || $next_turn_id eq 'NaN' || $next_turn_id eq '';

    my $success = $c->db->update_chess_game_state(
        $game_id, $next_turn_id, $new_fen, $status, $winner_id, $last_move
    );
    
    $c->render(json => { success => $success });
}

# API Endpoint: Issues a draw offer to the opposing participant.
# Route: POST /chess/api/offer_draw/:id
# Returns: JSON object { success }
sub api_offer_draw {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in;
        
    my $game_id = $c->param('id');
    my $user_id = $c->current_user_id;
    
    my $success = $c->db->offer_chess_draw($game_id, $user_id);
    $c->render(json => { success => $success });
}

# API Endpoint: Processes the resolution of an inbound draw offer.
# Route: POST /chess/api/respond_draw/:id
# Returns: JSON object { success }
sub api_respond_draw {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in;
        
    my $data = $c->req->json || $c->req->params->to_hash;
    my $game_id = $c->param('id');
    my $accept = $data->{accept} // $c->param('accept');
    
    my $success = $c->db->respond_chess_draw($game_id, $accept);
    $c->render(json => { success => $success });
}

1;
