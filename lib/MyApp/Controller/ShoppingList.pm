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
    
    $c->render('shopping');
}

# Adds a new item to the list.
# Route: POST /shopping/add
# Parameters:
#   item_name : Description of item (max 255 chars)
# Returns:
#   JSON: { success => 1, id => Int, item_name => String, added_by => String }
sub add {
    my $c = shift;
    
    my $item_name = trim($c->param('item_name') // '');
    my $added_by = $c->session('user');
    
    unless ($item_name) {
        return $c->render(json => { success => 0, error => 'Item name cannot be empty' });
    }
    
    if (length($item_name) > 255) {
        return $c->render(json => { success => 0, error => 'Item name too long' });
    }
    
    eval {
        my $sth = $c->db->{dbh}->prepare("INSERT INTO shopping_list (item_name, added_by, is_checked) VALUES (?, ?, 0)");
        $sth->execute($item_name, $added_by);
        my $id = $c->db->{dbh}->last_insert_id();
        $c->render(json => { success => 1, id => $id, item_name => $item_name, added_by => $added_by });
    };
    if ($@) {
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Toggles the completion status of an item via AJAX.
# Route: POST /shopping/toggle
sub toggle {
    my $c = shift;
    my $id = $c->param('id');
    
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => 'Invalid ID' });
    }
    
    eval {
        $c->db->toggle_shopping_item($id);
        $c->render(json => { success => 1 });
    };
    if ($@) {
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Permanently removes an item via AJAX.
# Route: POST /shopping/delete
sub delete {
    my $c = shift;
    my $id = $c->param('id');
    
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => 'Invalid ID' });
    }
    
    eval {
        $c->db->delete_shopping_item($id);
        $c->render(json => { success => 1 });
    };
    if ($@) {
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Updates an item description via AJAX.
# Route: POST /shopping/edit
sub edit {
    my $c = shift;
    my $id = $c->param('id');
    my $item_name = trim($c->param('item_name') // '');
    
    unless ($item_name) {
        return $c->render(json => { success => 0, error => 'Name cannot be empty' });
    }
    
    eval {
        $c->db->update_shopping_item($id, $item_name);
        $c->render(json => { success => 1 });
    };
    if ($@) {
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

# Bulk deletes all completed items.
# Route: POST /shopping/clear
sub clear_checked {
    my $c = shift;
    $c->db->clear_checked_items();
    $c->redirect_to('/shopping');
}

1;