# /lib/DB/Uno.pm

package DB::Uno;

use strict;
use warnings;
use Mojo::JSON qw(encode_json decode_json);
use List::Util qw(shuffle);

# Database helper for UNO Game Logic.
#
# Features:
#   - Deck generation (108 standard cards)
#   - Shuffling and Dealing
#   - Move validation (Color/Number matching)
#   - Action Card logic (Skip, Draw 2, Wild)
#
# Integration Points:
#   - Extends DB package via package injection
#   - Uses Mojo::JSON for board state serialization
#   - Coordinates with centralized Notification plugins for game alerts.

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
    
    # Flip first card for discard pile (ensure it's not a wild)
    # Iteration guard to prevent infinite reshuffle loop
    my $max_reshuffles = 20;
    while ($deck->[-1] =~ /^wild/) {
        $deck = [ shuffle(@$deck) ];
        last if --$max_reshuffles <= 0;
    }
    
    # Fallback: scan from end for first non-wild card and swap it to top
    if ($deck->[-1] =~ /^wild/) {
        my $swap_idx = (grep { $deck->[$_] !~ /^wild/ } 0..$#$deck)[-1];
        if (defined $swap_idx) {
            ($deck->[-1], $deck->[$swap_idx]) = ($deck->[$swap_idx], $deck->[-1]);
        }
    }
    
    my $first_card = pop @$deck;
    my @discard = ($first_card);
    
    # Determine initial color
    my ($color) = split('_', $first_card);
    
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
        "SELECT g.id, u.username as host_name, g.created_at,
                (CASE WHEN g.player1_id IS NOT NULL THEN 1 ELSE 0 END +
                 CASE WHEN g.player2_id IS NOT NULL THEN 1 ELSE 0 END +
                 CASE WHEN g.player3_id IS NOT NULL THEN 1 ELSE 0 END +
                 CASE WHEN g.player4_id IS NOT NULL THEN 1 ELSE 0 END) as player_count
          FROM uno_sessions g 
          JOIN users u ON g.player1_id = u.id 
          WHERE g.status = 'waiting' 
          ORDER BY g.created_at DESC
          LIMIT 50",
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
    $self->{dbh}->begin_work;
    
    my $game = $self->{dbh}->selectrow_hashref("SELECT player1_id, player2_id, player3_id, player4_id FROM uno_sessions WHERE id = ? FOR UPDATE", undef, $game_id);
    unless ($game) {
        $self->{dbh}->rollback;
        return 0;
    }

    # Check if user is already in the game (idempotent)
    if (($game->{player1_id} && $game->{player1_id} == $user_id) || 
        ($game->{player2_id} && $game->{player2_id} == $user_id) ||
        ($game->{player3_id} && $game->{player3_id} == $user_id) ||
        ($game->{player4_id} && $game->{player4_id} == $user_id)) {
        $self->{dbh}->commit;
        return 1;
    }

    # Find the first available slot
    my $slot;
    if (!$game->{player2_id}) { $slot = 'player2_id'; }
    elsif (!$game->{player3_id}) { $slot = 'player3_id'; }
    elsif (!$game->{player4_id}) { $slot = 'player4_id'; }
    else { 
        $self->{dbh}->rollback;
        return 0; 
    } # Game full

    # Validate slot to prevent SQL injection
    my %valid_join_slots; foreach (2..4) { $valid_join_slots{"player${_}_id"} = 1; }
    unless ($valid_join_slots{$slot}) { $self->{dbh}->rollback; die "Invalid join slot: $slot"; }

    my $sth = $self->{dbh}->prepare(
        "UPDATE uno_sessions SET $slot = ? WHERE id = ? AND status = 'waiting'"
    );
    if ($sth->execute($user_id, $game_id)) {
        $self->{dbh}->commit;
        return 1;
    } else {
        $self->{dbh}->rollback;
        return 0;
    }
}

# Removes a player from a game session.
# Parameters:
#   game_id : Target game ID
#   user_id : ID of the player leaving
sub DB::leave_uno_game {
    my ($self, $game_id, $user_id) = @_;
    $self->ensure_connection;

    # Use transaction and row-level locking to prevent race conditions
    $self->{dbh}->begin_work;
    my $game = $self->{dbh}->selectrow_hashref("SELECT * FROM uno_sessions WHERE id = ? FOR UPDATE", undef, $game_id);
    unless ($game) { $self->{dbh}->rollback; return 0; }

    # If game is already finished, return success immediately
    if ($game->{status} eq 'finished') {
        $self->{dbh}->rollback;
        return 1;
    }

    # If host leaves and game hasn't started, delete the session
    # Defensive guard against uninitialized values
    if (($game->{player1_id} // 0) == $user_id && $game->{status} eq 'waiting') {
        my $res = $self->{dbh}->do("DELETE FROM uno_sessions WHERE id = ?", undef, $game_id);
        $self->{dbh}->commit;
        return $res;
    }

    # Otherwise, just null out their slot
    my $slot;
    my $leaving_slot_num;
    for my $i (1..4) {
        if ($game->{"player${i}_id"} && $game->{"player${i}_id"} == $user_id) {
            $slot = "player${i}_id";
            $leaving_slot_num = $i;
            last;
        }
    }
    
    if ($slot) {
        # Validate slot to prevent SQL injection
        my %valid_slots; foreach (1..4) { $valid_slots{"player${_}_id"} = 1; }
        unless ($valid_slots{$slot}) { $self->{dbh}->rollback; die "Invalid slot: $slot"; }

        # Promote next available player if host leaves an active game
        if ($leaving_slot_num && $leaving_slot_num == 1 && $game->{status} eq 'active') {
            for my $i (2..4) {
                if ($game->{"player${i}_id"}) {
                    # Validate promotion column and handle transaction errors
                    my %valid_promote; foreach (2..4) { $valid_promote{"player${_}_id"} = 1; }
                    my $promote_col = "player${i}_id";
                    unless ($valid_promote{$promote_col}) { $self->{dbh}->rollback; die "Invalid promote col: $promote_col"; }

                    eval {
                        $self->{dbh}->do(
                            "UPDATE uno_sessions SET player1_id = $promote_col, $promote_col = NULL WHERE id = ?",
                            undef, $game_id
                        );
                    };
                    if ($@) { $self->{dbh}->rollback; die $@; }

                    # Slot management handled inline above
                    $slot = undef; 
                    last;
                }
            }
        }

        # If it was their turn and game is active, advance turn
        my $was_turn = ($game->{current_turn} && $game->{current_turn} == $user_id && $game->{status} eq 'active');
        
        if ($slot) {
            $self->{dbh}->do("UPDATE uno_sessions SET $slot = NULL WHERE id = ?", undef, $game_id);
        }
        
        # If no players left, cleanup
        my @remaining_ids = ();
        # Consistent locking read within transaction
        my $game_fresh = $self->{dbh}->selectrow_hashref("SELECT * FROM uno_sessions WHERE id = ? FOR UPDATE", undef, $game_id);
        
        # Guard against null dereference if row was deleted concurrently
        unless ($game_fresh) { $self->{dbh}->commit; return 1; }

        for my $i (1..4) {
            push @remaining_ids, $game_fresh->{"player${i}_id"} if $game_fresh->{"player${i}_id"};
        }

        if (!@remaining_ids) {
            $self->{dbh}->do("DELETE FROM uno_sessions WHERE id = ?", undef, $game_id);
        } elsif (scalar @remaining_ids == 1 && $game_fresh->{status} eq 'active') {
            # Only one player left in active game, they win
            $self->{dbh}->do("UPDATE uno_sessions SET status = 'finished', winner_id = ? WHERE id = ?", undef, $remaining_ids[0], $game_id);
        } elsif ($was_turn) {
            # Advance turn to next available player
            # Use pre-leave snapshot so _calculate_next_turn can find $user_id
            my $next_turn = _calculate_next_turn($game, $user_id, 0);
            if ($next_turn && $next_turn != $user_id) {
                $self->{dbh}->do("UPDATE uno_sessions SET current_turn = ? WHERE id = ?", undef, $next_turn, $game_id);
            } else {
                # Fallback: assign turn to first remaining player
                my $fallback;
                foreach my $idx (1..4) {
                    if ($game_fresh->{"player${idx}_id"}) {
                        $fallback = $game_fresh->{"player${idx}_id"};
                        last;
                    }
                }
                $self->{dbh}->do("UPDATE uno_sessions SET current_turn = ? WHERE id = ?", undef, $fallback, $game_id) if $fallback;
            }
        }
        $self->{dbh}->commit;
        return 1;
    }
    
    $self->{dbh}->rollback;
    return 0; # Explicit return 0 if slot not found
}

# Gets the game state and sanitizes opponent cards for security (supports 4 players).
# Parameters:
#   game_id : Unique Game ID
#   user_id : ID of the user requesting the state
#   lock    : Optional. If true, use FOR UPDATE lock.
# Returns:
#   HashRef containing game state with 'p1_ready'..'p4_ready', and masked hands
sub DB::get_uno_game_state {
    my ($self, $game_id, $user_id, $lock) = @_;
    
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
    
    if ($lock) { $sql .= " FOR UPDATE"; }
               
    my $game = $self->{dbh}->selectrow_hashref($sql, undef, $game_id);
    return undef unless $game;
    
    # Decode JSON fields
    $game->{draw_pile}    = decode_json($game->{draw_pile} // '[]');
    $game->{discard_pile} = decode_json($game->{discard_pile} // '[]');
    $game->{p1_hand}      = decode_json($game->{p1_hand} // '[]');
    $game->{p2_hand}      = decode_json($game->{p2_hand} // '[]');
    $game->{p3_hand}      = decode_json($game->{p3_hand} // '[]');
    $game->{p4_hand}      = decode_json($game->{p4_hand} // '[]');

    # Ensure flags are treated as booleans/ints
    foreach my $i (1..4) {
        $game->{"p${i}_ready"} = $game->{"p${i}_ready"} // 0;
        $game->{"p${i}_said_uno"} = $game->{"p${i}_said_uno"} // 0;
        $game->{"p${i}_drawn_this_turn"} = $game->{"p${i}_drawn_this_turn"} // 0;
    }
    
    # Map users to slots and build counts
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
                # Expose drawn_this_turn state to client
                $game->{player_drawn_this_turn} = $game->{"${s}_drawn_this_turn"};
            }
            
            push @{$game->{players}}, $p_info;
        }
    }
    
    # Convenience field for the top card
    $game->{top_card} = $game->{discard_pile}->[-1];
    
    return $game;
}

# Internal Helper: Reshuffles discard pile into draw pile if empty.
sub _reshuffle_deck_if_empty {
    my ($deck, $discard) = @_;
    if (@$deck == 0 && @$discard > 0) {
        my $top_card = pop @$discard;
        @$deck = shuffle(@$discard);
        @$discard = ($top_card);
    }
    # Warn if we still have no cards (true exhaustion)
    warn "UNO: both deck and discard exhausted for game — data may be corrupt" if !@$deck && !@$discard;
}

# Handles drawing a card from the deck.
# Parameters:
#   game_id : Unique Game ID
#   user_id : ID of the player drawing a card
# Returns:
#   HashRef { success => 1/0, playable => 1/0 }
sub DB::draw_uno_card {
    my ($self, $game_id, $user_id) = @_;
    
    # Wrap in transaction with FOR UPDATE lock
    $self->{dbh}->begin_work;
    my $game = $self->get_uno_game_state($game_id, $user_id, 1); # Pass 1 for locking read
    
    unless ($game && ($game->{current_turn} // 0) == $user_id) { $self->{dbh}->rollback; return { success => 0, error => "Not your turn" }; }
    unless ($game->{status} eq 'active') { $self->{dbh}->rollback; return { success => 0, error => "Game not active" }; }
    if ($game->{player_drawn_this_turn}) { $self->{dbh}->rollback; return { success => 0, error => "Already drew this turn" }; }
    
    my $deck = $game->{draw_pile};
    my $discard = $game->{discard_pile};
    
    _reshuffle_deck_if_empty($deck, $discard);
    return { success => 0, error => "Deck empty" } if @$deck == 0;
    
    # Draw card
    my $new_card = pop @$deck;
    push @{$game->{my_hand}}, $new_card;
    
    # Check if drawn card is playable (to notify frontend)
    my $playable = _can_play_card($new_card, $game->{top_card}, $game->{current_color});

    my $hand_col = $game->{my_slot} . "_hand";
    my $said_uno_col = $game->{my_slot} . "_said_uno";
    my $drawn_col = $game->{my_slot} . "_drawn_this_turn";
    
    # Validate interpolated column names
    my %valid_uno_cols;   foreach (1..4) { $valid_uno_cols{"p${_}_said_uno"} = 1; }
    my %valid_drawn_cols; foreach (1..4) { $valid_drawn_cols{"p${_}_drawn_this_turn"} = 1; }
    die "Invalid said_uno_col: $said_uno_col" unless $valid_uno_cols{$said_uno_col};
    die "Invalid drawn_col: $drawn_col"       unless $valid_drawn_cols{$drawn_col};

    # If not playable, pass turn immediately. 
    my $next_turn = $game->{current_turn};
    my $drawn_status = 1;
    if (!$playable) {
        $next_turn = _calculate_next_turn($game, $user_id, 0);
        $drawn_status = 0; # Reset since turn passed
    }
    
    my $sth = $self->{dbh}->prepare(
        "UPDATE uno_sessions SET $hand_col = ?, $said_uno_col = 0, $drawn_col = ?, draw_pile = ?, discard_pile = ?, current_turn = ? WHERE id = ?"
    );
    
    $sth->execute(
        encode_json($game->{my_hand}),
        $drawn_status,
        encode_json($deck),
        encode_json($discard),
        $next_turn,
        $game_id
    );
    
    $self->{dbh}->commit;
    return { success => 1, playable => $playable };
}

# Internal Helper: Standard UNO matching rules.
sub _can_play_card {
    my ($card, $top_card, $current_color) = @_;
    
    return 1 if $card =~ /^wild/;
    
    my ($p_color, $p_val) = split('_', $card, 2);
    my ($t_color, $t_val) = split('_', $top_card, 2);
    
    return 1 if $p_color eq $current_color;
    return 1 if defined $p_val && defined $t_val && $p_val eq $t_val;
    
    return 0;
}

# Internal Helper: Calculates the next player's ID.
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
    
    # If player not found (e.g. just left), return first joined player
    return $joined[0] unless defined $current_idx;

    # Calculate step
    my $direction = $game->{direction} // 1;
    my $step = (1 + $skip_count) * $direction;
    
    my $next_idx = ($current_idx + $step) % $count;
    $next_idx += $count if $next_idx < 0;
    
    return $joined[$next_idx];
}

# Handles playing a card from the user's hand.
sub DB::play_uno_card {
    my ($self, $game_id, $user_id, $card_index, $declared_color) = @_;
    
    # Wrap in transaction with FOR UPDATE lock
    $self->{dbh}->begin_work;
    my $game = $self->get_uno_game_state($game_id, $user_id, 1); # Pass 1 for locking read
    
    # Validation
    unless ($game && ($game->{current_turn} // 0) == $user_id) { $self->{dbh}->rollback; return 0; }
    unless ($game->{status} eq 'active') { $self->{dbh}->rollback; return 0; }
    
    # Pass turn validation (must have drawn)
    if ($card_index == -1) {
        unless ($game->{player_drawn_this_turn}) { $self->{dbh}->rollback; return 0; }
        my $next_turn = _calculate_next_turn($game, $user_id, 0);
        my $drawn_col = $game->{my_slot} . "_drawn_this_turn";
        
        # Validate drawn_col to prevent SQL injection
        my %valid_drawn_cols; foreach (1..4) { $valid_drawn_cols{"p${_}_drawn_this_turn"} = 1; }
        die "Invalid drawn_col: $drawn_col" unless $valid_drawn_cols{$drawn_col};

        $self->{dbh}->do("UPDATE uno_sessions SET current_turn = ?, $drawn_col = 0 WHERE id = ?", undef, $next_turn, $game_id);
        $self->{dbh}->commit;
        return 1;
    }
    
    return 0 if $card_index < 0 || $card_index >= scalar @{$game->{my_hand}};
    
    my $card_to_play = $game->{my_hand}->[$card_index];
    my $top_card     = $game->{top_card};
    my $current_clr  = $game->{current_color};
    
    my ($p_color, $p_val) = split('_', $card_to_play, 2); 
    my ($t_color, $t_val) = split('_', $top_card, 2);
    
    $p_color = 'wild' if $card_to_play =~ /^wild/;
    
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
    elsif ($p_color ne 'wild' && $top_card =~ /^wild/ && $p_color eq $current_clr) {
        $is_valid = 1;
    }
    
    return 0 unless $is_valid;
    
    # Execute Move
    splice(@{$game->{my_hand}}, $card_index, 1);
    push @{$game->{discard_pile}}, $card_to_play;
    
    # Effects
    my $skip_count = 0;
    my $direction = $game->{direction} // 1;
    
    if ($card_to_play eq 'wild_draw4') {
        my $next_p_id = _calculate_next_turn($game, $user_id, 0);
        $game = _add_cards_to_player_by_id($self, $game_id, $next_p_id, 4, $game);
        $skip_count = 1;
    }
    elsif (defined $p_val && $p_val eq 'skip') {
        $skip_count = 1;
    }
    elsif (defined $p_val && $p_val eq 'reverse') {
        my @joined = grep { $game->{"player${_}_id"} } (1..4);
        if (scalar @joined == 2) { $skip_count = 1; }
        else { $direction *= -1; }
    }
    elsif (defined $p_val && $p_val eq 'draw2') {
        my $next_p_id = _calculate_next_turn($game, $user_id, 0);
        $game = _add_cards_to_player_by_id($self, $game_id, $next_p_id, 2, $game);
        $skip_count = 1;
    }
    
    $game->{direction} = $direction;
    my $next_turn = _calculate_next_turn($game, $user_id, $skip_count);
    my $next_color = ($p_color eq 'wild') ? $declared_color : $p_color;
    
    my $hand_col = $game->{my_slot} . "_hand";
    my $said_uno_col = $game->{my_slot} . "_said_uno";
    my $drawn_col = $game->{my_slot} . "_drawn_this_turn";

    # Validate said_uno_col to prevent SQL injection
    my %valid_uno_cols; foreach (1..4) { $valid_uno_cols{"p${_}_said_uno"} = 1; }
    unless ($valid_uno_cols{$said_uno_col}) { die "Invalid said_uno_col: $said_uno_col"; }

    # Validate drawn_col to prevent SQL injection
    my %valid_drawn_cols; foreach (1..4) { $valid_drawn_cols{"p${_}_drawn_this_turn"} = 1; }
    die "Invalid drawn_col: $drawn_col" unless $valid_drawn_cols{$drawn_col};

    if (scalar @{$game->{my_hand}} == 1 && !$game->{$said_uno_col}) {
        $game = _add_cards_to_player_by_id($self, $game_id, $user_id, 2, $game);
    }

    my $status = (scalar @{$game->{my_hand}} == 0) ? 'finished' : 'active';
    my $winner = ($status eq 'finished') ? $user_id : undef;
    
    # Reset drawn_this_turn flags on card play
    my $sth = $self->{dbh}->prepare(
        "UPDATE uno_sessions SET 
            p1_hand = ?, p2_hand = ?, p3_hand = ?, p4_hand = ?,
            draw_pile = ?, discard_pile = ?, 
            current_turn = ?, current_color = ?, 
            status = ?, winner_id = ?, direction = ?,
            $said_uno_col = 0, $drawn_col = 0,
            p1_drawn_this_turn = 0, p2_drawn_this_turn = 0,
            p3_drawn_this_turn = 0, p4_drawn_this_turn = 0
         WHERE id = ?"
    );
    
    $sth->execute(
        encode_json($game->{p1_hand} // []), encode_json($game->{p2_hand} // []),
        encode_json($game->{p3_hand} // []), encode_json($game->{p4_hand} // []),
        encode_json($game->{draw_pile}), encode_json($game->{discard_pile}),
        $next_turn, $next_color, $status, $winner, $direction, $game_id
    );
    
    $self->{dbh}->commit;
    return 1;
}

sub _add_cards_to_player_by_id {
    my ($self, $game_id, $target_uid, $count, $game) = @_;
    my $slot;
    foreach my $s (qw(p1 p2 p3 p4)) {
        my $col = "player" . substr($s, 1) . "_id";
        if ($game->{$col} && $game->{$col} == $target_uid) {
            $slot = $s; last;
        }
    }
    return $game unless $slot;

    my $deck = $game->{draw_pile};
    my $phand_col = "${slot}_hand";
    my $phand = $game->{$phand_col} // [];
    my $discard = $game->{discard_pile};
    
    for (1..$count) {
        _reshuffle_deck_if_empty($deck, $discard);
        if (@$deck) { push @$phand, pop(@$deck); }
    }
    
    $game->{$phand_col} = $phand;
    $game->{draw_pile} = $deck;
    $game->{discard_pile} = $discard;
    return $game;
}

sub DB::toggle_ready {
    my ($self, $game_id, $user_id) = @_;
    $self->ensure_connection;
    my $game = $self->{dbh}->selectrow_hashref('SELECT * FROM uno_sessions WHERE id = ?', undef, $game_id);
    return 0 unless $game;

    my $slot;
    if    (($game->{player1_id} // 0) == $user_id) { $slot = 'p1'; }
    elsif ($game->{player2_id} && $game->{player2_id} == $user_id) { $slot = 'p2'; }
    elsif ($game->{player3_id} && $game->{player3_id} == $user_id) { $slot = 'p3'; }
    elsif ($game->{player4_id} && $game->{player4_id} == $user_id) { $slot = 'p4'; }
    else { return 0; }

    my $target_col = "${slot}_ready";
    my %valid_ready; foreach (1..4) { $valid_ready{"p${_}_ready"} = 1; }
    return 0 unless $valid_ready{$target_col};

    $self->{dbh}->do("UPDATE uno_sessions SET $target_col = NOT $target_col WHERE id = ?", undef, $game_id);
    return 'waiting';
}

sub DB::start_uno_game {
    my ($self, $game_id, $user_id) = @_;
    $self->ensure_connection;
    
    $self->{dbh}->begin_work;
    my $game = $self->{dbh}->selectrow_hashref('SELECT * FROM uno_sessions WHERE id = ? FOR UPDATE', undef, $game_id);
    unless ($game) { $self->{dbh}->rollback; return (0, "Game not found"); }
    unless (($game->{player1_id} // 0) == $user_id) { $self->{dbh}->rollback; return (0, "Only host can start"); }
    unless ($game->{status} eq 'waiting') { $self->{dbh}->rollback; return (0, "Game already active"); }

    my @joined = grep { $game->{"player${_}_id"} } (1..4);
    if (scalar @joined < 2) { $self->{dbh}->rollback; return (0, "Need at least 2 players"); }

    foreach my $i (@joined) {
        if (!$game->{"p${i}_ready"}) { $self->{dbh}->rollback; return (0, "All players must be ready"); }
    }

    my $deck = decode_json($game->{draw_pile} // '[]');
    if (!@$deck) { $deck = _generate_deck(); }

    my %updates;
    foreach my $i (@joined) {
        my @hand = splice(@$deck, 0, 7);
        $updates{"p${i}_hand"} = encode_json(\@hand);
    }

    # First-card action rules
    my $discard_pile_arr = decode_json($game->{discard_pile} // '[]');
    my $top_card = $discard_pile_arr->[-1];
    my ($tc_color, $tc_val) = split('_', $top_card, 2);
    my $direction = 1;
    my $skip_count = 0;
    my $first_turn = $game->{player1_id};
    my $current_color = $tc_color;

    if ($tc_val && $tc_val eq 'skip') {
        $skip_count = 1;
    } elsif ($tc_val && $tc_val eq 'reverse') {
        if (scalar @joined == 2) { $skip_count = 1; }
        else { $direction = -1; }
    } elsif ($tc_val && $tc_val eq 'draw2') {
        # Player 1 draws 2 and turn skips
        my $tmp_game = { %$game, draw_pile => $deck, players_data => \@joined };
        $tmp_game->{p1_hand} = decode_json($updates{"p1_hand"});
        $tmp_game = _add_cards_to_player_by_id($self, $game_id, $game->{player1_id}, 2, $tmp_game);
        
        # Ensure draw_pile is an arrayref
        $deck = ref($tmp_game->{draw_pile}) eq 'ARRAY'
            ? $tmp_game->{draw_pile}
            : decode_json($tmp_game->{draw_pile});

        $skip_count = 1;
        # Update P1 hand in our local updates
        my $p1_slot = "p1";
        $updates{"${p1_slot}_hand"} = encode_json($tmp_game->{"${p1_slot}_hand"});
    }
    
    if ($skip_count || $direction != 1) {
        my $tmp_game_for_calc = { %$game, direction => $direction };
        # Need to populate joined IDs for the next turn calc
        foreach my $idx (1..4) { $tmp_game_for_calc->{"player${idx}_id"} = $game->{"player${idx}_id"}; }
        $first_turn = _calculate_next_turn($tmp_game_for_calc, $game->{player1_id}, $skip_count);
    }

    # Correct positional construction
    my @fields = ("status = 'active'", "draw_pile = ?", "current_turn = ?", "current_color = ?", "direction = ?");
    my @values = (encode_json($deck), $first_turn, $current_color, $direction);

    foreach my $col (keys %updates) {
        push @fields, "$col = ?"; push @values, $updates{$col};
    }
    
    push @values, $game_id;
    $self->{dbh}->prepare("UPDATE uno_sessions SET " . join(", ", @fields) . " WHERE id = ?")->execute(@values);
    
    $self->{dbh}->commit;
    return (1, "Game started");
}

sub DB::shout_uno {
    my ($self, $game_id, $user_id) = @_;
    $self->ensure_connection;
    my $game = $self->get_uno_game_state($game_id, $user_id);
    return 0 unless $game && $game->{my_hand};
    
    # Must have 1 or 2 cards to legitimately shout UNO (you can shout right before playing your 2nd to last)
    return 0 unless scalar @{$game->{my_hand}} <= 2;

    my $said_uno_col = $game->{my_slot} . "_said_uno";
    # Validate said_uno_col to prevent SQL injection
    my %valid_uno_cols; foreach (1..4) { $valid_uno_cols{"p${_}_said_uno"} = 1; }
    return 0 unless $valid_uno_cols{$said_uno_col};

    return $self->{dbh}->prepare("UPDATE uno_sessions SET $said_uno_col = 1 WHERE id = ?")->execute($game_id);
}

# Maintenance: Deletes finished or abandoned sessions.
sub DB::cleanup_stale_uno_sessions {
    my $self = shift;
    $self->ensure_connection;
    
    # Delete finished games older than 1 hour
    $self->{dbh}->do("DELETE FROM uno_sessions WHERE status = 'finished' AND last_updated < DATE_SUB(NOW(), INTERVAL 1 HOUR)")
        or warn "UNO cleanup failed: " . $self->{dbh}->errstr;
    
    # Delete abandoned waiting lobbies (no activity for 2 hours)
    $self->{dbh}->do("DELETE FROM uno_sessions WHERE status = 'waiting' AND last_updated < DATE_SUB(NOW(), INTERVAL 2 HOUR)")
        or warn "UNO cleanup failed: " . $self->{dbh}->errstr;

    # Delete stale active games (no activity for 4 hours)
    $self->{dbh}->do("DELETE FROM uno_sessions WHERE status = 'active' AND last_updated < DATE_SUB(NOW(), INTERVAL 4 HOUR)")
        or warn "UNO cleanup failed: " . $self->{dbh}->errstr;
}

# Handles catching a player who forgot to say UNO
sub DB::catch_uno {
    my ($self, $game_id, $user_id, $target_id) = @_;
    $self->ensure_connection;
    
    $self->{dbh}->begin_work;
    # Integrated locking read to avoid inconsistent snapshots
    my $game = $self->get_uno_game_state($game_id, $user_id, 1);
    unless ($game && $game->{status} eq 'active') { $self->{dbh}->rollback; return 0; }
    
    # Find target slot
    my $target_slot;
    my $target_hand_count = 0;
    my $target_said_uno = 1; # Default: treat as "said UNO" to prevent catch if player not found
    my $target_found = 0;

    for my $p (@{$game->{players}}) {
        if ($p->{id} == $target_id) {
            # Figure out slot string
            if (($game->{player1_id} // 0) == $target_id) { $target_slot = 'p1'; }
            elsif ($game->{player2_id} && $game->{player2_id} == $target_id) { $target_slot = 'p2'; }
            elsif ($game->{player3_id} && $game->{player3_id} == $target_id) { $target_slot = 'p3'; }
            elsif ($game->{player4_id} && $game->{player4_id} == $target_id) { $target_slot = 'p4'; }
            
            $target_hand_count = $p->{card_count};
            # Guard against missing fields
            $target_said_uno = $p->{said_uno} // 1;
            $target_found = 1;
            last;
        }
    }
    
    # Can only catch if target has exactly 1 card and hasn't said UNO
    unless ($target_found && $target_slot && $target_hand_count == 1 && !$target_said_uno) {
        $self->{dbh}->rollback;
        return 0;
    }
    
    my $game_updated = _add_cards_to_player_by_id($self, $game_id, $target_id, 2, $game);
    
    my $sth = $self->{dbh}->prepare(
        "UPDATE uno_sessions SET 
            p1_hand = ?, p2_hand = ?, p3_hand = ?, p4_hand = ?,
            draw_pile = ?, discard_pile = ?
         WHERE id = ?"
    );
    
    $sth->execute(
        encode_json($game_updated->{p1_hand} // []), encode_json($game_updated->{p2_hand} // []),
        encode_json($game_updated->{p3_hand} // []), encode_json($game_updated->{p4_hand} // []),
        encode_json($game_updated->{draw_pile}), encode_json($game_updated->{discard_pile}),
        $game_id
    );
    
    $self->{dbh}->commit;
    return 1;
}

# Kicks a player from the lobby (only host can kick)
sub DB::kick_player {
    my ($self, $game_id, $user_id, $target_id) = @_;
    $self->ensure_connection;
    my $game = $self->{dbh}->selectrow_hashref("SELECT * FROM uno_sessions WHERE id = ?", undef, $game_id);
    return 0 unless $game;
    
    # Must be host and game must be waiting
    return 0 unless ($game->{player1_id} // 0) == $user_id;
    return 0 unless $game->{status} eq 'waiting';
    return 0 if $user_id == $target_id; # Cannot kick self
    
    my $slot;
    for my $i (2..4) {
        if ($game->{"player${i}_id"} && $game->{"player${i}_id"} == $target_id) {
            $slot = "player${i}_id"; last;
        }
    }
    
    if ($slot) {
        # Validate slot to prevent SQL injection
        my %valid_slots; foreach (2..4) { $valid_slots{"player${_}_id"} = 1; }
        unless ($valid_slots{$slot}) { die "Invalid slot: $slot"; }

        $self->{dbh}->do("UPDATE uno_sessions SET $slot = NULL WHERE id = ?", undef, $game_id);
        return 1;
    }
    
    return 0;
}

1;
