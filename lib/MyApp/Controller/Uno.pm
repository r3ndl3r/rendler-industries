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
    # 0 = Spectator, 1-4 = Player slot
    my $player_role = 0; 
    if    ($game->{player1_id} == $uid) { $player_role = 1; }
    elsif ($game->{player2_id} && $game->{player2_id} == $uid) { $player_role = 2; }
    elsif ($game->{player3_id} && $game->{player3_id} == $uid) { $player_role = 3; }
    elsif ($game->{player4_id} && $game->{player4_id} == $uid) { $player_role = 4; }

    # API Mode: Return JSON for AJAX polling
    if ($c->req->headers->header('X-Requested-With')) {
        # Extract individual player role/said_uno mapping
        my @players_data;
        foreach my $p (@{$game->{players}}) {
            my $role = 0;
            if    ($game->{player1_id} == $p->{id}) { $role = 1; }
            elsif ($game->{player2_id} && $game->{player2_id} == $p->{id}) { $role = 2; }
            elsif ($game->{player3_id} && $game->{player3_id} == $p->{id}) { $role = 3; }
            elsif ($game->{player4_id} && $game->{player4_id} == $p->{id}) { $role = 4; }
            
            push @players_data, {
                %$p,
                role => $role
            };
        }

        # SANITY CHECK: Never return full hands p1_hand..p4_hand to frontend
        return $c->render(json => {
            myhand      => $game->{my_hand},
            players     => \@players_data,
            topcard     => $game->{top_card},
            turn        => $game->{current_turn},
            status      => $game->{status},
            winner      => $game->{winner_id},
            color       => $game->{current_color},
            player_role => $player_role,
            direction   => $game->{direction}
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
#   JSON object { success => 1/0, playable => 1/0 }
sub draw_card {
    my $c = shift;
    my $game_id = $c->param('id');
    my $uid = $c->current_user_id;
    
    # UPDATED: Specific method call
    my $result = $c->db->draw_uno_card($game_id, $uid);
    
    $c->render(json => $result);
}

# Processes a player's 'UNO!' declaration.
# Route: POST /uno/shout
# Parameters:
#   id : Unique Game ID
# Returns:
#   JSON object { success => 1/0 }
sub shout_uno {
    my $c = shift;
    my $game_id = $c->param('id');
    my $uid = $c->current_user_id;
    
    my $success = $c->db->shout_uno($game_id, $uid);
    
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

# Manually starts the game. Only the host (player 1) can call this.
# Route: POST /uno/start
# Parameters:
#   id : Unique Game ID
# Returns:
#   JSON object { success => 1/0, message => '...' }
sub start {
    my $c = shift;
    my $game_id = $c->param('id');
    my $uid = $c->current_user_id;
    
    my ($success, $message) = $c->db->start_uno_game($game_id, $uid);
    
    $c->render(json => { success => $success, message => $message });
}

1;