# /lib/DB/Notes.pm

package DB::Notes;

use strict;
use warnings;
use DBI qw(:sql_types);

# Database library for the /notes module.
#
# Features:
#   - High-fidelity persistence for sticky note coordinates and content.
#   - Binary BLOB storage for image-based notes (matching Receipts pattern).
#   - SQL-level privacy isolation for registered users (Rule #125).
#   - Atomic synchronization of z-index, collapse states, and viewport scale.
#
# Integration Points:
#   - Automatically loaded by the core DB package.
#   - Primary data source for the MyApp::Controller::Notes module.
#   - Depends on 'notes', 'note_blobs', and 'notes_viewport' MariaDB tables.

# Retrieves all notes for a specific user and canvas.
# Parameters:
#   user_id   : Integer ID of the registered user.
#   canvas_id : Integer ID of the active whiteboard (Default: 1).
# Returns:
#   ArrayRef of HashRefs containing note metadata and content.
sub DB::get_user_notes {
    my ($self, $user_id, $canvas_id) = @_;
    $canvas_id //= 1;
    $self->ensure_connection;

    my $sql = "SELECT * FROM notes WHERE user_id = ? AND canvas_id = ? ORDER BY z_index ASC, updated_at DESC";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($user_id, $canvas_id);
    
    return $sth->fetchall_arrayref({});
}

# Synchronizes or creates a sticky note.
# Parameters:
#   params : HashRef { id, user_id, canvas_id, type, content, x, y, width, height, color, z_index, is_collapsed }
# Returns:
#   Integer : ID of the created or updated record.
sub DB::save_note {
    my ($self, $p) = @_;
    $self->ensure_connection;

    # High-Fidelity Defaulting: Ensure the note is anchored to a canvas environment
    $p->{canvas_id} //= 1;

    if ($p->{id}) {
        # Update existing note with privacy verification
        my $sql = "UPDATE notes SET title = ?, content = ?, x = ?, y = ?, width = ?, height = ?, 
                   color = ?, z_index = ?, is_collapsed = ?, is_options_expanded = ?, canvas_id = ? 
                   WHERE id = ? AND user_id = ?";
        my $sth = $self->{dbh}->prepare($sql);
        $sth->execute(
            $p->{title}, $p->{content}, $p->{x}, $p->{y}, $p->{width}, $p->{height},
            $p->{color}, $p->{z_index}, $p->{is_collapsed}, $p->{is_options_expanded} // 0, 
            $p->{canvas_id}, $p->{id}, $p->{user_id}
        );
        return $p->{id};
    } else {
        # Insert new note
        my $sql = "INSERT INTO notes (user_id, canvas_id, type, title, content, x, y, width, height, color, z_index, is_collapsed, is_options_expanded)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        my $sth = $self->{dbh}->prepare($sql);
        $sth->execute(
            $p->{user_id}, $p->{canvas_id}, $p->{type} // 'text', $p->{title}, $p->{content}, $p->{x}, $p->{y}, 
            $p->{width}, $p->{height}, $p->{color}, $p->{z_index}, $p->{is_collapsed} // 0,
            $p->{is_options_expanded} // 0
        );
        return $self->{dbh}->last_insert_id(undef, undef, 'notes', 'id');
    }
}

# Permanently removes a note and its associated binary blobs.
# Parameters:
#   id      : Integer ID of the note.
#   user_id : Logic-sync verification ID.
# Returns: Void.
sub DB::delete_note {
    my ($self, $id, $user_id) = @_;
    $self->ensure_connection;

    # ON DELETE CASCADE handles the note_blobs table.
    my $sth = $self->{dbh}->prepare("DELETE FROM notes WHERE id = ? AND user_id = ?");
    $sth->execute($id, $user_id);
}

# Logic-sync verification for record ownership.
# Parameters:
#   id      : Integer ID of the note.
#   user_id : Integer ID of the active user.
# Returns:
#   Boolean : 1 if owner, 0 otherwise.
sub DB::check_note_ownership {
    my ($self, $id, $user_id) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("SELECT 1 FROM notes WHERE id = ? AND user_id = ? LIMIT 1");
    $sth->execute($id, $user_id);
    return $sth->fetchrow_array ? 1 : 0;
}

# Stores binary data for an image-based note.
# Parameters:
#   note_id   : Parent note identifier.
#   file_data : Binary BLOB content.
#   mime_type : Content type string.
#   file_size : Integer byte count.
# Returns: Void.
# Note: Blobs are absolute-anchored by note_id, which is unique across the module.
sub DB::store_note_blob {
    my ($self, $note_id, $file_data, $mime_type, $file_size) = @_;
    $self->ensure_connection;

    # Purge existing blobs for this note (Single image per note pattern)
    $self->{dbh}->do("DELETE FROM note_blobs WHERE note_id = ?", undef, $note_id);

    my $sql = "INSERT INTO note_blobs (note_id, mime_type, file_size, file_data) VALUES (?, ?, ?, ?)";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->bind_param(1, $note_id);
    $sth->bind_param(2, $mime_type);
    $sth->bind_param(3, $file_size);
    $sth->bind_param(4, $file_data, SQL_BLOB);
    $sth->execute();
}

# Retrieves binary content for a specific note.
# Parameters:
#   note_id : Parent note identifier.
# Returns:
#   HashRef of binary metadata and content or undef.
sub DB::get_note_blob {
    my ($self, $note_id) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("SELECT * FROM note_blobs WHERE note_id = ? LIMIT 1");
    $sth->execute($note_id);
    
    return $sth->fetchrow_hashref();
}

# Retrieves the persisted viewport state for a specific user and canvas.
# Parameters:
#   user_id   : Integer ID of the registered user.
#   canvas_id : Integer ID of the active whiteboard (Default: 1).
# Returns:
#   HashRef { scale, scroll_x, scroll_y } or default values if no record exists.
sub DB::get_viewport {
    my ($self, $user_id, $canvas_id) = @_;
    $canvas_id //= 1;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "SELECT scale, scroll_x, scroll_y FROM notes_viewport WHERE user_id = ? AND canvas_id = ? LIMIT 1"
    );
    $sth->execute($user_id, $canvas_id);
    my $row = $sth->fetchrow_hashref();

    # Return defaults centered on the 5000x5000 canvas if no record exists yet
    return $row // { scale => '1.00', scroll_x => 2500, scroll_y => 2500 };
}

# Persists viewport state for a user and canvas via an atomic UPSERT.
# Parameters:
#   user_id   : Integer ID of the registered user.
#   canvas_id : Integer ID of the active whiteboard.
#   scale     : Decimal zoom multiplier (e.g. 1.00, 0.75, 1.50).
#   scroll_x  : Horizontal scroll offset in pixels.
#   scroll_y  : Vertical scroll offset in pixels.
# Returns: Void.
sub DB::save_viewport {
    my ($self, $user_id, $canvas_id, $scale, $scroll_x, $scroll_y) = @_;
    $canvas_id //= 1;
    $self->ensure_connection;

    my $sql = "INSERT INTO notes_viewport (user_id, canvas_id, scale, scroll_x, scroll_y)
               VALUES (?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE scale = VALUES(scale),
                                        scroll_x = VALUES(scroll_x),
                                        scroll_y = VALUES(scroll_y)";
    $self->{dbh}->do($sql, undef, $user_id, $canvas_id, $scale, $scroll_x, $scroll_y);
}

1;
