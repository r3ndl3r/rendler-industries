# /lib/DB/Go.pm

package DB::Go;

use strict;
use warnings;

# Database helper for the internal "Go Links" URL shortener.
# Features:
#   - Retrieve all active go links
#   - Resolve individual go links for redirection
#   - CRUD operations (Create, Read, Update, Delete)
#   - Visit counter tracking
# Integration points:
#   - Extends DB package via package injection
#   - Direct DBI usage for SQL operations

# Inject methods into the main DB package

# Retrieves all registered go links.
# Parameters: None
# Returns:
#   ArrayRef of HashRefs containing go link details
# Behavior:
#   - Sorts by visit count (highest first), then alphabetically by keyword
sub DB::get_go_links {
    my ($self) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Fetch sorted list
    my $sth = $self->{dbh}->prepare("
        SELECT id, keyword, url, description, added_by, visits, created_at 
        FROM go_links 
        ORDER BY visits DESC, keyword ASC
    ");
    $sth->execute();
    
    return $sth->fetchall_arrayref({});
}

# Retrieves a single go link by its keyword.
# Parameters:
#   keyword : The short string mapped to the URL (String)
# Returns:
#   HashRef of the link details, or undef if not found
sub DB::get_go_link {
    my ($self, $keyword) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        SELECT id, keyword, url, description, added_by, visits 
        FROM go_links 
        WHERE keyword = ?
    ");
    $sth->execute($keyword);
    
    return $sth->fetchrow_hashref();
}

# Adds a new go link to the database.
# Parameters:
#   keyword     : The short string for the URL (String)
#   url         : The destination URL (String)
#   description : What the link points to (String)
#   added_by    : Name of the user adding the link (String)
# Returns:
#   Result of execute() (true on success)
sub DB::add_go_link {
    my ($self, $keyword, $url, $description, $added_by) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Insert new record, initializing visits to 0
    my $sth = $self->{dbh}->prepare("
        INSERT INTO go_links (keyword, url, description, added_by, visits) 
        VALUES (?, ?, ?, ?, 0)
    ");
    $sth->execute($keyword, $url, $description, $added_by);
}

# Updates an existing go link.
# Parameters:
#   id          : Unique ID of the link (Int)
#   keyword     : New short string (String)
#   url         : New destination URL (String)
#   description : New description (String)
# Returns:
#   Result of execute() (true on success)
sub DB::update_go_link {
    my ($self, $id, $keyword, $url, $description) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        UPDATE go_links 
        SET keyword = ?, url = ?, description = ?
        WHERE id = ?
    ");
    $sth->execute($keyword, $url, $description, $id);
}

# Removes a go link from the database.
# Parameters:
#   id : Unique ID of the link to delete
# Returns:
#   Result of execute() (true on success)
sub DB::delete_go_link {
    my ($self, $id) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("DELETE FROM go_links WHERE id = ?");
    $sth->execute($id);
}

# Increments the visit counter for a specific go link.
# Parameters:
#   id : Unique ID of the link
# Returns:
#   Result of execute() (true on success)
sub DB::increment_go_link_visits {
    my ($self, $id) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        UPDATE go_links 
        SET visits = visits + 1 
        WHERE id = ?
    ");
    $sth->execute($id);
}

1;