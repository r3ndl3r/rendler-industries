# /lib/DB/Messages.pm

package DB::Messages;

use strict;
use warnings;

# Database helper for the "Copy/Paste" clipboard history feature.
# Features:
#   - Store text snippets or URLs (Write)
#   - Retrieve history with basic formatting/auto-linking (Read)
#   - Remove specific entries (Delete)
# Integration points:
#   - Extends DB package via package injection
#   - Direct DBI usage for SQL operations

# Inject methods into the main DB package

# Saves a text snippet to the database.
# Parameters:
#   paste : Text content to store (String)
# Returns:
#   Result of execute() (true on success)
sub DB::paste {
    my ($self, $paste) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Insert new record
    my $sth = $self->{dbh}->prepare("INSERT INTO copy (text) VALUES(?)");
    $sth->execute($paste);
}

# Retrieves paste history formatted for display.
# Parameters: None
# Returns:
#   Array of HashRefs: [{ id => Int, text => String }, ...]
# Behavior:
#   - Sorts by newest first (DESC)
#   - Auto-converts text starting with 'http' into HTML links
#   - Strips newlines from URL-only entries for cleaner display
sub DB::get_pasted {
    my ($self) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    my @messages;
    
    # Fetch all records ordered by newest first
    for my $m (@{ $self->{dbh}->selectall_arrayref("SELECT id, text FROM copy ORDER BY id DESC") }) {
        my ($id, $text) = @$m;
        my $raw = $text;
        
        # Apply specific formatting if the message appears to be a URL
        if ($text =~ /^http/) {
            $text =~ s/(http\S+)/<a href="$1">$1<\/a>/g;
            $text =~ s/\n//g;
        }
        
        push @messages, { id => $id, text => $text, raw => $raw };
    }
    
    return @messages;
}

# Removes a paste entry from the database.
# Parameters:
#   id : Unique ID of the message to delete
# Returns:
#   Result of execute() (true on success)
sub DB::delete_message {
    my ($self, $id) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Execute deletion
    my $sth = $self->{dbh}->prepare("DELETE FROM copy WHERE id = ?");
    $sth->execute($id);
}

# Updates an existing paste entry.
# Parameters:
#   id    : Record ID
#   text  : New content
# Returns: Void
sub DB::update_message {
    my ($self, $id, $text) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("UPDATE copy SET text = ? WHERE id = ?");
    $sth->execute($text, $id);
}

1;