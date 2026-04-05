# /lib/DB/Notes.pm

package DB::Notes;

use strict;
use warnings;
use DBI qw(:sql_types);

# Database library for the /notes module.
#
# Features:
#   - Persistent storage for sticky note coordinates and content.
#   - Binary BLOB storage for image-based notes (matching Receipts pattern).
#   - SQL-level privacy isolation for registered users.
#   - Atomic synchronization of z-index, collapse states, and viewport scale.
#   - Multi-canvas management with collaborative sharing and ACL.
#
# Integration Points:
#   - Automatically loaded by the core DB package.
#   - Primary data source for the MyApp::Controller::Notes module.
#   - Depends on 'notes', 'note_blobs', 'canvases', 'canvas_shares', and 'notes_viewport' tables.

# Retrieves all notes for a specific user and canvas, respecting sharing permissions.
# Parameters:
#   user_id   : Integer ID of the active user.
#   canvas_id : Integer ID of the targeted whiteboard.
# Returns:
#   ArrayRef of HashRefs or empty list if access is denied.
sub DB::get_user_notes {
    my ($self, $user_id, $canvas_id) = @_;
    $self->ensure_connection;

    # Security Gate: Verify the user has at least READ access to this canvas
    return [] unless $self->check_canvas_access($canvas_id, $user_id, 0);

    my $sql = "SELECT * FROM notes WHERE canvas_id = ? ORDER BY z_index ASC, updated_at DESC";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($canvas_id);
    
    return $sth->fetchall_arrayref({});
}

# Performs an ACL-aware search across all whiteboards accessible to the user.
# Parameters:
#   user_id : Integer identifier for the active user.
#   query   : Search term (string).
# Returns:
#   ArrayRef of HashRefs containing notes and their parent board names.
sub DB::get_global_search_notes {
    my ($self, $user_id, $query) = @_;
    $self->ensure_connection;

    my $term = "%$query%";
    # Combine notes with parent canvases while enforcing ACL visibility
    my $sql = "
        SELECT n.*, c.name as canvas_name
        FROM notes n
        JOIN canvases c ON n.canvas_id = c.id
        WHERE (c.user_id = ? OR c.id IN (SELECT canvas_id FROM canvas_shares WHERE user_id = ?))
        AND (n.title LIKE ? OR n.content LIKE ?)
        ORDER BY n.updated_at DESC
        LIMIT 50
    ";
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($user_id, $user_id, $term, $term);
    return $sth->fetchall_arrayref({});
}

# Synchronizes or creates a sticky note, respecting EDIT permissions.
# Parameters:
#   params : HashRef { id, user_id, canvas_id, type, content, x, y, width, height, color, z_index, is_collapsed }
# Returns:
#   Integer or undef if unauthorized.
sub DB::save_note {
    my ($self, $p) = @_;
    $self->ensure_connection;

    # Security Gate: Verify EDIT access to the targeted canvas environment
    # If it's a new note, we check access to the canvas_id provided.
    # If it's an update, we check access to the note's existing canvas_id.
    my $cid = $p->{canvas_id};
    if ($p->{id}) {
        my $sth = $self->{dbh}->prepare("SELECT canvas_id FROM notes WHERE id = ?");
        $sth->execute($p->{id});
        ($cid) = $sth->fetchrow_array();
    }
    
    return undef unless $self->check_canvas_access($cid, $p->{user_id}, 1);

    my $id;
    if ($p->{id}) {
        # Update existing note
        my $sql = "UPDATE notes SET title = ?, content = ?, x = ?, y = ?, width = ?, height = ?, 
                   color = ?, z_index = ?, is_collapsed = ?, is_options_expanded = ?, layer_id = ? 
                   WHERE id = ?";
        my $sth = $self->{dbh}->prepare($sql);
        $sth->execute(
            $p->{title}, $p->{content}, $p->{x}, $p->{y}, $p->{width}, $p->{height},
            $p->{color}, $p->{z_index}, $p->{is_collapsed}, $p->{is_options_expanded} // 0, 
            $p->{layer_id} // 1, $p->{id}
        );
        $id = $p->{id};
    } else {
        # Insert new note
        my $sql = "INSERT INTO notes (user_id, canvas_id, type, title, content, x, y, width, height, color, z_index, is_collapsed, is_options_expanded, layer_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        my $sth = $self->{dbh}->prepare($sql);
        $sth->execute(
            $p->{user_id}, $cid, $p->{type} // 'text', $p->{title}, $p->{content}, $p->{x}, $p->{y}, 
            $p->{width}, $p->{height}, $p->{color}, $p->{z_index}, $p->{is_collapsed} // 0,
            $p->{is_options_expanded} // 0, $p->{layer_id} // 1
        );
        $id = int($self->{dbh}->last_insert_id(undef, undef, 'notes', 'id'));
        $self->touch_canvas($cid); # Forward-Moving Signal

        # Binary Deep-Copy Logic: If this is an 'image' clone, replicate the blob association
        if (($p->{type} // '') eq 'image' && $p->{source_id} && $id) {
            my $sql_b = "INSERT INTO note_blobs (note_id, file_data, mime_type, file_size) 
                         SELECT ?, file_data, mime_type, file_size FROM note_blobs WHERE note_id = ?";
            my $sth_b = $self->{dbh}->prepare($sql_b);
            $sth_b->execute($id, $p->{source_id});
        }
    }
    return $id;
}

# Retrieves a metadata map for ALL accessible notes (Owned + Shared).
# Used by the frontend to resolve [note:#] links into clickable titles.
# Parameters:
#   user_id : Integer ID for the active user.
# Returns:
#   HashRef { id => { title, canvas_id } }
sub DB::get_all_accessible_note_metadata {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    my $sql = "
        SELECT n.id, n.title, n.canvas_id, n.type
        FROM notes n
        JOIN canvases c ON n.canvas_id = c.id
        WHERE (c.user_id = ? OR c.id IN (SELECT canvas_id FROM canvas_shares WHERE user_id = ?))
    ";
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($user_id, $user_id);
    
    my %map;
    while (my $row = $sth->fetchrow_hashref()) {
        $map{$row->{id}} = {
            title     => $row->{title},
            type      => $row->{type},
            canvas_id => int($row->{canvas_id})
        };
    }
    return \%map;
}

# --- Internal Helpers ---

# Updates the parent canvas timestamp to trigger the synchronization heartbeat.
sub DB::touch_canvas {
    my ($self, $canvas_id) = @_;
    $self->ensure_connection;
    $self->{dbh}->do("UPDATE canvases SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", undef, $canvas_id);
}

# Deletes a sticky note from the specified canvas.
# Parameters:
#   note_id : ID of the record to remove.
#   user_id : ID of the active user.
# Returns:
#   Boolean success status.
sub DB::delete_note {
    my ($self, $note_id, $user_id) = @_;
    $self->ensure_connection;

    # Security Gate: Verify EDIT access to the parent canvas
    my $sth = $self->{dbh}->prepare("SELECT canvas_id FROM notes WHERE id = ?");
    $sth->execute($note_id);
    my ($cid) = $sth->fetchrow_array();
    
    return 0 unless $cid && $self->check_canvas_access($cid, $user_id, 1);

    my $sql = "DELETE FROM notes WHERE id = ?";
    $sth = $self->{dbh}->prepare($sql);
    return $sth->execute($note_id);
}

# Resolve the parent canvas ID for a specific note, enforcing ACL visibility.
# Parameters:
#   note_id : Integer note ID.
#   user_id : Integer user ID.
# Returns:
#   Integer canvas_id or undef if not found/unauthorized.
sub DB::get_canvas_for_note_id {
    my ($self, $note_id, $user_id) = @_;
    $self->ensure_connection;

    my $sql = "
        SELECT n.canvas_id 
        FROM notes n
        JOIN canvases c ON n.canvas_id = c.id
        WHERE n.id = ? 
        AND (c.user_id = ? OR c.id IN (SELECT canvas_id FROM canvas_shares WHERE user_id = ?))
    ";
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($note_id, $user_id, $user_id);
    my ($cid) = $sth->fetchrow_array();
    
    return $cid;
}

# Ownership verification for note records.
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

# Retrieves binary content for a specific note, respecting privacy.
# Parameters:
#   note_id : Parent note identifier.
#   user_id : Active user ID.
# Returns:
#   HashRef of binary metadata and content or undef.
sub DB::get_note_blob {
    my ($self, $note_id, $user_id) = @_;
    $self->ensure_connection;

    # Anchor permission lookup to the parent note's canvas
    my $sth_p = $self->{dbh}->prepare("SELECT canvas_id FROM notes WHERE id = ?");
    $sth_p->execute($note_id);
    my ($cid) = $sth_p->fetchrow_array();
    
    return undef unless $cid && $self->check_canvas_access($cid, $user_id, 0);

    my $sth = $self->{dbh}->prepare("SELECT * FROM note_blobs WHERE note_id = ? LIMIT 1");
    $sth->execute($note_id);
    
    return $sth->fetchrow_hashref();
}

# Retrieves viewport state for a canvas, respecting sharing visibility.
# Parameters:
#   user_id   : Active user identifier.
#   canvas_id : Targeted whiteboard identifier.
# Returns:
#   HashRef { scale, scroll_x, scroll_y } or default coordinates.
sub DB::get_viewport {
    my ($self, $user_id, $canvas_id, $layer_id) = @_;
    $self->ensure_connection;

    # Verify visibility before exposing coordinate metadata
    return { scale => '1.00', scroll_x => 2500, scroll_y => 2500, layer_id => 1 }
        unless $self->check_canvas_access($canvas_id, $user_id, 0);

    my $sql = "SELECT scale, scroll_x, scroll_y, layer_id FROM notes_viewport WHERE user_id = ? AND canvas_id = ?";
    my $sth;

    if ($layer_id) {
        $sql .= " AND layer_id = ? LIMIT 1";
        $sth = $self->{dbh}->prepare($sql);
        $sth->execute($user_id, $canvas_id, $layer_id);
    } else {
        $sql .= " ORDER BY updated_at DESC LIMIT 1";
        $sth = $self->{dbh}->prepare($sql);
        $sth->execute($user_id, $canvas_id);
    }

    my $row = $sth->fetchrow_hashref();

    # Scale-Independent canonical fallback
    if ($row) {
        return $row;
    } else {
        # If no row exists, we MUST return the requested layer_id to avoid being stuck on Level 1
        return { 
            scale    => '1.00', 
            scroll_x => 2500, 
            scroll_y => 2500, 
            layer_id => ($layer_id || 1) 
        };
    }
}

# Determines the most recently accessed canvas for a user.
# Parameters:
#   user_id : Integer ID for the target user.
# Returns:
#   Integer or undef.
sub DB::get_last_viewed_canvas {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    my $sql = "SELECT canvas_id FROM notes_viewport WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($user_id);
    my ($id) = $sth->fetchrow_array();
    
    return $id;
}

# Persists viewport state, respecting the user's focus on a per-board basis.
# Note: Viewports are user-specific even on shared canvases to avoid cross-fire.
sub DB::save_viewport {
    my ($self, $user_id, $canvas_id, $scale, $scroll_x, $scroll_y, $layer_id) = @_;
    $self->ensure_connection;

    return unless $self->check_canvas_access($canvas_id, $user_id, 0);

    my $sql = "INSERT INTO notes_viewport (user_id, canvas_id, scale, scroll_x, scroll_y, layer_id, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON DUPLICATE KEY UPDATE scale = VALUES(scale),
                                        scroll_x = VALUES(scroll_x),
                                        scroll_y = VALUES(scroll_y),
                                        layer_id = VALUES(layer_id),
                                        updated_at = CURRENT_TIMESTAMP";
    $self->{dbh}->do($sql, undef, $user_id, $canvas_id, $scale, $scroll_x, $scroll_y, $layer_id // 1);
}

# --- Multi-Canvas & Sharing Expansion ---

# Retrieves all canvases the user can access (Owned + Shared).
sub DB::get_available_canvases {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    # Fetch owned boards + shared boards in a unified set
    my $sql = "
        SELECT c.*, u.username as owner_name, 1 as is_owner, 1 as can_edit
        FROM canvases c
        JOIN users u ON c.user_id = u.id
        WHERE c.user_id = ?
        UNION
        SELECT c.*, u.username as owner_name, 0 as is_owner, cs.can_edit
        FROM canvases c
        JOIN users u ON c.user_id = u.id
        JOIN canvas_shares cs ON c.id = cs.canvas_id
        WHERE cs.user_id = ?
        ORDER BY created_at ASC
    ";
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($user_id, $user_id);
    return $sth->fetchall_arrayref({});
}

# Initializes a new board record.
sub DB::create_canvas {
    my ($self, $user_id, $name) = @_;
    $self->ensure_connection;

    my $sql = "INSERT INTO canvases (user_id, name) VALUES (?, ?)";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($user_id, $name // 'Untitled Workspace');
    
    return $self->{dbh}->last_insert_id(undef, undef, 'canvases', 'id');
}

# Purges a board and all associated contents (Owner only).
sub DB::delete_canvas {
    my ($self, $canvas_id, $user_id) = @_;
    $self->ensure_connection;

    # Integrity Sync: Only owner can purge the board foundation
    my $sth = $self->{dbh}->prepare("DELETE FROM canvases WHERE id = ? AND user_id = ?");
    $sth->execute($canvas_id, $user_id);
}

# Manages shared access permissions.
sub DB::share_canvas {
    my ($self, $canvas_id, $shared_user_id, $can_edit) = @_;
    $self->ensure_connection;

    my $sql = "INSERT INTO canvas_shares (canvas_id, user_id, can_edit) VALUES (?, ?, ?)
               ON DUPLICATE KEY UPDATE can_edit = VALUES(can_edit)";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($canvas_id, $shared_user_id, $can_edit // 1);
}

# Revokes shared access.
sub DB::unshare_canvas {
    my ($self, $canvas_id, $user_id) = @_;
    $self->ensure_connection;
    $self->{dbh}->do("DELETE FROM canvas_shares WHERE canvas_id = ? AND user_id = ?", undef, $canvas_id, $user_id);
}

# Returns current share list for a board (Owner only).
sub DB::get_canvas_shares {
    my ($self, $canvas_id) = @_;
    $self->ensure_connection;

    my $sql = "SELECT cs.*, u.username FROM canvas_shares cs JOIN users u ON cs.user_id = u.id WHERE cs.canvas_id = ?";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($canvas_id);
    return $sth->fetchall_arrayref({});
}

# Core Permission Gate: Validates access to any board interaction.
sub DB::check_canvas_access {
    my ($self, $canvas_id, $user_id, $require_edit) = @_;
    $self->ensure_connection;

    # 1. Owner check
    my $sth_o = $self->{dbh}->prepare("SELECT 1 FROM canvases WHERE id = ? AND user_id = ?");
    $sth_o->execute($canvas_id, $user_id);
    return 1 if $sth_o->fetchrow_array();

    # 2. Shared access check
    my $sql = "SELECT can_edit FROM canvas_shares WHERE canvas_id = ? AND user_id = ?";
    my $sth_s = $self->{dbh}->prepare($sql);
    $sth_s->execute($canvas_id, $user_id);
    my ($can_edit) = $sth_s->fetchrow_array();

    if (defined $can_edit) {
        return 1 if !$require_edit || $can_edit;
    }

    return 0;
}

# Copies a note to another canvas (Duplication migration).
# Returns the new note_id or 0 on failure.
sub DB::copy_note {
    my ($self, $note_id, $new_canvas_id, $user_id) = @_;
    $self->ensure_connection;

    # 1. Security Check: Verify EDIT access to both Source and Destination
    my $sth_n = $self->{dbh}->prepare("SELECT * FROM notes WHERE id = ?");
    $sth_n->execute($note_id);
    my $note = $sth_n->fetchrow_hashref();

    return 0 unless $note && $self->check_canvas_access($note->{canvas_id}, $user_id, 1);
    return 0 unless $self->check_canvas_access($new_canvas_id, $user_id, 1);

    # 2. Deep-Copy: Insert new note record with identical metadata
    my $sql = "INSERT INTO notes (user_id, canvas_id, type, title, content, x, y, width, height, color, z_index, is_collapsed, is_options_expanded)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    my $sth_i = $self->{dbh}->prepare($sql);
    $sth_i->execute(
        $user_id, $new_canvas_id, $note->{type}, $note->{title}, $note->{content},
        $note->{x}, $note->{y}, $note->{width}, $note->{height}, $note->{color},
        $note->{z_index}, $note->{is_collapsed}, $note->{is_options_expanded}
    );
    
    my $new_id = int($self->{dbh}->last_insert_id(undef, undef, 'notes', 'id'));
    
    $self->touch_canvas($new_canvas_id); # Forward-Moving Signal

    # 3. Binary Deep-Copy: If it's an image, clone the BLOB to the new ID
    if ($note->{type} eq 'image' && $new_id) {
        my $sql_b = "INSERT INTO note_blobs (note_id, file_data, mime_type, file_size)
                     SELECT ?, file_data, mime_type, file_size FROM note_blobs WHERE note_id = ?";
        my $sth_b = $self->{dbh}->prepare($sql_b);
        $sth_b->execute($new_id, $note_id);
    }

    return $new_id;
}
# Updates the name of a canvas, respecting ownership.
# Parameters:
#   id      : Integer ID of the canvas.
#   user_id : Active user identifier (Must be owner).
#   name    : New descriptive name.
# Returns:
#   Boolean : 1 on success, 0 otherwise.
sub DB::rename_canvas {
    my ($self, $id, $user_id, $name) = @_;
    $self->ensure_connection;

    # Authority Check: Only canonical owners can rename their workspaces
    my $sth = $self->{dbh}->prepare("UPDATE canvases SET name = ? WHERE id = ? AND user_id = ?");
    $sth->execute($name, $id, $user_id);
    
    return $sth->rows > 0 ? 1 : 0;
}

# Retrieves the most recent mutation timestamp for a specific workspace.
# Parameters:
#   id : Integer ID of the canvas.
# Returns:
#   String : ISO-8601 formatted timestamp or undef.
sub DB::get_board_mutation_time {
    my ($self, $id) = @_;
    $self->ensure_connection;

    # Aggregate Check: Determine 'freshness' from both canvas metadata and note content
    my $sql = "SELECT GREATEST(
                    COALESCE(MAX(c.updated_at), '1970-01-01 00:00:00'),
                    COALESCE(MAX(n.updated_at), '1970-01-01 00:00:00')
               ) as last_mutation
               FROM canvases c
               LEFT JOIN notes n ON n.canvas_id = c.id
               WHERE c.id = ?";
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($id);
    my ($time) = $sth->fetchrow_array();
    
    return $time;
}

1;
