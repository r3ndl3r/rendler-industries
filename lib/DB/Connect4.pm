# /lib/DB/Connect4.pm

package DB::Connect4;

use strict;
use warnings;
use Mojo::JSON qw(encode_json decode_json);

# Database Library for the Connect 4 multiplayer game engine.
#
# Features:
#   - Lobby orchestration (Creation, joining, and discovery).
#   - Game state management with JSON board serialization.
#   - Real-time move validation and gravity-based piece placement.
#   - Automated win detection (Horizontal, Vertical, and Diagonal vectors).
#
# Privacy Mandate:
#   - Game-scoped isolation; players can only interact with sessions they are 
#     actively participating in. Public data is restricted to the lobby list.
#
# Integration Points:
#   - Extends the core DB package via package injection.
#   - Provides state payloads for real-time polling synchronization.
#   - Coordinates with user systems for participant attribution.

# Creates a new game lobby for the host user.
# Parameters:
#   - user_id: Unique identifier of the host player (Int).
# Returns: Integer ID of the newly created game session.
sub DB::create_connect4_lobby {
    my ($self, $user_id) = @_;
    $self->ensure_connection;
    
    # Initialize empty 6x7 board (0 = empty)
    my @board;
    for (1..6) { push @board, [0,0,0,0,0,0,0]; }
    my $json_board = encode_json(\@board);
    
    # Cleanup: Maintain hygiene by removing old stagnant lobbies
    $self->{dbh}->do("DELETE FROM connect4_sessions WHERE player1_id = ? AND status = 'waiting'", undef, $user_id);

    my $sth = $self->{dbh}->prepare(
        "INSERT INTO connect4_sessions (player1_id, current_turn, board_state, status, game_type) VALUES (?, ?, ?, 'waiting', 'connect4')"
    );
    $sth->execute($user_id, $user_id, $json_board);
    
    return $self->{dbh}->last_insert_id();
}

# Retrieves all game sessions currently awaiting an opponent.
# Parameters: None
# Returns: ArrayRef of HashRefs [ {id, host_name, created_at}, ... ]
sub DB::get_open_connect4_lobbies {
    my $self = shift;
    $self->ensure_connection;
    
    return $self->{dbh}->selectall_arrayref(
        "SELECT g.id, u.username as host_name, g.created_at 
         FROM connect4_sessions g 
         JOIN users u ON g.player1_id = u.id 
         WHERE g.status = 'waiting' AND g.game_type = 'connect4'
         ORDER BY g.created_at DESC",
        { Slice => {} }
    );
}

# Retrieves all active or waiting games involving a specific user.
# Parameters:
#   - user_id: Unique identifier of the user (Int).
# Returns: ArrayRef of HashRefs containing game summaries.
sub DB::get_user_connect4_games {
    my ($self, $user_id) = @_;
    $self->ensure_connection;
    
    my $sql = "
        SELECT g.id, u1.username as p1_name, u2.username as p2_name, g.status, g.created_at
        FROM connect4_sessions g
        JOIN users u1 ON g.player1_id = u1.id
        LEFT JOIN users u2 ON g.player2_id = u2.id
        WHERE (g.player1_id = ? OR g.player2_id = ?)
          AND g.status IN ('waiting', 'active')
          AND g.game_type = 'connect4'
        ORDER BY g.created_at DESC
    ";
    
    return $self->{dbh}->selectall_arrayref($sql, { Slice => {} }, $user_id, $user_id);
}

# Adds a second participant to an established lobby.
# Parameters:
#   - game_id: Target session identifier (Int).
#   - user_id: Identifier of the joining player (Int).
# Returns: Boolean success.
sub DB::join_connect4_lobby {
    my ($self, $game_id, $user_id) = @_;
    $self->ensure_connection;
    
    # Validation: Prevent self-play
    my ($p1) = $self->{dbh}->selectrow_array("SELECT player1_id FROM connect4_sessions WHERE id = ?", undef, $game_id);
    return 0 if ($p1 && $p1 == $user_id);

    my $sth = $self->{dbh}->prepare(
        "UPDATE connect4_sessions SET player2_id = ?, status = 'active' WHERE id = ? AND status = 'waiting'"
    );
    return $sth->execute($user_id, $game_id);
}

# Retrieves full game metadata and deserializes the board matrix.
# Parameters:
#   - game_id: Unique session identifier (Int).
# Returns: HashRef of game state or undef.
sub DB::get_connect4_game_state {
    my ($self, $game_id) = @_;
    $self->ensure_connection;
    
    my $sql = "
        SELECT g.*, 
               u1.username as p1_name, 
               u2.username as p2_name
        FROM connect4_sessions g
        LEFT JOIN users u1 ON g.player1_id = u1.id
        LEFT JOIN users u2 ON g.player2_id = u2.id
        WHERE g.id = ?
    ";
    
    my $game = $self->{dbh}->selectrow_hashref($sql, undef, $game_id);
    return undef unless $game;
    
    $game->{board} = decode_json($game->{board_state});
    return $game;
}

# Processes a column selection, updates the board, and evaluates win conditions.
# Parameters:
#   - game_id: Session identifier (Int).
#   - user_id: Player performing the action (Int).
#   - col: Target column index (0-6).
# Returns: Boolean success.
sub DB::make_connect4_move {
    my ($self, $game_id, $user_id, $col) = @_;
    
    my $game = $self->get_connect4_game_state($game_id);
    
    # Interaction Guards
    return 0 unless $game && $game->{status} eq 'active';
    return 0 unless $game->{current_turn} == $user_id;
    return 0 if $col < 0 || $col > 6;

    my $board = $game->{board};
    my $player_num = ($game->{player1_id} == $user_id) ? 1 : 2;
    my $placed_row = -1;

    # Logic: Gravity resolution
    for (my $row = 5; $row >= 0; $row--) {
        if ($board->[$row][$col] == 0) {
            $board->[$row][$col] = $player_num;
            $placed_row = $row;
            last;
        }
    }
    return 0 if $placed_row == -1;

    # Lifecycle: evaluate game termination
    my $winner = _check_win($board, $player_num);
    my $next_turn = ($winner) ? 0 : ($player_num == 1 ? $game->{player2_id} : $game->{player1_id});
    my $status = ($winner) ? 'finished' : 'active';
    
    if (!$winner && _is_board_full($board)) {
        $status = 'finished';
        $winner = 0; 
    }
    
    my $sth = $self->{dbh}->prepare(
        "UPDATE connect4_sessions SET board_state = ?, current_turn = ?, status = ?, winner_id = ? WHERE id = ?"
    );
    $sth->execute(encode_json($board), $next_turn, $status, ($winner ? $user_id : ($status eq 'finished' ? 0 : undef)), $game_id);
    return 1;
}

# Verifies if any empty slots remain on the board.
# Parameters:
#   - board: 2D matrix reference.
# Returns: Boolean (1 if full).
sub _is_board_full {
    my $board = shift;
    for my $c (0..6) {
        return 0 if $board->[0][$c] == 0;
    }
    return 1;
}

# Scans for four consecutive pieces along all valid vectors.
# Parameters:
#   - board: 2D matrix reference.
#   - p: Player identifier (1 or 2).
# Returns: Boolean (1 if win detected).
sub _check_win {
    my ($board, $p) = @_;
    my $rows = 6;
    my $cols = 7;

    # Vector A: Horizontal
    for my $r (0 .. $rows-1) {
        for my $c (0 .. $cols-4) {
            return 1 if ($board->[$r][$c] == $p && $board->[$r][$c+1] == $p && $board->[$r][$c+2] == $p && $board->[$r][$c+3] == $p);
        }
    }

    # Vector B: Vertical
    for my $r (0 .. $rows-4) {
        for my $c (0 .. $cols-1) {
            return 1 if ($board->[$r][$c] == $p && $board->[$r+1][$c] == $p && $board->[$r+2][$c] == $p && $board->[$r+3][$c] == $p);
        }
    }

    # Vector C: Diagonal (Up-Right)
    for my $r (3 .. $rows-1) {
        for my $c (0 .. $cols-4) {
            return 1 if ($board->[$r][$c] == $p && $board->[$r-1][$c+1] == $p && $board->[$r-2][$c+2] == $p && $board->[$r-3][$c+3] == $p);
        }
    }

    # Vector D: Diagonal (Down-Right)
    for my $r (0 .. $rows-4) {
        for my $c (0 .. $cols-4) {
            return 1 if ($board->[$r][$c] == $p && $board->[$r+1][$c+1] == $p && $board->[$r+2][$c+2] == $p && $board->[$r+3][$c+3] == $p);
        }
    }

    return 0;
}

# Resets the session board for a consecutive round.
# Parameters:
#   - game_id: Unique session identifier (Int).
# Returns: Boolean success.
sub DB::reset_connect4_game {
    my ($self, $game_id) = @_;
    $self->ensure_connection;
    
    my @board;
    for (1..6) { push @board, [0,0,0,0,0,0,0]; }
    my $json_board = encode_json(\@board);
    
    my $sth = $self->{dbh}->prepare(
        "UPDATE connect4_sessions SET board_state = ?, status = 'active', winner_id = NULL WHERE id = ?"
    );
    return $sth->execute($json_board, $game_id);
}

1;
