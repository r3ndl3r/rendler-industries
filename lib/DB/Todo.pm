# /lib/DB/Todo.pm

package DB::Todo;

use strict;
use warnings;

# Database helper for user-specific Todo lists.
# Features:
#   - User-scoped task segregation
#   - Full CRUD operations (Add, Toggle, Delete, Update)
#   - Batch cleanup of completed tasks
# Integration points:
#   - Extends DB package via package injection
#   - Scoped by user_id for all operations

# Retrieves all todo items for a specific user.
# Parameters:
#   user_id : Unique identifier for the user
# Returns:
#   ArrayRef of HashRefs containing task details
sub DB::get_user_todos {
    my ($self, $user_id) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        SELECT id, task_name, is_completed, created_at
        FROM todo_list 
        WHERE user_id = ?
        ORDER BY is_completed ASC, created_at DESC
    ");
    $sth->execute($user_id);
    
    return $sth->fetchall_arrayref({});
}

# Adds a new task to a user's todo list.
# Parameters:
#   user_id   : Unique identifier for the user
#   task_name : The content of the task
# Returns:
#   Integer : ID of the newly created task
sub DB::add_todo {
    my ($self, $user_id, $task_name) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        INSERT INTO todo_list (user_id, task_name, is_completed) 
        VALUES (?, ?, 0)
    ");
    $sth->execute($user_id, $task_name);
    
    return $self->{dbh}->last_insert_id();
}

# Toggles the completion status of a todo item.
# Parameters:
#   id      : Unique ID of the task
#   user_id : User ID for ownership verification
# Returns:
#   Boolean : Success status
sub DB::toggle_todo {
    my ($self, $id, $user_id) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        UPDATE todo_list 
        SET is_completed = NOT is_completed
        WHERE id = ? AND user_id = ?
    ");
    return $sth->execute($id, $user_id) > 0;
}

# Removes a single task from the user's list.
# Parameters:
#   id      : Unique ID of the task
#   user_id : User ID for ownership verification
# Returns:
#   Boolean : Success status
sub DB::delete_todo {
    my ($self, $id, $user_id) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("DELETE FROM todo_list WHERE id = ? AND user_id = ?");
    return $sth->execute($id, $user_id) > 0;
}

# Updates the text of an existing task.
# Parameters:
#   id        : Unique ID of the task
#   user_id   : User ID for ownership verification
#   task_name : New content for the task
# Returns:
#   Boolean : Success status
sub DB::update_todo {
    my ($self, $id, $user_id, $task_name) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        UPDATE todo_list 
        SET task_name = ?
        WHERE id = ? AND user_id = ?
    ");
    return $sth->execute($task_name, $id, $user_id) > 0;
}

# Removes all completed tasks for a specific user.
# Parameters:
#   user_id : Unique identifier for the user
# Returns:
#   Integer : Number of rows deleted
sub DB::clear_completed_todos {
    my ($self, $user_id) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("DELETE FROM todo_list WHERE user_id = ? AND is_completed = 1");
    $sth->execute($user_id);
    return $sth->rows;
}

1;
