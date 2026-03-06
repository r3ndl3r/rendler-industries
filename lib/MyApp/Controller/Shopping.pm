# /lib/MyApp/Controller/Shopping.pm

package MyApp::Controller::Shopping;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for the collaborative Shopping List feature.
# Features:
#   - Real-time shared list view
#   - Item lifecycle management (Add, Edit, Delete, Toggle)
#   - Bulk cleanup of completed items
# Integration points:
#   - Depends on authentication context
#   - Uses DB::ShoppingList helpers for persistence

# Renders the shopping list interface.
# Route: GET /shopping
sub index {
    shift->render('shopping');
}

# Returns all shopping list items as JSON for synchronization.
# Route: GET /shopping/api/state
sub api_state {
    my $c = shift;
    my $items = $c->db->get_shopping_items();
    $c->render(json => { 
        success => 1, 
        items   => $items,
        is_admin => $c->is_admin ? 1 : 0
    });
}

# Adds a new item to the list.
# Route: POST /shopping/api/add
sub add {
    my $c = shift;
    my $item_name = trim($c->param('item_name') // '');
    my $added_by = $c->session('user');
    
    unless ($item_name) {
        return $c->render(json => { success => 0, error => 'Item name cannot be empty' });
    }
    
    eval {
        my $id = $c->db->add_shopping_item($item_name, $added_by);
        $c->render(json => { 
            success => 1, 
            id => $id, 
            item_name => $item_name, 
            added_by => $added_by, 
            message => "Item added!" 
        });
    };
    if ($@) {
        $c->app->log->error("Shopping Add Error: $@");
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Toggles the completion status of an item.
# Route: POST /shopping/api/toggle/:id
sub toggle {
    my $c = shift;
    my $id = $c->param('id');
    
    eval {
        $c->db->toggle_shopping_item($id);
        $c->render(json => { success => 1, message => "Item updated" });
    };
    if ($@) {
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Permanently removes an item.
# Route: POST /shopping/api/delete/:id
sub delete {
    my $c = shift;
    my $id = $c->param('id');
    
    eval {
        $c->db->delete_shopping_item($id);
        $c->render(json => { success => 1, message => "Item removed" });
    };
    if ($@) {
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Updates an item description.
# Route: POST /shopping/api/edit/:id
sub edit {
    my $c = shift;
    my $id = $c->param('id');
    my $item_name = trim($c->param('item_name') // '');
    
    unless ($item_name) {
        return $c->render(json => { success => 0, error => 'Name cannot be empty' });
    }
    
    eval {
        $c->db->update_shopping_item($id, $item_name);
        $c->render(json => { success => 1, message => "Item updated" });
    };
    if ($@) {
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Bulk deletes all completed items.
# Route: POST /shopping/api/clear
sub clear_checked {
    my $c = shift;
    
    eval {
        $c->db->clear_checked_items();
    };
    if ($@) {
        return $c->render(json => { success => 0, error => 'Database error' });
    }
    
    return $c->render(json => { success => 1, message => "Cleared completed items" });
}

1;