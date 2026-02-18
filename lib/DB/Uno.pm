# /lib/DB/Uno.pm

package DB::Uno;

use strict;
use warnings;
use Mojo::JSON qw(encode_json decode_json);
use List::Util qw(shuffle);

# Database helper for UNO Game Logic.
# Features:
#   - Deck generation (108 standard cards)
#   - Shuffling and Dealing
#   - Move validation (Color/Number matching)
#   - Action Card logic (Skip, Draw 2, Wild)
# Integration points:
#   - Extends DB package via package injection
#   - Uses Mojo::JSON for board state serialization

# Generates a full UNO deck.
# Parameters: None
# Returns:
#   ArrayRef of Card Strings (e.g., "red_5", "blue_skip", "wild")
sub _generate_deck {
    my @deck;
    my @colors = qw(red blue green yellow);
    
    foreach my $c (@colors) {
        # 1 zero per color
        push @deck, "${c}_0";
        
        # 2 of each number 1-9
        for (1..9) { push @deck, ("${c}_$_", "${c}_$_"); }
        
        # 2 of each action
        push @deck, ("${c}_skip", "${c}_skip");
        push @deck, ("${c}_reverse", "${c}_reverse");
        push @deck, ("${c}_draw2", "${c}_draw2");
    }
    
    # Wild cards (4 of each)
    for (1..4) { push @deck, "wild", "wild_draw4"; }
    
    return [ shuffle(@deck) ];
}

# Creates a new lobby and deals the initial hands.
# Parameters:
#   user_id : Unique ID of the host player
# Returns:
#   Integer ID of the newly created game session
sub DB::create_uno_lobby {
    my ($self, $user_id) = @_;
    
    $self->ensure_connection;
    
    # Generate and Shuffle Deck
    my $deck = _generate_deck();
    
    # Deal 7 cards to each player
    my @p1_hand = splice(@$deck, 0, 7);
    my @p2_hand = splice(@$deck, 0, 7);
    
    # Flip first card for discard pile
    my $first_card = pop @$deck;
    my @discard = ($first_card);
    
    # Determine initial color (fallback to red if first card is Wild)
    my ($color) = split('_', $first_card);
    $color = 'red' if $color eq 'wild';
    
    # Cleanup old lobbies
    $self->{dbh}->do("DELETE FROM uno_sessions WHERE player1_id = ? AND status = 'waiting'", undef, $user_id);

    my $sth = $self->{dbh}->prepare(
        "INSERT INTO uno_sessions (
            player1_id, current_turn, 
            draw_pile, discard_pile, p1_hand, p2_hand, 
            current_color, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting')"
    );
    
    $sth->execute(
        $user_id, $user_id,
        encode_json($deck), encode_json(\@discard), 
        encode_json(\@p1_hand), encode_json(\@p2_hand),
        $color
    );
    
    return $self->{dbh}->last_insert_id(undef, undef, undef, undef);
}

# Retrieves a list of all games currently in 'waiting' status.
# Parameters: None
# Returns:
#   ArrayRef of HashRefs containing open game details
sub DB::get_open_uno_lobbies {
    my $self = shift;
    
    $self->ensure_connection;
    
    return $self->{dbh}->selectall_arrayref(
        "SELECT g.id, u.username as host_name, g.created_at 
         FROM uno_sessions g 
         JOIN users u ON g.player1_id = u.id 
         WHERE g.status = 'waiting' 
         ORDER BY g.created_at DESC",
        { Slice => {} }
    );
}

# Adds a second player to an existing lobby.
# Parameters:
#   game_id : Target game ID
#   user_id : ID of the joining player
# Returns:
#   Result of execute() (true on success, 0 on failure)
sub DB::join_uno_lobby {
    my ($self, $game_id, $user_id) = @_;
    
    $self->ensure_connection;
    
    my ($p1) = $self->{dbh}->selectrow_array("SELECT player1_id FROM uno_sessions WHERE id = ?", undef, $game_id);
    return 0 if ($p1 && $p1 == $user_id);

    my $sth = $self->{dbh}->prepare(
        "UPDATE uno_sessions SET player2_id = ?, status = 'waiting' WHERE id = ? AND status = 'waiting'"
    );
    return $sth->execute($user_id, $game_id);
}

# Gets the game state and sanitizes opponent cards for security.
# Parameters:
#   game_id : Unique Game ID
#   user_id : ID of the user requesting the state
# Returns:
#   HashRef containing game state with 'p1_ready', 'p2_ready', and masked hands
sub DB::get_uno_game_state {
    my ($self, $game_id, $user_id) = @_;
    
    $self->ensure_connection;
    
    my $sql = "SELECT g.*, u1.username as p1_name, u2.username as p2_name 
               FROM uno_sessions g
               LEFT JOIN users u1 ON g.player1_id = u1.id
               LEFT JOIN users u2 ON g.player2_id = u2.id
               WHERE g.id = ?";
               
    my $game = $self->{dbh}->selectrow_hashref($sql, undef, $game_id);
    return undef unless $game;
    
    # Decode JSON fields
    $game->{draw_pile}    = decode_json($game->{draw_pile});
    $game->{discard_pile} = decode_json($game->{discard_pile});
    $game->{p1_hand}      = decode_json($game->{p1_hand});
    $game->{p2_hand}      = decode_json($game->{p2_hand});

    # Ensure ready flags are treated as booleans for the frontend
    $game->{p1_ready} = $game->{p1_ready} // 0;
    $game->{p2_ready} = $game->{p2_ready} // 0;
    
    # Mask the opponent's hand (Security)
    if ($game->{player1_id} == $user_id) {
        $game->{my_hand} = $game->{p1_hand};
        $game->{opp_hand_count} = scalar @{$game->{p2_hand}};
        delete $game->{p1_hand};
        delete $game->{p2_hand};
    } 
    elsif ($game->{player2_id} && $game->{player2_id} == $user_id) {
        $game->{my_hand} = $game->{p2_hand};
        $game->{opp_hand_count} = scalar @{$game->{p1_hand}};
        delete $game->{p1_hand};
        delete $game->{p2_hand};
    }
    
    # Convenience field for the top card
    $game->{top_card} = $game->{discard_pile}->[-1];
    
    return $game;
}

# Handles drawing a card from the deck.
# Parameters:
#   game_id : Unique Game ID
#   user_id : ID of the player drawing a card
# Returns:
#   Boolean (1 on success, 0 on failure)
sub DB::draw_uno_card {
    my ($self, $game_id, $user_id) = @_;
    
    my $game = $self->get_uno_game_state($game_id, $user_id);
    return 0 unless $game->{current_turn} == $user_id;
    return 0 unless $game->{status} eq 'active';
    
    my $deck = $game->{draw_pile};
    my $discard = $game->{discard_pile};
    
    # Reshuffle if deck is empty
    if (@$deck == 0) {
        my $top_card = pop @$discard;
        @$deck = shuffle(@$discard);
        @$discard = ($top_card);
    }
    
    return 0 if @$deck == 0;
    
    # Draw card
    my $new_card = pop @$deck;
    push @{$game->{my_hand}}, $new_card;
    
    # Pass Turn
    my $next_turn = ($game->{player1_id} == $user_id) ? $game->{player2_id} : $game->{player1_id};
    my $hand_col = ($game->{player1_id} == $user_id) ? 'p1_hand' : 'p2_hand';
    
    my $sth = $self->{dbh}->prepare(
        "UPDATE uno_sessions SET $hand_col = ?, draw_pile = ?, discard_pile = ?, current_turn = ? WHERE id = ?"
    );
    
    $sth->execute(
        encode_json($game->{my_hand}),
        encode_json($deck),
        encode_json($discard),
        $next_turn,
        $game_id
    );
    
    return 1;
}

# Handles playing a card from the user's hand.
# Parameters:
#   game_id        : Unique Game ID
#   user_id        : ID of the player
#   card_index     : Index of the card in the hand
#   declared_color : (Optional) Color chosen for Wild cards
# Returns:
#   Boolean (1 on success, 0 on failure)
sub DB::play_uno_card {
    my ($self, $game_id, $user_id, $card_index, $declared_color) = @_;
    
    my $game = $self->get_uno_game_state($game_id, $user_id);
    
    # Validation
    return 0 unless $game->{current_turn} == $user_id;
    return 0 unless $game->{status} eq 'active';
    return 0 if $card_index < 0 || $card_index >= scalar @{$game->{my_hand}};
    
    my $card_to_play = $game->{my_hand}->[$card_index];
    my $top_card     = $game->{top_card};
    my $current_clr  = $game->{current_color};
    
    # Parse Card Info
    my ($p_color, $p_val) = split('_', $card_to_play, 2); 
    my ($t_color, $t_val) = split('_', $top_card, 2);
    
    $p_color = 'wild' if $card_to_play =~ /^wild/;
    
    # Rules Engine: Is move valid?
    my $is_valid = 0;
    
    if ($p_color eq 'wild') {
        $is_valid = 1;
        return 0 unless $declared_color;
    }
    elsif ($p_color eq $current_clr) {
        $is_valid = 1;
    }
    elsif (defined $p_val && defined $t_val && $p_val eq $t_val) {
        $is_valid = 1;
    }
    
    return 0 unless $is_valid;
    
    # Execute Move: Update Hand and Discard
    splice(@{$game->{my_hand}}, $card_index, 1);
    push @{$game->{discard_pile}}, $card_to_play;
    
    # Calculate Next State
    my $next_turn = ($game->{player1_id} == $user_id) ? $game->{player2_id} : $game->{player1_id};
    my $next_color = ($p_color eq 'wild') ? $declared_color : $p_color;
    
    # Handle Special Cards
    my $opp_hand_col = ($game->{player1_id} == $user_id) ? 'p2_hand' : 'p1_hand';
    
    if ($card_to_play =~ /skip/ || $card_to_play =~ /reverse/) {
        $next_turn = $user_id; 
    }
    elsif ($card_to_play =~ /draw2/) {
        $next_turn = $user_id;
        _add_cards_to_opponent($self, $game_id, $opp_hand_col, 2);
    }
    elsif ($card_to_play =~ /wild_draw4/) {
        $next_turn = $user_id;
        _add_cards_to_opponent($self, $game_id, $opp_hand_col, 4);
    }
    
    # Check Win Condition
    my $status = (scalar @{$game->{my_hand}} == 0) ? 'finished' : 'active';
    my $winner = ($status eq 'finished') ? $user_id : undef;
    
    # Save to DB
    my $hand_col = ($game->{player1_id} == $user_id) ? 'p1_hand' : 'p2_hand';
    
    my $sth = $self->{dbh}->prepare(
        "UPDATE uno_sessions SET 
            $hand_col = ?, 
            discard_pile = ?, 
            current_turn = ?, 
            current_color = ?, 
            status = ?, 
            winner_id = ? 
         WHERE id = ?"
    );
    
    $sth->execute(
        encode_json($game->{my_hand}),
        encode_json($game->{discard_pile}),
        $next_turn,
        $next_color,
        $status,
        $winner,
        $game_id
    );
    
    return 1;
}

# Internal Helper: Adds cards to opponent's hand (for Draw 2/4).
# Parameters:
#   game_id : Unique Game ID
#   opp_col : Column name for opponent's hand (p1_hand/p2_hand)
#   count   : Number of cards to draw
# Returns:
#   None
sub _add_cards_to_opponent {
    my ($self, $game_id, $opp_col, $count) = @_;
    
    # Fetch fresh game data to access the hidden opponent hand and deck
    my $game = $self->{dbh}->selectrow_hashref("SELECT * FROM uno_sessions WHERE id = ?", undef, $game_id);
    my $deck = decode_json($game->{draw_pile});
    my $opp_hand = decode_json($game->{$opp_col});
    my $discard = decode_json($game->{discard_pile});
    
    # Replenish deck from discard if needed
    if (scalar @$deck < $count) {
        my $top = pop @$discard;
        push @$deck, shuffle(@$discard);
        @$discard = ($top);
        
        $self->{dbh}->do("UPDATE uno_sessions SET discard_pile = ? WHERE id = ?", undef, encode_json($discard), $game_id);
    }
    
    # Draw cards
    for (1..$count) {
        if (@$deck) {
            push @$opp_hand, pop(@$deck);
        }
    }
    
    # Persist changes
    my $sth = $self->{dbh}->prepare("UPDATE uno_sessions SET $opp_col = ?, draw_pile = ? WHERE id = ?");
    $sth->execute(encode_json($opp_hand), encode_json($deck), $game_id);
}

# Toggles the ready status for a player and starts game if both are ready.
# Parameters:
#   game_id : Unique ID of the game session
#   user_id : ID of the player toggling status
# Returns:
#   String status ('active', 'waiting', or 0 on failure)
sub DB::toggle_ready {
    my ($self, $game_id, $user_id) = @_;

    # Retrieve the current game participants and ready status
    my $game = $self->{dbh}->selectrow_hashref(
        'SELECT player1_id, player2_id, p1_ready, p2_ready FROM uno_sessions WHERE id = ?',
        undef, $game_id
    );

    return 0 unless $game;

    # Identify if the requesting user is player 1 or player 2
    my $is_p1 = ($game->{player1_id} == $user_id);
    my $is_p2 = ($game->{player2_id} && $game->{player2_id} == $user_id);

    return 0 unless ($is_p1 || $is_p2);

    # Update the ready flag for the specific player
    my $target_col = $is_p1 ? 'p1_ready' : 'p2_ready';
    $self->{dbh}->do(
        "UPDATE uno_sessions SET $target_col = NOT $target_col WHERE id = ?",
        undef, $game_id
    );

    # Check if BOTH are now ready
    my $fresh_state = $self->{dbh}->selectrow_hashref(
        "SELECT p1_ready, p2_ready FROM uno_sessions WHERE id = ?", 
        undef, $game_id
    );

    if ($fresh_state->{p1_ready} && $fresh_state->{p2_ready}) {
        # Both ready! Start the game.
        $self->{dbh}->do(
            "UPDATE uno_sessions SET status = 'active' WHERE id = ?", 
            undef, $game_id
        );
        return 'active';
    }

    return 'waiting';
}

1;