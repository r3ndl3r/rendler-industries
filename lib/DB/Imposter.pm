# /lib/DB/Imposter.pm

package DB::Imposter;
use strict;
use warnings;

# Database helper for "Imposter" game player management.
# Features:
#   - Retrieve full player roster
#   - Add new players (idempotent via INSERT IGNORE)
#   - Remove existing players
# Integration points:
#   - Extends DB package via package injection
#   - Direct DBI usage for SQL operations

# Inject methods into the main DB package
package DB;

# Retrieves all registered players from the database.
# Parameters: None
# Returns:
#   ArrayRef of strings: ['Player1', 'Player2', ...] (sorted alphabetically)
sub get_all_players {
    my $self = shift;
    
    # Prepare and execute query
    my $sth = $self->{dbh}->prepare("SELECT name FROM imposter_players ORDER BY name ASC");
    $sth->execute();
    
    # Collect names into simple list
    my @players;
    while (my $row = $sth->fetchrow_arrayref) {
        push @players, $row->[0];
    }
    return \@players;
}

# Adds a player to the persistent roster.
# Parameters:
#   name : Name of the player to add
# Returns:
#   Result of execute() (true on success)
sub add_imposter_player {
    my ($self, $name) = @_;
    
    # Use INSERT IGNORE to handle duplicate names gracefully without error
    my $sth = $self->{dbh}->prepare("INSERT IGNORE INTO imposter_players (name) VALUES (?)");
    return $sth->execute($name);
}

# Removes a player from the persistent roster.
# Parameters:
#   name : Name of the player to remove
# Returns:
#   Result of execute() (true on success)
sub remove_imposter_player {
    my ($self, $name) = @_;
    
    # Execute deletion for specified player
    my $sth = $self->{dbh}->prepare("DELETE FROM imposter_players WHERE name = ?");
    return $sth->execute($name);
}

1;