# /lib/DB/Go.pm

package DB::Go;

use strict;
use warnings;

# Database Library for the internal Platform Short-Link management system.
#
# Features:
#   - High-speed keyword-to-URL redirection mapping.
#   - Real-time visit analytics and popularity tracking.
#   - Multi-user administrative CRUD operations for link lifecycle.
#   - Alphabetical and popularity-based link discovery.
#
# Privacy Mandate:
#   - Administrative resource; link management is restricted to authorized 
#     system administrators. Short-link resolution is public by design.
#
# Integration Points:
#   - Extends the core DB package via package injection.
#   - Acts as the primary data source for the Go controller.
#   - Provides data payloads for state-driven synchronization.
#   - Integrated with global search for rapid system navigation.

# Retrieves the complete registry of registered short-links.
# Includes owner attribution via user table join.
# Parameters: None
# Returns: ArrayRef of HashRefs [ {id, keyword, url, description, visits, username...}, ... ]
sub DB::get_go_links {
    my ($self) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        SELECT g.id, g.keyword, g.url, g.description, g.owner_id, u.username, g.visits, g.created_at 
        FROM go_links g
        LEFT JOIN users u ON g.owner_id = u.id
        ORDER BY g.visits DESC, g.keyword ASC
    ");
    $sth->execute();
    
    return $sth->fetchall_arrayref({});
}

# Resolves a single short-link by its unique keyword identifier.
# Parameters:
#   - keyword: String short identifier.
# Returns: HashRef of link metadata or undef.
sub DB::get_go_link {
    my ($self, $keyword) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        SELECT id, keyword, url, description, owner_id, visits 
        FROM go_links 
        WHERE keyword = ?
    ");
    $sth->execute($keyword);
    
    return $sth->fetchrow_hashref();
}

# Registers a new short-link redirection mapping.
# Parameters:
#   - keyword: The redirection identifier (String).
#   - url: The target destination (String).
#   - description: Administrative context/notes (String).
#   - owner_id: Numeric identifier of the creating administrator (Int).
# Returns: Result of execute().
sub DB::add_go_link {
    my ($self, $keyword, $url, $description, $owner_id) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        INSERT INTO go_links (keyword, url, description, owner_id, visits) 
        VALUES (?, ?, ?, ?, 0)
    ");
    return $sth->execute($keyword, $url, $description, $owner_id);
}

# Updates the metadata for an existing short-link mapping.
# Parameters:
#   - id: Unique record identifier (Int).
#   - keyword: New redirection identifier (String).
#   - url: New destination target (String).
#   - description: New administrative notes (String).
# Returns: Result of execute().
sub DB::update_go_link {
    my ($self, $id, $keyword, $url, $description) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        UPDATE go_links 
        SET keyword = ?, url = ?, description = ?
        WHERE id = ?
    ");
    return $sth->execute($keyword, $url, $description, $id);
}

# Permanently removes a short-link mapping from the system.
# Parameters:
#   - id: Unique record identifier.
# Returns: Result of execute().
sub DB::delete_go_link {
    my ($self, $id) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("DELETE FROM go_links WHERE id = ?");
    return $sth->execute($id);
}

# Atomically increments the visit analytics for a specific mapping.
# Parameters:
#   - id: Unique record identifier.
# Returns: Result of execute().
sub DB::increment_go_link_visits {
    my ($self, $id) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        UPDATE go_links 
        SET visits = visits + 1 
        WHERE id = ?
    ");
    return $sth->execute($id);
}

1;
