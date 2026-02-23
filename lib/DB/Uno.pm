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

# Creates a new lobby and initializes the game session.
# Parameters:
#   user_id : Unique ID of the host player
# Returns:
#   Integer ID of the newly created game session
sub DB::create_uno_lobby {
    my ($self, $user_id) = @_;
    
    $self->ensure_connection;
    
    # Generate and Shuffle Deck
    my $deck = _generate_deck();
    
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
            draw_pile, discard_pile, 
            p1_hand, p2_hand, p3_hand, p4_hand,
            current_color, status, direction
        ) VALUES (?, ?, ?, ?, '[]', '[]', '[]', '[]', ?, 'waiting', 1)"
    );
    
    $sth->execute(
        $user_id, $user_id,
        encode_json($deck), encode_json(\@discard),
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

# Adds a player to an existing lobby (supports up to 4 players).
# Parameters:
#   game_id : Target game ID
#   user_id : ID of the joining player
# Returns:
#   Result of execute() (true on success, 0 on failure)
sub DB::join_uno_lobby {
    my ($self, $game_id, $user_id) = @_;
    
    $self->ensure_connection;
    
    my $game = $self->{dbh}->selectrow_hashref("SELECT player1_id, player2_id, player3_id, player4_id FROM uno_sessions WHERE id = ?", undef, $game_id);
    return 0 unless $game;

    # Check if user is already in the game
    return 0 if ($game->{player1_id} == $user_id || 
                 ($game->{player2_id} && $game->{player2_id} == $user_id) ||
                 ($game->{player3_id} && $game->{player3_id} == $user_id) ||
                 ($game->{player4_id} && $game->{player4_id} == $user_id));

    # Find the first available slot
    my $slot;
    if (!$game->{player2_id}) { $slot = 'player2_id'; }
    elsif (!$game->{player3_id}) { $slot = 'player3_id'; }
    elsif (!$game->{player4_id}) { $slot = 'player4_id'; }
    else { return 0; } # Game full

    my $sth = $self->{dbh}->prepare(
        "UPDATE uno_sessions SET $slot = ? WHERE id = ? AND status = 'waiting'"
    );
    return $sth->execute($user_id, $game_id);
}

# Gets the game state and sanitizes opponent cards for security (supports 4 players).
# Parameters:
#   game_id : Unique Game ID
#   user_id : ID of the user requesting the state
# Returns:
#   HashRef containing game state with 'p1_ready'..'p4_ready', and masked hands
sub DB::get_uno_game_state {
    my ($self, $game_id, $user_id) = @_;
    
    $self->ensure_connection;
    
    my $sql = "SELECT g.*, 
                      u1.username as p1_name, 
                      u2.username as p2_name,
                      u3.username as p3_name,
                      u4.username as p4_name
               FROM uno_sessions g
               LEFT JOIN users u1 ON g.player1_id = u1.id
               LEFT JOIN users u2 ON g.player2_id = u2.id
               LEFT JOIN users u3 ON g.player3_id = u3.id
               LEFT JOIN users u4 ON g.player4_id = u4.id
               WHERE g.id = ?";
               
    my $game = $self->{dbh}->selectrow_hashref($sql, undef, $game_id);
    return undef unless $game;
    
    # Decode JSON fields
    $game->{draw_pile}    = decode_json($game->{draw_pile} // '[]');
    $game->{discard_pile} = decode_json($game->{discard_pile} // '[]');
    $game->{p1_hand}      = decode_json($game->{p1_hand} // '[]');
    $game->{p2_hand}      = decode_json($game->{p2_hand} // '[]');
    $game->{p3_hand}      = decode_json($game->{p3_hand} // '[]');
    $game->{p4_hand}      = decode_json($game->{p4_hand} // '[]');

    # Ensure ready flags are treated as booleans
    $game->{p1_ready} = $game->{p1_ready} // 0;
    $game->{p2_ready} = $game->{p2_ready} // 0;
    $game->{p3_ready} = $game->{p3_ready} // 0;
    $game->{p4_ready} = $game->{p4_ready} // 0;

    $game->{p1_said_uno} = $game->{p1_said_uno} // 0;
    $game->{p2_said_uno} = $game->{p2_said_uno} // 0;
    $game->{p3_said_uno} = $game->{p3_said_uno} // 0;
    $game->{p4_said_uno} = $game->{p4_said_uno} // 0;
    
    # Map users to slots and build counts
    my @slots = qw(p1 p2 p3 p4);
    $game->{players} = [];
    
    for my $i (1..4) {
        my $s = "p$i";
        my $pid_col = "player${i}_id";
        my $pname_col = "${s}_name";
        my $phand_col = "${s}_hand";
        my $pready_col = "${s}_ready";
        my $psaid_uno_col = "${s}_said_uno";
        
        if ($game->{$pid_col}) {
            my $p_info = {
                id => $game->{$pid_col},
                name => $game->{$pname_col},
                ready => $game->{$pready_col},
                said_uno => $game->{$psaid_uno_col},
                card_count => scalar @{$game->{$phand_col}}
            };
            
            if ($game->{$pid_col} == $user_id) {
                $game->{my_hand} = $game->{$phand_col};
                $game->{my_slot} = $s;
            }
            
            push @{$game->{players}}, $p_info;
        }
        
        # Security: Remove full hand data from base object
        delete $game->{$phand_col};
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
    
    # Pass Turn (Standard direction, no skip)
    my $next_turn = _calculate_next_turn($game, $user_id, 0);
    
    my $hand_col = $game->{my_slot} . "_hand";
    my $said_uno_col = $game->{my_slot} . "_said_uno";
    
    my $sth = $self->{dbh}->prepare(
        "UPDATE uno_sessions SET $hand_col = ?, $said_uno_col = 0, draw_pile = ?, discard_pile = ?, current_turn = ? WHERE id = ?"
    );
    
    $sth->execute(
        encode_json($game->{my_hand}),
        encode_json($deck),
        encode_json(\@$discard), # Ensure ref
        $next_turn,
        $game_id
    );
    
    return 1;
}

# Internal Helper: Calculates the next player's ID.
# Parameters:
#   game           : HashRef of game state
#   current_uid    : ID of the current player
#   skip_count     : Number of players to skip (0 for none, 1 for Skip card)
# Returns:
#   Next player ID
sub _calculate_next_turn {
    my ($game, $current_uid, $skip_count) = @_;
    
    my @joined;
    foreach my $i (1..4) {
        my $col = "player${i}_id";
        if ($game->{$col}) {
            push @joined, $game->{$col};
        }
    }
    
    my $count = scalar @joined;
    return $current_uid if $count < 2;
    
    # Find current index
    my ($current_idx) = grep { $joined[$_] == $current_uid } 0..$#joined;
    
    # Calculate step
    my $direction = $game->{direction} // 1;
    my $step = (1 + $skip_count) * $direction;
    
    my $next_idx = ($current_idx + $step) % $count;
    
    return $joined[$next_idx];
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
    # Special case: Playing a Wild on another Wild
    elsif ($p_color ne 'wild' && $top_card =~ /^wild/ && $p_color eq $current_clr) {
        $is_valid = 1;
    }
    
    return 0 unless $is_valid;
    
    # Execute Move: Update Hand and Discard
    splice(@{$game->{my_hand}}, $card_index, 1);
    push @{$game->{discard_pile}}, $card_to_play;
    
    # Special Card Effects
    my $skip_count = 0;
    my $direction = $game->{direction} // 1;
    
    if ($card_to_play =~ /skip/) {
        $skip_count = 1;
    }
    elsif ($card_to_play =~ /reverse/) {
        # Determine joined count
        my @joined = grep { $game->{"${_}_id"} } qw(p1 p2 p3 p4);
        if (scalar @joined == 2) {
            $skip_count = 1; # Reverse = Skip in 2-player
        } else {
            $direction *= -1; # Flip direction in 3-4 player
        }
    }
    elsif ($card_to_play =~ /draw2/) {
        my $next_p_id = _calculate_next_turn($game, $user_id, 0); # Next person
        _add_cards_to_player_by_id($self, $game_id, $next_p_id, 2);
        $skip_count = 1;
    }
    elsif ($card_to_play =~ /wild_draw4/) {
        my $next_p_id = _calculate_next_turn($game, $user_id, 0); # Next person
        _add_cards_to_player_by_id($self, $game_id, $next_p_id, 4);
        $skip_count = 1;
    }
    
    # Calculate Next Turn (Apply direction update if Reverse was played)
    $game->{direction} = $direction;
    my $next_turn = _calculate_next_turn($game, $user_id, $skip_count);
    my $next_color = ($p_color eq 'wild') ? $declared_color : $p_color;
    
    # Save to DB
    my $hand_col = $game->{my_slot} . "_hand";

    # Check UNO! Penalty (Classic Rule)
    my $hand_count = scalar @{$game->{my_hand}};
    my $said_uno_col = $game->{my_slot} . "_said_uno";
    if ($hand_count == 1 && !$game->{$said_uno_col}) {
        # Forgot to say UNO! -> Draw 2 penalty
        _add_cards_to_player_by_id($self, $game_id, $user_id, 2);
        # Refresh hand after penalty
        my $fresh_hand = $self->{dbh}->selectrow_hashref("SELECT $hand_col FROM uno_sessions WHERE id = ?", undef, $game_id);
        $game->{my_hand} = decode_json($fresh_hand->{$hand_col});
    }

    # Check Win Condition
    my $status = (scalar @{$game->{my_hand}} == 0) ? 'finished' : 'active';
    my $winner = ($status eq 'finished') ? $user_id : undef;
    
    my $sth = $self->{dbh}->prepare(
        "UPDATE uno_sessions SET 
            $hand_col = ?, 
            discard_pile = ?, 
            current_turn = ?, 
            current_color = ?, 
            status = ?, 
            winner_id = ?,
            direction = ?
         WHERE id = ?"
    );
    
    $sth->execute(
        encode_json($game->{my_hand}),
        encode_json($game->{discard_pile}),
        $next_turn,
        $next_color,
        $status,
        $winner,
        $direction,
        $game_id
    );
    
    return 1;
}

# Internal Helper: Adds cards to a player's hand by their user ID.
sub _add_cards_to_player_by_id {
    my ($self, $game_id, $target_uid, $count) = @_;
    
    # Fetch fresh game data
    my $game = $self->{dbh}->selectrow_hashref("SELECT * FROM uno_sessions WHERE id = ?", undef, $game_id);
    
    # Find slot
    my $slot;
    foreach (qw(p1 p2 p3 p4)) {
        if ($game->{"${_}_id"} && $game->{"${_}_id"} == $target_uid) {
            $slot = $_;
            last;
        }
    }
    return unless $slot;

    my $deck = decode_json($game->{draw_pile} // '[]');
    my $phand = decode_json($game->{"${slot}_hand"} // '[]');
    my $discard = decode_json($game->{discard_pile} // '[]');
    
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
            push @$phand, pop(@$deck);
        }
    }
    
    # Persist changes
    my $col = "${slot}_hand";
    my $sth = $self->{dbh}->prepare("UPDATE uno_sessions SET $col = ?, draw_pile = ? WHERE id = ?");
    $sth->execute(encode_json($phand), encode_json($deck), $game_id);
}

# Toggles the ready status for a player and starts game if everyone joined is ready.
# Parameters:
#   game_id : Unique ID of the game session
#   user_id : ID of the player toggling status
# Returns:
#   String status ('active', 'waiting', or 0 on failure)
sub DB::toggle_ready {
    my ($self, $game_id, $user_id) = @_;

    $self->ensure_connection;

    # Retrieve current state
    my $game = $self->{dbh}->selectrow_hashref(
        'SELECT * FROM uno_sessions WHERE id = ?',
        undef, $game_id
    );

    return 0 unless $game;

    # Identify slot
    my $slot;
    if    ($game->{player1_id} == $user_id) { $slot = 'p1'; }
    elsif ($game->{player2_id} && $game->{player2_id} == $user_id) { $slot = 'p2'; }
    elsif ($game->{player3_id} && $game->{player3_id} == $user_id) { $slot = 'p3'; }
    elsif ($game->{player4_id} && $game->{player4_id} == $user_id) { $slot = 'p4'; }
    else { return 0; }

    # Toggle ready flag
    my $target_col = "${slot}_ready";
    $self->{dbh}->do(
        "UPDATE uno_sessions SET $target_col = NOT $target_col WHERE id = ?",
        undef, $game_id
    );

    # Refresh state to check if game should start
    my $fresh = $self->{dbh}->selectrow_hashref("SELECT * FROM uno_sessions WHERE id = ?", undef, $game_id);
    
    my @joined_slots;
    push @joined_slots, 'p1' if $fresh->{player1_id};
    push @joined_slots, 'p2' if $fresh->{player2_id};
    push @joined_slots, 'p3' if $fresh->{player3_id};
    push @joined_slots, 'p4' if $fresh->{player4_id};

    my $all_ready = 1;
    foreach my $s (@joined_slots) {
        $all_ready = 0 unless $fresh->{"${s}_ready"};
    }

    if (scalar @joined_slots >= 2 && $all_ready) {
        # START GAME: Deal hands
        my $deck = decode_json($fresh->{draw_pile} // '[]');
        
        # If deck was never generated, generate now (safety)
        if (!@$deck) { $deck = _generate_deck(); }

        my %updates;
        foreach my $s (@joined_slots) {
            my @hand = splice(@$deck, 0, 7);
            $updates{"${s}_hand"} = encode_json(\@hand);
        }

        # Update SQL
        my @fields = ("status = 'active'", "draw_pile = ?", "current_turn = ?");
        my @values = (encode_json($deck), $fresh->{player1_id});
        
        foreach my $col (keys %updates) {
            push @fields, "$col = ?";
            push @values, $updates{$col};
        }
        
        my $sql = "UPDATE uno_sessions SET " . join(", ", @fields) . " WHERE id = ?";
        push @values, $game_id;
        
        my $sth = $self->{dbh}->prepare($sql);
        $sth->execute(@values);
        
        return 'active';
    }

    return 'waiting';
}

# Marks a player as having declared 'UNO!'.
# Parameters:
#   game_id : Unique Game ID
#   user_id : ID of the player shouting
# Returns:
#   Boolean (1 on success, 0 on failure)
sub DB::shout_uno {
    my ($self, $game_id, $user_id) = @_;
    
    $self->ensure_connection;
    
    my $game = $self->get_uno_game_state($game_id, $user_id);
    return 0 unless $game;
    
    my $said_uno_col = $game->{my_slot} . "_said_uno";
    
    my $sth = $self->{dbh}->prepare("UPDATE uno_sessions SET $said_uno_col = 1 WHERE id = ?");
    return $sth->execute($game_id);
}

1;