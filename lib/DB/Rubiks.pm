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

1;
