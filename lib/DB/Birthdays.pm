# /lib/DB/Birthdays.pm

package DB::Birthdays;

use strict;
use warnings;

# Database helper for managing user birthdays.
# Features:
#   - Retrieve list of birthdays sorted by nearest upcoming date (cyclical)
#   - CRUD operations (Create, Read, Update, Delete) for birthday records
# Integration points:
#   - Extends DB package via package injection
#   - Direct DBI usage for SQL operations

# Inject methods into the main DB package
sub DB::get_all_birthdays {
    my $self = shift;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Sorts by "Nearest Upcoming Birthday"
    # Logic: 
    #   1. Compare Month-Day to Today.
    #   2. If it's >= Today, it's "This Year" (Rank 0).
    #   3. If it's < Today, it's "Next Year" (Rank 1).
    #   4. Sort by Rank, then by the calendar date (MM-DD).
    
    my $sql = qq{
        SELECT * FROM birthdays 
        ORDER BY 
            (CASE 
                WHEN DATE_FORMAT(birth_date, '%m-%d') >= DATE_FORMAT(NOW(), '%m-%d') THEN 0 
                ELSE 1 
            END) ASC,
            DATE_FORMAT(birth_date, '%m-%d') ASC
    };
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute();
    
    # Collect rows into array of hashrefs
    my @birthdays;
    while (my $row = $sth->fetchrow_hashref) {
        push @birthdays, $row;
    }
    
    return @birthdays;
}

# Adds a new birthday record to the database.
# Parameters:
#   name       : Name of the person (String)
#   birth_date : Date string (YYYY-MM-DD)
#   emoji      : Associated emoji character (String)
# Returns:
#   Result of execute() (true on success)
sub DB::add_birthday {
    my ($self, $name, $birth_date, $emoji) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Insert new record
    my $sth = $self->{dbh}->prepare(
        "INSERT INTO birthdays (name, birth_date, emoji) VALUES (?, ?, ?)"
    );
    $sth->execute($name, $birth_date, $emoji);
}

# Updates an existing birthday record.
# Parameters:
#   id         : Unique ID of the record to update (Int)
#   name       : New name (String)
#   birth_date : New date string (YYYY-MM-DD)
#   emoji      : New emoji character (String)
# Returns:
#   Result of execute() (true on success)
sub DB::update_birthday {
    my ($self, $id, $name, $birth_date, $emoji) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Update fields for specific ID
    my $sth = $self->{dbh}->prepare(
        "UPDATE birthdays SET name = ?, birth_date = ?, emoji = ? WHERE id = ?"
    );
    $sth->execute($name, $birth_date, $emoji, $id);
}

# Removes a birthday record from the database.
# Parameters:
#   id : Unique ID of the record to delete (Int)
# Returns:
#   Result of execute() (true on success)
sub DB::delete_birthday {
    my ($self, $id) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Execute deletion
    my $sth = $self->{dbh}->prepare("DELETE FROM birthdays WHERE id = ?");
    $sth->execute($id);
}

1;