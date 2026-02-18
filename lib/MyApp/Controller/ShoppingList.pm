# /lib/MyApp/Controller/ShoppingList.pm

package MyApp::Controller::ShoppingList;
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
# Parameters: None
# Returns:
#   Rendered HTML template 'shopping/list' with active items
sub index {
    my $c = shift;
    
    # Retrieve current list state
    my $items = $c->db->get_shopping_items();
    
    $c->stash(
        items => $items,
        username => $c->session('user')
    );
    
    $c->render('shopping/list');
}

# Adds a new item to the list.
# Route: POST /shopping/add
# Parameters:
#   item_name : Description of item (max 255 chars)
# Returns:
#   Redirects to list view
#   Renders error on validation failure
sub add {
    my $c = shift;
    
    my $item_name = trim($c->param('item_name') // '');
    my $added_by = $c->session('user');
    
    # Validate input presence
    unless ($item_name) {
        return $c->render_error('Item name cannot be empty');
    }
    
    # Validate input length
    if (length($item_name) > 255) {
        return $c->render_error('Item name too long (max 255 characters)');
    }
    
    # Persist new item
    $c->db->add_shopping_item($item_name, $added_by);
    $c->redirect_to('/shopping');
}

# Toggles the completion status of an item.
# Route: POST /shopping/toggle
# Parameters:
#   id : Unique Item ID
# Returns:
#   Redirects to list view
#   Renders error on validation failure
sub toggle {
    my $c = shift;
    
    my $id = $c->param('id');
    
    # Validate ID format
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render_error('Invalid item ID');
    }
    
    # Execute toggle logic
    $c->db->toggle_shopping_item($id);
    $c->redirect_to('/shopping');
}

# Permanently removes an item.
# Route: POST /shopping/delete
# Parameters:
#   id : Unique Item ID
# Returns:
#   Redirects to list view
#   Renders error on validation failure
sub delete {
    my $c = shift;
    
    my $id = $c->param('id');
    
    # Validate ID format
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render_error('Invalid item ID');
    }
    
    # Execute deletion
    $c->db->delete_shopping_item($id);
    $c->redirect_to('/shopping');
}

# Bulk deletes all completed items.
# Route: POST /shopping/clear
# Parameters: None
# Returns:
#   Redirects to list view
sub clear_checked {
    my $c = shift;
    
    # Execute batch cleanup
    $c->db->clear_checked_items();
    $c->redirect_to('/shopping');
}

# Updates an existing item's description.
# Route: POST /shopping/edit
# Parameters:
#   id        : Unique Item ID
#   item_name : New description (max 255 chars)
# Returns:
#   Redirects to list view
#   Renders error on validation failure
sub edit {
    my $c = shift;
    
    my $id = $c->param('id');
    my $item_name = trim($c->param('item_name') // '');
    
    # Validate ID format
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render_error('Invalid item ID');
    }
    
    # Validate input presence
    unless ($item_name) {
        return $c->render_error('Item name cannot be empty');
    }
    
    # Validate input length
    if (length($item_name) > 255) {
        return $c->render_error('Item name too long (max 255 characters)');
    }
    
    # Execute update
    $c->db->update_shopping_item($id, $item_name);
    $c->redirect_to('/shopping');
}

1;