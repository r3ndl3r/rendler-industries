# /lib/MyApp/Controller/Todo.pm

package MyApp::Controller::Todo;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for user-specific segregated Todo lists.
# Features:
#   - Personal list view with active/completed separation
#   - AJAX-driven task management (Add, Toggle, Edit, Delete)
#   - Bulk cleanup of completed tasks
# Integration points:
#   - Scoped by current_user_id for strict privacy
#   - Uses DB::Todo helpers for data persistence

# Initial page load - Renders the SPA container.
# Route: GET /todo
# Parameters: None
sub index {
    my $c = shift;
    $c->render('todo');
}

# API: Get current state (Active + Completed tasks).
# Route: GET /todo/api/state
# Returns: JSON object { todos }
sub api_state {
    my $c = shift;
    my $user_id = $c->current_user_id;
    
    my $todos = $c->db->get_user_todos($user_id);
    
    $c->render(json => { 
        success => 1,
        todos   => $todos 
    });
}

# Adds a new task to the user's private list.
# Route: POST /todo/api/add
sub add {
    my $c = shift;
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

# Toggles the completion status of a todo item.
# Route: POST /todo/api/toggle/:id
sub toggle {
    my $c = shift;
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

# Permanently removes a task from the user's list.
# Route: POST /todo/api/delete/:id
sub delete {
    my $c = shift;
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

# Updates the text content of an existing task.
# Route: POST /todo/api/edit/:id
sub edit {
    my $c = shift;
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

# Bulk deletes all completed tasks for the current user.
# Route: POST /todo/api/clear
sub clear_completed {
    my $c = shift;
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
