# /lib/DB/Connect4.pm

package DB::Connect4;

use strict;
use warnings;
use Mojo::JSON qw(encode_json decode_json);

# Database helper for Connect 4 Game Logic.
# Features:
#   - Lobby management (Create, Join, List)
#   - Game State management (Move validation, Gravity logic)
#   - Win detection (Horizontal, Vertical, Diagonal)
# Integration points:
#   - Extends DB package via package injection
#   - Uses Mojo::JSON for board state serialization

# Creates a new game lobby for the user.
# Parameters:
#   user_id : Unique ID of the host player
# Returns:
#   Integer ID of the newly created game session
sub DB::create_connect4_lobby {
    my ($self, $user_id) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Initialize empty 6x7 board (0 = empty)
    # 6 Rows (0-5), 7 Columns (0-6)
    my @board;
    for (1..6) { push @board, [0,0,0,0,0,0,0]; }
    my $json_board = encode_json(\@board);
    
    # Cleanup: Delete old "waiting" lobbies by this user to maintain hygiene
    $self->{dbh}->do("DELETE FROM connect4_sessions WHERE player1_id = ? AND status = 'waiting'", undef, $user_id);

    my $sth = $self->{dbh}->prepare(
        "INSERT INTO connect4_sessions (player1_id, current_turn, board_state, status, game_type) VALUES (?, ?, ?, 'waiting', 'connect4')"
    );
    $sth->execute($user_id, $user_id, $json_board);
    
    return $self->{dbh}->last_insert_id(undef, undef, undef, undef);
}

# Retrieves a list of all games currently in 'waiting' status.
# Parameters: None
# Returns:
#   ArrayRef of HashRefs containing open game details (id, host_name, created_at)
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

# Adds a second player to an existing lobby.
# Parameters:
#   game_id : Target game ID
#   user_id : ID of the joining player
# Returns:
#   Result of execute() (true on success, 0 on failure)
sub DB::join_connect4_lobby {
    my ($self, $game_id, $user_id) = @_;
    
    $self->ensure_connection;
    
    # Prevent user from joining their own game
    my ($p1) = $self->{dbh}->selectrow_array("SELECT player1_id FROM connect4_sessions WHERE id = ?", undef, $game_id);
    return 0 if ($p1 && $p1 == $user_id);

    my $sth = $self->{dbh}->prepare(
        "UPDATE connect4_sessions SET player2_id = ?, status = 'active' WHERE id = ? AND status = 'waiting'"
    );
    return $sth->execute($user_id, $game_id);
}

# Retrieves full game record and deserializes the board state.
# Parameters:
#   game_id : Unique game ID
# Returns:
#   HashRef containing full game record with decoded 'board' field, or undef if not found
sub DB::get_connect4_game_state {
    my ($self, $game_id) = @_;
    
    $self->ensure_connection;
    
    # Joins users table to get names
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

# Processes a player move, updates board, and checks win conditions.
# Parameters:
#   game_id : Unique game ID
#   user_id : Player making the move
#   col     : Column index (0-6)
# Returns:
#   Boolean (1 for success/valid move, 0 for invalid move or failure)
sub DB::make_connect4_move {
    my ($self, $game_id, $user_id, $col) = @_;
    
    # Retrieve current state to validate move
    my $game = $self->get_connect4_game_state($game_id);
    
    # Validation Checks
    return 0 unless $game && $game->{status} eq 'active';
    return 0 unless $game->{current_turn} == $user_id;
    return 0 if $col < 0 || $col > 6;

    my $board = $game->{board};
    my $player_num = ($game->{player1_id} == $user_id) ? 1 : 2;
    my $placed_row = -1;

    # Gravity Logic: Find lowest empty spot in column
    # Iterate from bottom (row 5) to top (row 0)
    for (my $row = 5; $row >= 0; $row--) {
        if ($board->[$row][$col] == 0) {
            $board->[$row][$col] = $player_num;
            $placed_row = $row;
            last;
        }
    }
    return 0 if $placed_row == -1; # Column is full

    # Check Win Condition
    my $winner = _check_win($board, $player_num);
    
    # Determine next state
    my $next_turn = ($winner) ? 0 : ($player_num == 1 ? $game->{player2_id} : $game->{player1_id});
    my $status = ($winner) ? 'finished' : 'active';
    
    # Check for Draw (Board full)
    if (!$winner && _is_board_full($board)) {
        $status = 'finished';
        $winner = 0; # 0 indicates draw
    }
    
    # Persist updates to database
    my $sth = $self->{dbh}->prepare(
        "UPDATE connect4_sessions SET board_state = ?, current_turn = ?, status = ?, winner_id = ? WHERE id = ?"
    );
    $sth->execute(encode_json($board), $next_turn, $status, ($winner ? $user_id : ($status eq 'finished' ? 0 : undef)), $game_id);
    return 1;
}

# Internal Helper: Checks if the board has no empty slots left.
# Parameters:
#   board : 2D Array Reference
# Returns:
#   Boolean (1 if full, 0 if space remains)
sub _is_board_full {
    my $board = shift;
    
    # Check top row. If all filled, board is full.
    for my $c (0..6) {
        return 0 if $board->[0][$c] == 0;
    }
    return 1;
}

# Internal Helper: Checks all possible win vectors (Horizontal, Vertical, Diagonal).
# Parameters:
#   board : 2D Array Reference
#   p     : Player number (1 or 2)
# Returns:
#   Boolean (1 if winner, 0 otherwise)
sub _check_win {
    my ($board, $p) = @_;
    my $rows = 6;
    my $cols = 7;

    # 1. Horizontal Check (-)
    for my $r (0 .. $rows-1) {
        for my $c (0 .. $cols-4) {
            return 1 if ($board->[$r][$c] == $p && $board->[$r][$c+1] == $p && $board->[$r][$c+2] == $p && $board->[$r][$c+3] == $p);
        }
    }

    # 2. Vertical Check (|)
    for my $r (0 .. $rows-4) {
        for my $c (0 .. $cols-1) {
            return 1 if ($board->[$r][$c] == $p && $board->[$r+1][$c] == $p && $board->[$r+2][$c] == $p && $board->[$r+3][$c] == $p);
        }
    }

    # 3. Diagonal Up-Right (/)
    for my $r (3 .. $rows-1) {
        for my $c (0 .. $cols-4) {
            return 1 if ($board->[$r][$c] == $p && $board->[$r-1][$c+1] == $p && $board->[$r-2][$c+2] == $p && $board->[$r-3][$c+3] == $p);
        }
    }

    # 4. Diagonal Down-Right (\)
    for my $r (0 .. $rows-4) {
        for my $c (0 .. $cols-4) {
            return 1 if ($board->[$r][$c] == $p && $board->[$r+1][$c+1] == $p && $board->[$r+2][$c+2] == $p && $board->[$r+3][$c+3] == $p);
        }
    }

    return 0;
}

# Resets the game board for a rematch.
# Parameters:
#   game_id : Unique Game ID
# Returns:
#   1 on success
sub DB::reset_connect4_game {
    my ($self, $game_id) = @_;
    $self->ensure_connection;
    
    # Create fresh empty board
    my @board;
    for (1..6) { push @board, [0,0,0,0,0,0,0]; }
    my $json_board = encode_json(\@board);
    
    # Reset status to 'active', clear winner, keep players
    my $sth = $self->{dbh}->prepare(
        "UPDATE connect4_sessions SET board_state = ?, status = 'active', winner_id = NULL WHERE id = ?"
    );
    return $sth->execute($json_board, $game_id);
}

1;