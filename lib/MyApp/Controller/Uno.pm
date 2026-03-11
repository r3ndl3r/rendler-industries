# /lib/MyApp/Controller/Uno.pm
package MyApp::Controller::Uno;
use Mojo::Base 'Mojolicious::Controller';

# Controller for the UNO Online multiplayer game.
# 
# Features:
# - Single-page architecture (SPA) for lobby and gameplay.
# - Secure game state sanitization (opponent cards hidden).
# - AJAX-driven move processing (Play, Draw, Shout UNO).
# - Automatic turn rotation and win condition detection.
# - Real-time state polling for multiplayer synchronization.

# Interface: index
# Serves the primary SPA skeleton for both lobby and active games.
# 
# @returns {Template} Rendered uno.html.ep
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('uno');
}

# API: api_lobby
# Retrieves all currently open game lobbies.
# 
# @returns {JSON} { success, lobbies }
sub api_lobby {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;
    
    my $lobbies = $c->db->get_open_uno_lobbies();
    return $c->render(json => { success => 1, lobbies => $lobbies });
}

# API: api_create
# Initializes a new game lobby as the host.
# 
# @returns {JSON} { success, game_id }
sub api_create {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;
    
    my $uid = $c->current_user_id;
    my $game_id = $c->db->create_uno_lobby($uid);
    
    return $c->render(json => { success => 1, game_id => $game_id });
}

# API: api_join
# Joins an existing game lobby.
# 
# @param {number} id - Target Game ID
# @returns {JSON} { success, game_id, error }
sub api_join {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;
    
    my $data = $c->req->json || $c->req->params->to_hash;
    my $game_id = $data->{id} // 0;
    
    # Sanitization: transform "null", "NaN", or empty strings to valid integers
    $game_id = 0 if !defined $game_id || $game_id eq 'null' || $game_id eq 'NaN' || $game_id eq '';
    
    my $uid = $c->current_user_id;
    
    if ($c->db->join_uno_lobby($game_id, $uid)) {
        return $c->render(json => { success => 1, game_id => $game_id });
    } else {
        return $c->render(json => { success => 0, error => "Could not join game (full or closed)" });
    }
}

# API: api_game
# Retrieves the sanitized state for a specific game session.
# 
# @param {number} id - Game ID
# @returns {JSON} { success, game }
sub api_game {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;
    
    my $game_id = $c->param('id');
    my $uid = $c->current_user_id;
    
    my $game = $c->db->get_uno_game_state($game_id, $uid);
    unless ($game) {
        return $c->render(json => { success => 0, error => 'Game not found' }, status => 404);
    }

    # Identify Player Role (1-4, or 0 for spectator)
    my $player_role = 0; 
    if    ($game->{player1_id} == $uid) { $player_role = 1; }
    elsif ($game->{player2_id} && $game->{player2_id} == $uid) { $player_role = 2; }
    elsif ($game->{player3_id} && $game->{player3_id} == $uid) { $player_role = 3; }
    elsif ($game->{player4_id} && $game->{player4_id} == $uid) { $player_role = 4; }

    # Extract participant metadata with role mappings
    my @players_data;
    foreach my $p (@{$game->{players}}) {
        my $role = 0;
        if    ($game->{player1_id} == $p->{id}) { $role = 1; }
        elsif ($game->{player2_id} && $game->{player2_id} == $p->{id}) { $role = 2; }
        elsif ($game->{player3_id} && $game->{player3_id} == $p->{id}) { $role = 3; }
        elsif ($game->{player4_id} && $game->{player4_id} == $p->{id}) { $role = 4; }
        
        push @players_data, { %$p, role => $role };
    }

    return $c->render(json => {
        success => 1,
        game    => {
            id              => $game->{id},
            my_hand         => $game->{my_hand},
            players         => \@players_data,
            top_card        => $game->{top_card},
            turn            => $game->{current_turn},
            status          => $game->{status},
            winner          => $game->{winner_id},
            color           => $game->{current_color},
            player_role     => $player_role,
            direction       => $game->{direction},
            current_user_id => $uid
        }
    });
}

# API: api_play_card
# Processes a card play action.
# 
# @param {number} id - Game ID
# @param {number} idx - Hand index of the card
# @param {string} color - Declared color for Wild cards
# @returns {JSON} { success }
sub api_play_card {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;
    
    my $data = $c->req->json || $c->req->params->to_hash;
    my $game_id = $data->{id};
    my $idx = $data->{idx};
    my $color = $data->{color};
    
    # Sanitization
    $game_id = 0 if !defined $game_id || $game_id eq 'null' || $game_id eq 'NaN' || $game_id eq '';
    $idx = 0 if !defined $idx || $idx eq 'null' || $idx eq 'NaN' || $idx eq '';
    
    my $uid = $c->current_user_id;
    
    my $success = $c->db->play_uno_card($game_id, $uid, $idx, $color);
    return $c->render(json => { success => $success });
}

# API: api_draw_card
# Processes a card draw action.
# 
# @param {number} id - Game ID
# @returns {JSON} { success, playable }
sub api_draw_card {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;
    
    my $data = $c->req->json || $c->req->params->to_hash;
    my $game_id = $data->{id};
    
    # Sanitization
    $game_id = 0 if !defined $game_id || $game_id eq 'null' || $game_id eq 'NaN' || $game_id eq '';
    
    my $uid = $c->current_user_id;
    
    my $result = $c->db->draw_uno_card($game_id, $uid);
    return $c->render(json => $result);
}

# API: api_shout
# Records a "UNO!" shout for the current player.
# 
# @param {number} id - Game ID
# @returns {JSON} { success }
sub api_shout {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;
    
    my $data = $c->req->json || $c->req->params->to_hash;
    my $game_id = $data->{id};
    
    # Sanitization
    $game_id = 0 if !defined $game_id || $game_id eq 'null' || $game_id eq 'NaN' || $game_id eq '';
    
    my $uid = $c->current_user_id;
    
    my $success = $c->db->shout_uno($game_id, $uid);
    return $c->render(json => { success => $success });
}

# API: api_ready
# Toggles the 'Ready' status in the lobby.
# 
# @param {number} id - Game ID
# @returns {JSON} { success, status }
sub api_ready {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;
    
    my $data = $c->req->json || $c->req->params->to_hash;
    my $game_id = $data->{id};
    
    # Sanitization
    $game_id = 0 if !defined $game_id || $game_id eq 'null' || $game_id eq 'NaN' || $game_id eq '';
    
    my $uid = $c->current_user_id;
    
    my $status = $c->db->toggle_ready($game_id, $uid);
    return $c->render(json => { success => ($status ? 1 : 0), status => $status });
}

# API: api_start
# Manually starts the game (Host only).
# 
# @param {number} id - Game ID
# @returns {JSON} { success, message }
sub api_start {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;
    
    my $data = $c->req->json || $c->req->params->to_hash;
    my $game_id = $data->{id};
    
    # Sanitization
    $game_id = 0 if !defined $game_id || $game_id eq 'null' || $game_id eq 'NaN' || $game_id eq '';
    
    my $uid = $c->current_user_id;
    
    my ($success, $message) = $c->db->start_uno_game($game_id, $uid);
    return $c->render(json => { success => $success, message => $message });
}

1;
