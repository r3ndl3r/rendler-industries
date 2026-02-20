# /lib/DB/Chess.pm

package DB::Chess;

use strict;
use warnings;

# Database helper for Chess Game Logic.
# Features:
#   - Lobby management (Create, Join, List)
#   - Game State management (FEN string serialization)
# Integration points:
#   - Extends DB package via package injection
#   - Uses standard FEN (Forsyth-Edwards Notation) strings to maintain board state

# Creates a new game lobby for the user.
# Uses FEN strings to represent the initial standard chess board state.
# Parameters:
#   user_id : Unique ID of the host player
# Returns:
#   Integer ID of the newly created game session
sub DB::create_chess_lobby {
    my ($self, $user_id) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Standard chess starting position FEN string
    my $initial_fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    
    # Cleanup: Delete old "waiting" lobbies by this user to maintain hygiene
    $self->{dbh}->do("DELETE FROM chess_sessions WHERE player1_id = ? AND status = 'waiting'", undef, $user_id);

    my $sth = $self->{dbh}->prepare(
        "INSERT INTO chess_sessions (player1_id, current_turn, fen_state, status, game_type) VALUES (?, ?, ?, 'waiting', 'chess')"
    );
    $sth->execute($user_id, $user_id, $initial_fen);
    
    return $self->{dbh}->last_insert_id(undef, undef, undef, undef);
}

# Retrieves a list of all games currently in 'waiting' status.
# Parameters: None
# Returns:
#   ArrayRef of HashRefs containing open game details (id, host_name, player1_id, created_at)
sub DB::get_open_chess_lobbies {
    my $self = shift;
    
    $self->ensure_connection;
    
    return $self->{dbh}->selectall_arrayref(
        "SELECT g.id, u.username as host_name, g.player1_id, g.created_at 
         FROM chess_sessions g 
         JOIN users u ON g.player1_id = u.id 
         WHERE g.status = 'waiting' AND g.game_type = 'chess'
         ORDER BY g.created_at DESC",
        { Slice => {} }
    );
}

# Retrieves all games (active or waiting) involving the specified user.
# Parameters:
#   user_id : Unique ID of the user
# Returns:
#   ArrayRef of HashRefs containing game details
sub DB::get_user_chess_games {
    my ($self, $user_id) = @_;
    
    $self->ensure_connection;
    
    my $sql = "
        SELECT g.id, u1.username as p1_name, u2.username as p2_name, g.status, g.created_at
        FROM chess_sessions g
        JOIN users u1 ON g.player1_id = u1.id
        LEFT JOIN users u2 ON g.player2_id = u2.id
        WHERE (g.player1_id = ? OR g.player2_id = ?)
          AND g.status IN ('waiting', 'active')
          AND g.game_type = 'chess'
        ORDER BY g.created_at DESC
    ";
    
    return $self->{dbh}->selectall_arrayref($sql, { Slice => {} }, $user_id, $user_id);
}

# Adds a second player to an existing lobby or allows a player to re-join an active one.
# Parameters:
#   game_id : Target game ID
#   user_id : ID of the joining/re-joining player
# Returns:
#   Result of execute() (true on success, 0 on failure)
sub DB::join_chess_lobby {
    my ($self, $game_id, $user_id) = @_;
    
    $self->ensure_connection;
    
    # Retrieve existing participants
    my $game = $self->{dbh}->selectrow_hashref("SELECT player1_id, player2_id, status FROM chess_sessions WHERE id = ?", undef, $game_id);
    return 0 unless $game;

    # Allow re-joining if already a player
    if (($game->{player1_id} && $game->{player1_id} == $user_id) || ($game->{player2_id} && $game->{player2_id} == $user_id)) {
        return 1;
    }

    # Prevent host from joining as player 2
    return 0 if ($game->{player1_id} && $game->{player1_id} == $user_id);

    # Standard join for player 2 if game is still waiting
    if ($game->{status} eq 'waiting') {
        my $sth = $self->{dbh}->prepare(
            "UPDATE chess_sessions SET player2_id = ?, status = 'active' WHERE id = ? AND status = 'waiting'"
        );
        return $sth->execute($user_id, $game_id);
    }

    return 0;
}

# Retrieves full game record including the current FEN state.
# Parameters:
#   game_id : Unique game ID
# Returns:
#   HashRef containing full game record, or undef if not found
sub DB::get_chess_game_state {
    my ($self, $game_id) = @_;
    
    $self->ensure_connection;
    
    # Joins users table to get names
    my $sql = "
        SELECT g.*, 
               u1.username as p1_name, 
               u2.username as p2_name
        FROM chess_sessions g
        LEFT JOIN users u1 ON g.player1_id = u1.id
        LEFT JOIN users u2 ON g.player2_id = u2.id
        WHERE g.id = ?
    ";
    
    return $self->{dbh}->selectrow_hashref($sql, undef, $game_id);
}

# Processes a board state update after a move is verified.
# Because chess validation (en passant, castling, pins) is highly complex, 
# the FEN generation and validation is delegated to the frontend/controller logic.
# Parameters:
#   game_id      : Unique game ID
#   next_turn_id : User ID of the player whose turn is next
#   new_fen      : The updated FEN string after the move
#   status       : Game status string ('active', 'finished')
#   winner_id    : User ID of winner (if finished), 0 for draw, undef otherwise
# Returns:
#   Boolean (1 for success, 0 for failure)
sub DB::update_chess_game_state {
    my ($self, $game_id, $next_turn_id, $new_fen, $status, $winner_id) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare(
        "UPDATE chess_sessions SET fen_state = ?, current_turn = ?, status = ?, winner_id = ? WHERE id = ?"
    );
    return $sth->execute($new_fen, $next_turn_id, $status, $winner_id, $game_id);
}

1;