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

# Renders the personal todo list interface.
# Route: GET /todo
# Parameters: None
# Returns:
#   Rendered HTML template 'todo/list' with user's specific tasks
sub index {
    my $c = shift;
    my $user_id = $c->current_user_id;
    
    my $todos = $c->db->get_user_todos($user_id);
    
    $c->stash(
        todos => $todos,
        title => 'Todo List'
    );
    
    $c->render('todo/list');
}

# Adds a new task to the user's private list.
# Route: POST /todo/add
# Parameters:
#   task_name : Description of the task (String)
# Returns:
#   JSON: { success => 1, id => Int, task_name => String }
sub add {
    my $c = shift;
    my $user_id = $c->current_user_id;
    my $task_name = trim($c->param('task_name') // '');
    
    unless ($task_name) {
        return $c->render(json => { success => 0, error => 'Task cannot be empty' });
    }
    
    if (length($task_name) > 255) {
        return $c->render(json => { success => 0, error => 'Task too long' });
    }
    
    eval {
        my $id = $c->db->add_todo($user_id, $task_name);
        $c->render(json => { success => 1, id => $id, task_name => $task_name });
    };
    if ($@) {
        $c->app->log->error("Failed to add todo: $@");
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Toggles the completion status of a todo item.
# Route: POST /todo/toggle/:id
# Parameters:
#   id : Unique task identifier
# Returns:
#   JSON: { success => 1 } or error message
sub toggle {
    my $c = shift;
    my $user_id = $c->current_user_id;
    my $id = $c->param('id');
    
    eval {
        if ($c->db->toggle_todo($id, $user_id)) {
            $c->render(json => { success => 1 });
        } else {
            $c->render(json => { success => 0, error => 'Not found or unauthorized' });
        }
    };
    if ($@) {
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Permanently removes a task from the user's list.
# Route: POST /todo/delete/:id
# Parameters:
#   id : Unique task identifier
# Returns:
#   JSON: { success => 1 } or error message
sub delete {
    my $c = shift;
    my $user_id = $c->current_user_id;
    my $id = $c->param('id');
    
    eval {
        if ($c->db->delete_todo($id, $user_id)) {
            $c->render(json => { success => 1 });
        } else {
            $c->render(json => { success => 0, error => 'Not found or unauthorized' });
        }
    };
    if ($@) {
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Updates the text content of an existing task.
# Route: POST /todo/edit/:id
# Parameters:
#   id        : Unique task identifier
#   task_name : New description text
# Returns:
#   JSON: { success => 1 } or error message
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
            $c->render(json => { success => 1 });
        } else {
            $c->render(json => { success => 0, error => 'Not found or unauthorized' });
        }
    };
    if ($@) {
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Bulk deletes all completed tasks for the current user.
# Route: POST /todo/clear
# Parameters: None
# Returns:
#   Redirects back to index page
sub clear_completed {
    my $c = shift;
    my $user_id = $c->current_user_id;
    
    eval {
        $c->db->clear_completed_todos($user_id);
        $c->redirect_to('/todo');
    };
    if ($@) {
        $c->render_error('Failed to clear tasks');
    }
}

1;
