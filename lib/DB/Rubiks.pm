# /lib/DB/Rubiks.pm

package DB::Rubiks;

use strict;
use warnings;

# Database library for managing Rubik's algorithms and state.
#
# Features:
#   - Global algorithm storage for family members.
#   - CRUD operations for algorithms.
#   - Category-based organization.

# Creates a new algorithm entry.
sub DB::create_algorithm {
    my ($self, $name, $sequence, $category, $user_id) = @_;
    $self->ensure_connection;
    
    return $self->{dbh}->do(
        'INSERT INTO rubiks_algorithms (name, sequence, category, created_by) VALUES (?, ?, ?, ?)',
        undef, $name, $sequence, $category || 'General', $user_id
    );
}

# Returns all saved algorithms.
sub DB::get_all_algorithms {
    my ($self) = @_;
    $self->ensure_connection;

    return $self->{dbh}->selectall_arrayref(
        'SELECT a.*, u.username as creator 
         FROM rubiks_algorithms a 
         JOIN users u ON a.created_by = u.id 
         ORDER BY a.category ASC, a.name ASC',
        { Slice => {} }
    );
}

# Updates an existing algorithm.
sub DB::update_algorithm {
    my ($self, $id, $name, $sequence, $category, $user_id) = @_;
    $self->ensure_connection;

    return $self->{dbh}->do(
        'UPDATE rubiks_algorithms SET name = ?, sequence = ?, category = ? WHERE id = ? AND created_by = ?',
        undef, $name, $sequence, $category, $id, $user_id
    );
}

# Removes an algorithm.
sub DB::delete_algorithm {
    my ($self, $id, $user_id) = @_;
    $self->ensure_connection;
    
    return $self->{dbh}->do(
        'DELETE FROM rubiks_algorithms WHERE id = ? AND created_by = ?', 
        undef, $id, $user_id
    );
}

# Records a timed solve for the current user.
sub DB::create_rubiks_solve {
    my ($self, $user_id, $cube_type, $duration_ms) = @_;
    $self->ensure_connection;

    return $self->{dbh}->do(
        'INSERT INTO rubiks_solves (user_id, cube_type, duration_ms, started_at, solved_at)
         VALUES (?, ?, ?, DATE_SUB(NOW(3), INTERVAL ? MICROSECOND), NOW(3))',
        undef, $user_id, $cube_type, $duration_ms, $duration_ms * 1000
    );
}

# Returns the solve history for a single user.
sub DB::get_rubiks_solves {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    return $self->{dbh}->selectall_arrayref(
        'SELECT id, cube_type, duration_ms, started_at, solved_at
         FROM rubiks_solves
         WHERE user_id = ?
         ORDER BY solved_at DESC, id DESC
         LIMIT 500',
        { Slice => {} }, $user_id
    );
}

# Reassigns the cube type of one timed solve owned by the current user.
# Swaps 3x3 to 4x4 or 4x4 to 3x3 automatically.
sub DB::reassign_rubiks_solve_cube_type {
    my ($self, $id, $user_id) = @_;
    $self->ensure_connection;

    return $self->{dbh}->do(
        'UPDATE rubiks_solves
         SET cube_type = CASE cube_type
             WHEN "3x3" THEN "4x4"
             WHEN "4x4" THEN "3x3"
         END
         WHERE id = ? AND user_id = ? AND cube_type IN ("3x3", "4x4")',
        undef, $id, $user_id
    );
}

# Deletes one timed solve owned by the current user.
sub DB::delete_rubiks_solve {
    my ($self, $id, $user_id) = @_;
    $self->ensure_connection;

    return $self->{dbh}->do(
        'DELETE FROM rubiks_solves WHERE id = ? AND user_id = ?',
        undef, $id, $user_id
    );
}

1;
