# /lib/DB/Chess.pm

package DB::Chess;

use strict;
use warnings;

# Database Library for the Chess multiplayer game engine.
#
# Features:
#   - Lobby orchestration (Discovery, Creation, and Re-joining).
#   - Game state management using standard FEN (Forsyth-Edwards Notation).
#   - Real-time move history tracking and turn sequencing.
#   - Collaborative draw negotiation and resignation workflows.
#
# Privacy Mandate:
#   - Session-scoped isolation; users can only interact with sessions they are 
#     participants of. Active state is restricted to authorized players.
#
# Integration Points:
#   - Extends the core DB package via package injection.
#   - Provides FEN state payloads for the frontend chess.js engine.
#   - Coordinates with the user registry for identity resolution.

# Creates a new game lobby initialized with the standard starting position.
# Parameters:
#   - user_id: Unique identifier of the host player (Int).
# Returns: Integer ID of the newly created game session.
sub DB::create_chess_lobby {
    my ($self, $user_id) = @_;
    $self->ensure_connection;
    
    # Forsyth-Edwards Notation: Standard starting position
    my $initial_fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    
    # Cleanup: remove stagnant waiting sessions by this user
    $self->{dbh}->do("DELETE FROM chess_sessions WHERE player1_id = ? AND status = 'waiting'", undef, $user_id);

    my $sth = $self->{dbh}->prepare(
        "INSERT INTO chess_sessions (player1_id, current_turn, fen_state, status, game_type) VALUES (?, ?, ?, 'waiting', 'chess')"
    );
    $sth->execute($user_id, $user_id, $initial_fen);
    
    return $self->{dbh}->last_insert_id();
}

# Retrieves all game sessions currently awaiting an opponent.
# Parameters: None
# Returns: ArrayRef of HashRefs [ {id, host_name, player1_id, created_at}, ... ]
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

# Retrieves all active or waiting games involving a specific user.
# Parameters:
#   - user_id: Unique identifier of the user (Int).
# Returns: ArrayRef of HashRefs containing game summaries.
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

# Registers a participant in a waiting lobby or facilitates session re-joining.
# Parameters:
#   - game_id: Session identifier (Int).
#   - user_id: Participant identifier (Int).
# Returns: Boolean success.
sub DB::join_chess_lobby {
    my ($self, $game_id, $user_id) = @_;
    $self->ensure_connection;
    
    my $game = $self->{dbh}->selectrow_hashref("SELECT player1_id, player2_id, status FROM chess_sessions WHERE id = ?", undef, $game_id);
    return 0 unless $game;

    # If the user is already a participant, confirm success immediately.
    if (($game->{player1_id} && $game->{player1_id} == $user_id) || ($game->{player2_id} && $game->{player2_id} == $user_id)) {
        return 1;
    }

    # The host cannot occupy both player slots.
    return 0 if ($game->{player1_id} && $game->{player1_id} == $user_id);

    if ($game->{status} eq 'waiting') {
        my $sth = $self->{dbh}->prepare(
            "UPDATE chess_sessions SET player2_id = ?, status = 'active' WHERE id = ? AND status = 'waiting'"
        );
        return $sth->execute($user_id, $game_id);
    }

    return 0;
}

# Retrieves full game record and current board state.
# Parameters:
#   - game_id: Unique session identifier (Int).
# Returns: HashRef of game metadata or undef.
sub DB::get_chess_game_state {
    my ($self, $game_id) = @_;
    $self->ensure_connection;
    
    my $sql = "
        SELECT g.id, g.player1_id, g.player2_id, g.current_turn, g.fen_state, g.status, g.winner_id, g.draw_offered_by, g.last_move, g.created_at,
               u1.username as p1_name, 
               u2.username as p2_name
        FROM chess_sessions g
        LEFT JOIN users u1 ON g.player1_id = u1.id
        LEFT JOIN users u2 ON g.player2_id = u2.id
        WHERE g.id = ?
    ";
    
    return $self->{dbh}->selectrow_hashref($sql, undef, $game_id);
}

# Initiates a draw request from a specific participant.
# Parameters:
#   - game_id: Session identifier (Int).
#   - user_id: Requesting participant identifier (Int).
# Returns: Boolean success.
sub DB::offer_chess_draw {
    my ($self, $game_id, $user_id) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("UPDATE chess_sessions SET draw_offered_by = ? WHERE id = ? AND status = 'active'");
    return $sth->execute($user_id, $game_id);
}

# Processes the resolution of a pending draw offer.
# Parameters:
#   - game_id: Session identifier (Int).
#   - accepted: Boolean (1 for resolution, 0 for refusal).
# Returns: Boolean success.
sub DB::respond_chess_draw {
    my ($self, $game_id, $accepted) = @_;
    $self->ensure_connection;
    
    if ($accepted) {
        my $sth = $self->{dbh}->prepare("UPDATE chess_sessions SET status = 'finished', winner_id = 0, draw_offered_by = NULL WHERE id = ?");
        return $sth->execute($game_id);
    } else {
        my $sth = $self->{dbh}->prepare("UPDATE chess_sessions SET draw_offered_by = NULL WHERE id = ?");
        return $sth->execute($game_id);
    }
}

# Atomically updates the FEN state and sequences the next turn.
# Parameters:
#   - game_id: Unique session identifier (Int).
#   - next_turn_id: Identifier of the next active player (Int).
#   - new_fen: Forsyth-Edwards Notation string of the new state (String).
#   - status: Current game phase (active, finished).
#   - winner_id: Victor identifier or 0 for draw (Int/undef).
#   - last_move: Coordinates of the executed move (String).
# Returns: Boolean success.
sub DB::update_chess_game_state {
    my ($self, $game_id, $next_turn_id, $new_fen, $status, $winner_id, $last_move) = @_;
    $self->ensure_connection;
    
    # All pending draw offers are invalidated upon any valid board movement.
    my $sth = $self->{dbh}->prepare(
        "UPDATE chess_sessions SET fen_state = ?, current_turn = ?, status = ?, winner_id = ?, draw_offered_by = NULL, last_move = ? WHERE id = ?"
    );
    return $sth->execute($new_fen, $next_turn_id, $status, $winner_id, $last_move, $game_id);
}

1;
