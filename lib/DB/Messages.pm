# /lib/DB/Messages.pm

package DB::Messages;

use strict;
use warnings;

# Database helper for the "Copy/Paste" clipboard history feature.
# Manages transient snippets and persistent shared notes.
#
# Features:
#   - User-scoped text storage (Write).
#   - History retrieval with auto-link conversion (Read).
#   - Secure entry removal (Delete).
#   - Support for updated content (Update).
#
# Integration Points:
#   - Extends DB package via package injection.
#   - Used by Root controller for the /clipboard SPA.
#   - Coordinates with DB::Users for session identity verification.

# Saves a text snippet to the database.
# Parameters:
#   user_id : Unique user ID (Integer).
#   paste   : Text content to store (String).
# Returns:
#   Integer: The result code from the execute() statement.
sub DB::paste {
    my ($self, $user_id, $paste) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Insert new record
    my $sth = $self->{dbh}->prepare("INSERT INTO copy (user_id, text) VALUES(?, ?)");
    return $sth->execute($user_id, $paste);
}

# Retrieves paste history for a specific user formatted for display.
# Parameters:
#   user_id : Unique user ID (Integer).
# Returns:
#   Array: List of HashRefs [{ id, text, raw }].
# Behavior:
#   - Sorts by newest first (DESC).
#   - Auto-converts text starting with 'http' into HTML links.
#   - Strips newlines from URL-only entries for cleaner display.
sub DB::get_pasted {
    my ($self, $user_id) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    my @messages;
    
    # Fetch all records ordered by newest first
    my $sql = "SELECT id, text FROM copy WHERE user_id = ? ORDER BY id DESC";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($user_id);

    while (my $m = $sth->fetchrow_arrayref()) {
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
#   id      : Unique ID of the message to delete (Integer).
#   user_id : Verification user ID (Integer).
# Returns:
#   Integer: 1 on success, 0 on failure.
sub DB::delete_message {
    my ($self, $id, $user_id) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Execute deletion
    my $sth = $self->{dbh}->prepare("DELETE FROM copy WHERE id = ? AND user_id = ?");
    return $sth->execute($id, $user_id);
}

# Updates an existing paste entry.
# Parameters:
#   id      : Record ID (Integer).
#   user_id : Verification user ID (Integer).
#   text    : New content (String).
# Returns:
#   Integer: 1 on success, 0 on failure.
sub DB::update_message {
    my ($self, $id, $user_id, $text) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("UPDATE copy SET text = ? WHERE id = ? AND user_id = ?");
    return $sth->execute($text, $id, $user_id);
}

1;
