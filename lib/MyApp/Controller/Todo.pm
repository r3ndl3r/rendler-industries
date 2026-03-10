# /lib/MyApp/Controller/Todo.pm

package MyApp::Controller::Todo;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for user-specific segregated Todo lists.
# Features:
#   - Personal list view with active/completed separation
#   - Task management (Add, Toggle, Edit, Delete)
#   - Bulk cleanup of completed tasks
# Integration points:
#   - Scoped by current_user_id for strict privacy
#   - Uses DB::Todo helpers for data persistence

# Renders the task management interface.
# Route: GET /todo
# Parameters: None
# Returns: Rendered HTML template
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render('todo');
}

# Returns the current state of the user's todo list.
# Route: GET /todo/api/state
# Parameters: None
# Returns: JSON object { success, todos }
sub api_state {
    my $c = shift;
    
    # Ensure session is active before state retrieval
    return unless $c->is_logged_in;

    my $user_id = $c->current_user_id;
    my $todos = $c->db->get_user_todos($user_id);
    
    $c->render(json => { 
        success => 1,
        todos   => $todos 
    });
}

# Registers a new task to the user's list.
# Route: POST /todo/api/add
# Parameters: task_name (String)
# Returns: JSON object { success, id, task_name, message }
sub api_add {
    my $c = shift;
    
    # Ensure session is active before state retrieval
    return unless $c->is_logged_in;

    my $user_id = $c->current_user_id;
    my $task_name = trim($c->param('task_name') // '');
    
    unless ($task_name) {
        return $c->render(json => { success => 0, error => 'Task cannot be empty' });
    }
    
    eval {
        my $id = $c->db->add_todo($user_id, $task_name);
        $c->render(json => { 
            success => 1, 
            id => $id, 
            task_name => $task_name, 
            message => "Task added!" 
        });
    };
    if ($@) {
        $c->app->log->error("Failed to add todo: $@");
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Reverses the completion status of a specific task.
# Route: POST /todo/api/toggle/:id
# Parameters: id (Integer)
# Returns: JSON object { success, message }
sub api_toggle {
    my $c = shift;
    
    # Ensure session is active before state retrieval
    return unless $c->is_logged_in;

    my $user_id = $c->current_user_id;
    my $id = $c->param('id');
    
    eval {
        if ($c->db->toggle_todo($id, $user_id)) {
            $c->render(json => { success => 1, message => "Task updated" });
        } else {
            $c->render(json => { success => 0, error => 'Not found or unauthorized' });
        }
    };
    if ($@) {
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Removes a task record from the database.
# Route: POST /todo/api/delete/:id
# Parameters: id (Integer)
# Returns: JSON object { success, message }
sub api_delete {
    my $c = shift;
    
    # Ensure session is active before state retrieval
    return unless $c->is_logged_in;

    my $user_id = $c->current_user_id;
    my $id = $c->param('id');
    
    eval {
        if ($c->db->delete_todo($id, $user_id)) {
            $c->render(json => { success => 1, message => "Task deleted" });
        } else {
            $c->render(json => { success => 0, error => 'Not found or unauthorized' });
        }
    };
    if ($@) {
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Modifies the text content of an existing task.
# Route: POST /todo/api/edit/:id
# Parameters: id (Integer), task_name (String)
# Returns: JSON object { success, message }
sub api_edit {
    my $c = shift;
    
    # Ensure session is active before state retrieval
    return unless $c->is_logged_in;

    my $user_id = $c->current_user_id;
    my $id = $c->param('id');
    my $task_name = trim($c->param('task_name') // '');
    
    unless ($task_name) {
        return $c->render(json => { success => 0, error => 'Task cannot be empty' });
    }
    
    eval {
        if ($c->db->update_todo($id, $user_id, $task_name)) {
            $c->render(json => { success => 1, message => "Task updated" });
        } else {
            $c->render(json => { success => 0, error => 'Not found or unauthorized' });
        }
    };
    if ($@) {
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Removes all tasks marked as completed for the current user.
# Route: POST /todo/api/clear
# Parameters: None
# Returns: JSON object { success, message }
sub api_clear {
    my $c = shift;
    
    # Ensure session is active before state retrieval
    return unless $c->is_logged_in;

    my $user_id = $c->current_user_id;
    
    eval {
        $c->db->clear_completed_todos($user_id);
    };
    if ($@) {
        return $c->render(json => { success => 0, error => 'Failed to clear tasks' });
    }
    
    return $c->render(json => { success => 1, message => "Cleared all completed tasks." });
}

1;
