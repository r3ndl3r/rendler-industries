# /lib/MyApp/Controller/Uno.pm

package MyApp::Controller::Uno;
use Mojo::Base 'Mojolicious::Controller';

# Controller for the UNO Online multiplayer game.
# Features:
#   - Lobby management (List, Create, Join)
#   - Game interface rendering with secure state masking
#   - AJAX-based move processing (Play Card, Draw Card)
# Integration points:
#   - Uses DB::Uno helper for game logic and state persistence
#   - Restricted to authenticated users via router bridge

# Renders the lobby list showing waiting games.
# Route: GET /uno/lobby
# Parameters: None
# Returns:
#   Rendered HTML template 'uno/lobby' with list of open games
sub lobby {
    my $c = shift;
    # UPDATED: Specific method call
    my $lobbies = $c->db->get_open_uno_lobbies();
    $c->render('uno/lobby', lobbies => $lobbies);
}

# Initializes a new game session as the host.
# Route: GET /uno/create
# Parameters: None
# Returns:
#   Redirects to the play screen for the new game ID
sub create {
    my $c = shift;
    my $uid = $c->current_user_id;
    # UPDATED: Specific method call
    my $game_id = $c->db->create_uno_lobby($uid);
    $c->redirect_to("/uno/play/$game_id");
}

# Adds the current user to an existing lobby as player 2.
# Route: POST /uno/join
# Parameters:
#   id : Unique Game ID to join
# Returns:
#   Redirects to play screen on success
#   Redirects to lobby with error flash on failure
sub join {
    my $c = shift;
    my $uid = $c->current_user_id;
    my $game_id = $c->param('id');
    
    # UPDATED: Specific method call
    if ($c->db->join_uno_lobby($game_id, $uid)) {
        $c->redirect_to("/uno/play/$game_id");
    } else {
        $c->flash(error => "Could not join game (It might be full or closed).");
        $c->redirect_to('/uno/lobby');
    }
}

# Renders the main game board or returns JSON state for polling.
# Note: State is sanitized by DB layer to hide opponent's cards.
# Route: GET /uno/play/:id
# Parameters:
#   id : Unique Game ID
# Returns:
#   Rendered HTML template 'uno/game' (Standard request)
#   JSON object { my_hand, top_card, turn, status, etc } (AJAX request)
sub play {
    my $c = shift;
    my $game_id = $c->param('id');
    my $uid = $c->current_user_id;
    
    # Retrieve game state (Opponent cards are masked by DB helper)
    # UPDATED: Specific method call
    my $game = $c->db->get_uno_game_state($game_id, $uid);
    return $c->redirect_to('/uno/lobby') unless $game;

    # Identify Player Roles
    # 0 = Spectator, 1 = Host, 2 = Joiner
    my $player_role = 0; 
    if ($game->{player1_id} == $uid) { $player_role = 1; }
    elsif ($game->{player2_id} && $game->{player2_id} == $uid) { $player_role = 2; }

    # API Mode: Return JSON for AJAX polling
    if ($c->req->headers->header('X-Requested-With')) {
        return $c->render(json => {
            myhand => $game->{my_hand},
            oppcount => $game->{opp_hand_count},
            topcard => $game->{top_card},
            turn        => $game->{current_turn},
            status      => $game->{status},
            winner      => $game->{winner_id},
            color       => $game->{current_color},
            player_role => $player_role,
            p1_id       => $game->{player1_id},
            p2_id       => $game->{player2_id},
            p1_name     => $game->{p1_name} // 'Player 1',
            p2_name     => $game->{p2_name} // 'Player 2'
        });
    }

    $c->render('uno/game', game => $game, my_id => $uid, player_role => $player_role);
}

# Processes a player's attempt to play a card from their hand.
# Route: POST /uno/play_card
# Parameters:
#   id    : Unique Game ID
#   idx   : Index of the card in the hand array
#   color : (Optional) Declared color for Wild cards
# Returns:
#   JSON object { success => 1/0 }
sub play_card {
    my $c = shift;
    my $game_id = $c->param('id');
    my $idx = $c->param('idx');
    my $color = $c->param('color'); # Optional, for Wilds
    my $uid = $c->current_user_id;
    
    # UPDATED: Specific method call
    my $success = $c->db->play_uno_card($game_id, $uid, $idx, $color);
    
    $c->render(json => { success => $success });
}

# Processes a player's attempt to draw a card from the deck.
# Route: POST /uno/draw_card
# Parameters:
#   id : Unique Game ID
# Returns:
#   JSON object { success => 1/0 }
sub draw_card {
    my $c = shift;
    my $game_id = $c->param('id');
    my $uid = $c->current_user_id;
    
    # UPDATED: Specific method call
    my $success = $c->db->draw_uno_card($game_id, $uid);
    
    $c->render(json => { success => $success });
}

# Toggles the ready status of the current user for a specific game.
# Route: POST /uno/ready
# Parameters:
#   id : Unique Game ID
# Returns:
#   JSON object { status => 'waiting'/'active' }
sub toggle_ready {
    my $c = shift;
    my $game_id = $c->param('id');
    my $uid = $c->current_user_id;
    
    my $status = $c->db->toggle_ready($game_id, $uid);
    
    # Return new status so frontend knows if it should reload page
    $c->render(json => { status => $status });
}

1;