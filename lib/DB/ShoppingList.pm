# /lib/DB/ShoppingList.pm

package DB::ShoppingList;

use strict;
use warnings;

# Database helper for the shared Shopping List feature.
# Features:
#   - Retrieve active and completed shopping items
#   - CRUD operations (Create, Read, Update, Delete)
#   - Batch cleanup of completed items
# Integration points:
#   - Extends DB package via package injection
#   - Direct DBI usage for SQL operations

# Inject methods into the main DB package

# Retrieves all shopping list items.
# Parameters: None
# Returns:
#   ArrayRef of HashRefs containing item details
# Behavior:
#   - Sorts items by status first (unchecked items appear at the top)
#   - Secondary sort by creation time (newest first)
sub DB::get_shopping_items {
    my ($self) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Fetch sorted list
    my $sth = $self->{dbh}->prepare("
        SELECT id, item_name, added_by, is_checked, created_at, checked_at 
        FROM shopping_list 
        ORDER BY is_checked ASC, created_at DESC
    ");
    $sth->execute();
    
    return $sth->fetchall_arrayref({});
}

# Adds a new item to the shopping list.
# Parameters:
#   item_name : Description of the item (String)
#   added_by  : Name of the user adding the item (String)
# Returns:
#   Result of execute() (true on success)
sub DB::add_shopping_item {
    my ($self, $item_name, $added_by) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Insert new item (defaults to unchecked/0)
    my $sth = $self->{dbh}->prepare("
        INSERT INTO shopping_list (item_name, added_by, is_checked) 
        VALUES (?, ?, 0)
    ");
    $sth->execute($item_name, $added_by);
}

# Toggles the completion status of a shopping item.
# Parameters:
#   id : Unique ID of the item
# Returns:
#   Result of execute() (true on success)
# Behavior:
#   - Flips the 'is_checked' boolean
#   - Updates 'checked_at' timestamp based on the new state
sub DB::toggle_shopping_item {
    my ($self, $id) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Perform atomic toggle and timestamp update
    my $sth = $self->{dbh}->prepare("
        UPDATE shopping_list 
        SET is_checked = NOT is_checked,
            checked_at = IF(is_checked = 0, NOW(), NULL)
        WHERE id = ?
    ");
    $sth->execute($id);
}

# Removes a single item from the list.
# Parameters:
#   id : Unique ID of the item to delete
# Returns:
#   Result of execute() (true on success)
sub DB::delete_shopping_item {
    my ($self, $id) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Execute deletion
    my $sth = $self->{dbh}->prepare("DELETE FROM shopping_list WHERE id = ?");
    $sth->execute($id);
}

# Removes all items marked as completed.
# Parameters: None
# Returns:
#   Result of execute() (true on success)
sub DB::clear_checked_items {
    my ($self) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Delete all items where is_checked is true (1)
    my $sth = $self->{dbh}->prepare("DELETE FROM shopping_list WHERE is_checked = 1");
    $sth->execute();
}

# Updates the name/description of an existing item.
# Parameters:
#   id        : Unique ID of the item to update
#   item_name : New description text
# Returns:
#   Result of execute() (true on success)
sub DB::update_shopping_item {
    my ($self, $id, $item_name) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Execute update
    my $sth = $self->{dbh}->prepare("
        UPDATE shopping_list 
        SET item_name = ?
        WHERE id = ?
    ");
    $sth->execute($item_name, $id);
}

1;