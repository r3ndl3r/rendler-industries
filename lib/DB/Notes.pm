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

    # Consolidated Fetch Pattern: Single round-trip for notes and attachments.
    # The 'blob_' prefix is used as a namespace separator for application-level grouping;
    # do NOT alias primary note columns with this prefix.
    my $sql = "
        SELECT 
            n.*,
            b.id as blob_id, b.note_id as blob_note_id, b.filename as blob_filename, 
            b.mime_type as blob_mime, b.file_size as blob_size
        FROM notes n
        LEFT JOIN note_blobs b ON n.id = b.note_id
        WHERE n.canvas_id = ? AND n.is_deleted = 0 
        ORDER BY n.z_index ASC, n.updated_at DESC, b.id ASC
    ";
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($canvas_id);
    
    my $notesArr = [];
    my %note_map; # Local lookup for grouping attachments

    while (my $row = $sth->fetchrow_hashref()) {
        my $nid = $row->{id};
        
        # Primary Record Initialization (Self-maintaining hash construction)
        if (!$note_map{$nid}) {
            my $note = { map { $_ => $row->{$_} } grep { !/^blob_/ } keys %$row };
            $note->{attachments} = [];
            $note_map{$nid} = $note;
            push @$notesArr, $note;
        }

        # Attachment Aggregation: Restore note_id parity for downstream consumers
        if ($row->{blob_id}) {
            push @{$note_map{$nid}->{attachments}}, {
                blob_id   => $row->{blob_id},
                note_id   => $row->{blob_note_id},
                filename  => $row->{blob_filename},
                mime_type => $row->{blob_mime},
                file_size => $row->{blob_size}
            };
        }
    }
    
    return $notesArr;
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
        SELECT n.*, c.name as canvas_name, cl.alias as layer_alias
        FROM notes n
        JOIN canvases c ON n.canvas_id = c.id
        LEFT JOIN canvas_layers cl ON n.canvas_id = cl.canvas_id AND n.layer_id = cl.layer_id
        WHERE (c.user_id = ? OR c.id IN (SELECT canvas_id FROM canvas_shares WHERE user_id = ?))
        AND n.is_deleted = 0
        AND (n.title LIKE ? OR n.content LIKE ? OR n.filename LIKE ? OR cl.alias LIKE ?)
        ORDER BY n.updated_at DESC
        LIMIT 50
        ";

        my $sth = $self->{dbh}->prepare($sql);
        $sth->execute($user_id, $user_id, $term, $term, $term, $term);
        my $notes = $sth->fetchall_arrayref({});
        
        if (@$notes) {
            my @note_ids = map { $_->{id} } @$notes;
            my $placeholders = join(',', map { '?' } @note_ids);
            my $sql_blobs = "SELECT id as blob_id, note_id, filename, mime_type, file_size FROM note_blobs WHERE note_id IN ($placeholders)";
            my $sth_blobs = $self->{dbh}->prepare($sql_blobs);
            $sth_blobs->execute(@note_ids);
            
            my %blobs;
            while (my $row = $sth_blobs->fetchrow_hashref()) {
                push @{$blobs{$row->{note_id}}}, $row;
            }
            foreach my $n (@$notes) {
                $n->{attachments} = $blobs{$n->{id}} || [];
            }
        }
        
        return $notes;
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
        my $sql = "UPDATE notes SET title = ?, content = ?, filename = ?, x = ?, y = ?, width = ?, height = ?, 
                   color = ?, z_index = ?, is_collapsed = ?, is_options_expanded = ?, layer_id = ? 
                   WHERE id = ?";
        my $sth = $self->{dbh}->prepare($sql);
        $sth->execute(
            $p->{title}, $p->{content}, $p->{filename}, $p->{x}, $p->{y}, $p->{width}, $p->{height},
            $p->{color}, $p->{z_index}, $p->{is_collapsed}, $p->{is_options_expanded} // 0,
            $p->{layer_id} // 1, $p->{id}
        );
        $id = $p->{id};
    } else {
        # Insert new note
        my $sql = "INSERT INTO notes (user_id, canvas_id, type, title, content, filename, x, y, width, height, color, z_index, is_collapsed, is_options_expanded, layer_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        my $sth = $self->{dbh}->prepare($sql);
        $sth->execute(
            $p->{user_id}, $cid, $p->{type} // 'text', $p->{title}, $p->{content}, $p->{filename}, $p->{x}, $p->{y}, 
            $p->{width}, $p->{height}, $p->{color}, $p->{z_index}, $p->{is_collapsed} // 0,
            $p->{is_options_expanded} // 0, $p->{layer_id} // 1
        );
        $id = int($self->{dbh}->last_insert_id(undef, undef, 'notes', 'id'));
        $self->touch_canvas($cid); # Forward-Moving Signal

        # Binary Deep-Copy Logic: Replicate the blob association for binary types
        if ((($p->{type} // '') eq 'image' || ($p->{type} // '') eq 'file') && $p->{source_id} && $id) {
            my $sql_b = "INSERT INTO note_blobs (note_id, file_data, mime_type, file_size, filename) 
                         SELECT ?, file_data, mime_type, file_size, filename FROM note_blobs WHERE note_id = ?";
            my $sth_b = $self->{dbh}->prepare($sql_b);
            $sth_b->execute($id, $p->{source_id});
        }
    }
    return $id;
}

# Calculates a unified synchronization fingerprint for the user's note landscape.
# O(1) Complexity: Leverages composite indices to scan notes (updates/deletions) and shares.
# Returns:
#   String: Latest timestamp across notes and ACL grants.
sub DB::get_note_map_fingerprint {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    # Logic: Fingerprint covers both note mutations AND new sharing grants.
    # Note: We include is_deleted records in the MAX(updated_at) to ensure deletions invalidate cache.
    my $sql = "
        SELECT GREATEST(
            IFNULL((
                SELECT MAX(n.updated_at) 
                FROM notes n
                JOIN canvases c ON n.canvas_id = c.id
                WHERE (c.user_id = ? OR c.id IN (SELECT canvas_id FROM canvas_shares WHERE user_id = ?))
            ), '1970-01-01 00:00:00'),
            IFNULL((
                SELECT MAX(created_at) 
                FROM canvas_shares 
                WHERE user_id = ?
            ), '1970-01-01 00:00:00')
        ) as fingerprint
    ";
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($user_id, $user_id, $user_id);
    my ($fingerprint) = $sth->fetchrow_array();
    
    return $fingerprint;
}

# Retrieves a lean metadata map for ALL accessible notes.
# Optimized: Strips 'content' and uses a correlated subquery for exactly ONE attachment metadata.
# Parameters:
#   user_id : Integer ID for the active user.
# Returns:
#   HashRef { id => { title, canvas_id, attachments => [...] } }
sub DB::get_all_accessible_note_metadata {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    # Performance: Only fetch identification, coordinates, and primary file metadata.
    # The 'blob_' prefix maintains grouping compatibility for rendering engine.
    my $sql = "
        SELECT 
            n.id, n.canvas_id, n.title, n.type, n.x, n.y, n.width, n.height, n.layer_id,
            b.id        AS blob_id,
            b.filename  AS blob_filename,
            b.mime_type AS blob_mime,
            b.file_size AS blob_size
        FROM notes n
        JOIN canvases c ON n.canvas_id = c.id
        LEFT JOIN note_blobs b ON b.id = (
            SELECT id FROM note_blobs 
            WHERE note_id = n.id 
            ORDER BY id ASC 
            LIMIT 1
        )
        WHERE (c.user_id = ? OR c.id IN (SELECT canvas_id FROM canvas_shares WHERE user_id = ?))
        AND n.is_deleted = 0
    ";
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($user_id, $user_id);
    
    my %map;
    while (my $row = $sth->fetchrow_hashref()) {
        # Construction: Filter out 'blob_' prefixes into the attachments array
        my $note = { map { $_ => $row->{$_} } grep { !/^blob_/ } keys %$row };
        $note->{attachments} = [];
        
        if ($row->{blob_id}) {
            push @{$note->{attachments}}, {
                blob_id   => $row->{blob_id},
                filename  => $row->{blob_filename},
                mime_type => $row->{blob_mime},
                file_size => $row->{blob_size}
            };
        }
        
        $map{$row->{id}} = $note;
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

    my $sql = "UPDATE notes SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
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

# Authority Check: Ensures user has board-level EDIT permission for a specific note.
# Used for collaborative asset management (attachments).
sub DB::check_note_edit_permission {
    my ($self, $note_id, $user_id) = @_;
    $self->ensure_connection;

    # Fetch the canvas this note belongs to
    my $sth = $self->{dbh}->prepare("SELECT canvas_id FROM notes WHERE id = ?");
    $sth->execute($note_id);
    my ($canvas_id) = $sth->fetchrow_array();
    
    return 0 unless $canvas_id;
    
    # If the user has EDIT access to the canvas, they can manage note assets
    return $self->check_canvas_access($canvas_id, $user_id, 1);
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
    my ($self, $note_id, $file_data, $mime_type, $file_size, $filename) = @_;
    $self->ensure_connection;

    # Multiple blobs per note are supported; inserts do not replace existing records.
    my $sql = "INSERT INTO note_blobs (note_id, mime_type, file_size, file_data, filename) VALUES (?, ?, ?, ?, ?)";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->bind_param(1, $note_id);
    $sth->bind_param(2, $mime_type);
    $sth->bind_param(3, $file_size);
    $sth->bind_param(4, $file_data, SQL_BLOB);
    $sth->bind_param(5, $filename);
    $sth->execute();
    return $self->{dbh}->last_insert_id(undef, undef, 'note_blobs', 'id');
}

# Deletes specific blobs (Reel purge logic).
# Note: Security enforced at controller level via note ownership.
sub DB::delete_blobs {
    my ($self, $note_id, $blob_ids) = @_;
    return 0 unless ref $blob_ids eq 'ARRAY' && @$blob_ids;
    $self->ensure_connection;
    my $placeholders = join(',', map { '?' } @$blob_ids);
    my $sql = "DELETE FROM note_blobs WHERE note_id = ? AND id IN ($placeholders)";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($note_id, @$blob_ids);
    return $sth->rows;
}

# Updates the display filename for a specific binary attachment.
# Parameters:
#   blob_id : Integer ID of the target blob record.
#   note_id : Parent note ID (used to scope the update atomically).
#   filename : New descriptive filename string.
# Returns:
#   Boolean success.
sub DB::update_blob_filename {
    my ($self, $blob_id, $note_id, $filename) = @_;
    $self->ensure_connection;

    my $sql = "UPDATE note_blobs SET filename = ? WHERE id = ? AND note_id = ?";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($filename, $blob_id, $note_id);
    return $sth->rows > 0 ? 1 : 0;
}

# Updates an existing note to become a binary type (image or file).
# Sets the new type and filename metadata while preserving any existing text content.
sub DB::promote_note_to_binary {
    my ($self, $note_id, $type, $filename) = @_;
    $self->ensure_connection;

    my $sql = "UPDATE notes SET type = ?, filename = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    my $sth = $self->{dbh}->prepare($sql);
    return $sth->execute($type, $filename, $note_id);
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

    my $sth = $self->{dbh}->prepare("SELECT * FROM note_blobs WHERE note_id = ? ORDER BY id ASC LIMIT 1");
    $sth->execute($note_id);
    
    return $sth->fetchrow_hashref();
}

# New precisely targeted reel attachment fetcher
sub DB::get_blob_by_id {
    my ($self, $blob_id, $user_id) = @_;
    $self->ensure_connection;

    my $sql = "SELECT nb.*, n.canvas_id FROM note_blobs nb JOIN notes n ON nb.note_id = n.id WHERE nb.id = ?";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($blob_id);
    my $blob = $sth->fetchrow_hashref();
    
    return undef unless $blob && $self->check_canvas_access($blob->{canvas_id}, $user_id, 0);
    return $blob;
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
        SELECT c.*, u.username as owner_name, 1 as is_owner, 1 as can_edit, c.sort_order as user_sort
        FROM canvases c
        JOIN users u ON c.user_id = u.id
        WHERE c.user_id = ?
        UNION
        SELECT c.*, u.username as owner_name, 0 as is_owner, cs.can_edit, cs.sort_order as user_sort
        FROM canvases c
        JOIN users u ON c.user_id = u.id
        JOIN canvas_shares cs ON c.id = cs.canvas_id
        WHERE cs.user_id = ?
        ORDER BY user_sort ASC, created_at ASC
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
    $sth->execute($user_id, $name // 'My Notebook');
    
    return $self->{dbh}->last_insert_id(undef, undef, 'canvases', 'id');
}

# Updates the relative sequence of boards for a user.
sub DB::update_canvas_order {
    my ($self, $user_id, $order_map) = @_;
    $self->ensure_connection;

    # Hierarchical Update: Update own record OR share record
    my $sql_owner = "UPDATE canvases SET sort_order = ? WHERE id = ? AND user_id = ?";
    my $sql_share = "UPDATE canvas_shares SET sort_order = ? WHERE canvas_id = ? AND user_id = ?";
    
    my $sth_owner = $self->{dbh}->prepare($sql_owner);
    my $sth_share = $self->{dbh}->prepare($sql_share);

    foreach my $item (@$order_map) {
        # Try updating as owner
        my $rows = $sth_owner->execute($item->{order}, $item->{id}, $user_id);
        
        # If no rows affected, they aren't owner; try share record
        if ($rows eq '0E0') {
            $sth_share->execute($item->{order}, $item->{id}, $user_id);
        }
    }
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
    my $sql = "INSERT INTO notes (user_id, canvas_id, type, title, content, filename, x, y, width, height, color, z_index, is_collapsed, is_options_expanded, layer_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    my $sth_i = $self->{dbh}->prepare($sql);
    $sth_i->execute(
        $user_id, $new_canvas_id, $note->{type}, $note->{title}, $note->{content}, $note->{filename},
        $note->{x}, $note->{y}, $note->{width}, $note->{height}, $note->{color},
        $note->{z_index}, $note->{is_collapsed}, $note->{is_options_expanded}, $note->{layer_id} // 1
    );
    
    my $new_id = int($self->{dbh}->last_insert_id(undef, undef, 'notes', 'id'));
    
    $self->touch_canvas($new_canvas_id); # Forward-Moving Signal

    # 3. Binary Deep-Copy: Replicate the BLOB for binary types
    if (($note->{type} eq 'image' || $note->{type} eq 'file') && $new_id) {
        my $sql_b = "INSERT INTO note_blobs (note_id, file_data, mime_type, file_size, filename)
                     SELECT ?, file_data, mime_type, file_size, filename FROM note_blobs WHERE note_id = ?";
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
    my ($self, $canvas_id, $layer_id) = @_;
    $self->ensure_connection;

    # Aggregate Check: Determine 'freshness' from both canvas metadata and layer-specific content
    # If layer_id is omitted, we check board-wide for global context (Initial Load).
    # If provided, we isolate triggers to the user's active perspective.
    my $sql;
    my @params;

    if ($layer_id) {
        # Include canvas-level updated_at so renames and touch_canvas events propagate to the layer heartbeat
        $sql = "SELECT GREATEST(
                    COALESCE((SELECT MAX(updated_at) FROM notes WHERE canvas_id = ? AND layer_id = ? AND is_deleted = 0), '1970-01-01 00:00:00'),
                    COALESCE((SELECT updated_at FROM canvases WHERE id = ?), '1970-01-01 00:00:00')
                )";
        push @params, $canvas_id, $layer_id, $canvas_id;
    } else {
        $sql = "SELECT GREATEST(
                    COALESCE(MAX(c.updated_at), '1970-01-01 00:00:00'),
                    COALESCE(MAX(n.updated_at), '1970-01-01 00:00:00')
                ) as last_mutation
                FROM canvases c
                LEFT JOIN notes n ON n.canvas_id = c.id AND n.is_deleted = 0
                WHERE c.id = ?";
        push @params, $canvas_id;
    }

    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(@params);
    my ($time) = $sth->fetchrow_array();

    return $time;
    }
# --- Bin & Recovery Operations ---

# Retrieves all soft-deleted notes for a user across all accessible canvases.
# Parameters:
#   user_id : Active user ID.
# Returns:
#   ArrayRef of HashRefs.
sub DB::get_deleted_notes {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    my $sql = "
        SELECT n.*, c.name as canvas_name
        FROM notes n
        LEFT JOIN canvases c ON n.canvas_id = c.id
        WHERE n.user_id = ? AND n.is_deleted = 1
        ORDER BY n.updated_at DESC
    ";
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($user_id);
    return $sth->fetchall_arrayref({});
}

# Restores a note from the bin to a specific canvas and layer at a given position.
# Parameters:
#   note_id   : Target note ID.
#   user_id   : Active user authority.
#   canvas_id : target canvas.
#   layer_id  : target layer.
#   x         : Optional new horizontal coordinate.
#   y         : Optional new vertical coordinate.
# Returns:
#   Boolean success.
sub DB::restore_note {
    my ($self, $note_id, $user_id, $canvas_id, $layer_id, $x, $y) = @_;
    $self->ensure_connection;

    # 1. Fetch note and check ownership (Ensure user owns the note they are restoring)
    my $sth_n = $self->{dbh}->prepare("SELECT id FROM notes WHERE id = ? AND user_id = ?");
    $sth_n->execute($note_id, $user_id);
    my ($exists) = $sth_n->fetchrow_array();
    return 0 unless $exists;

    # 2. Security Gate: Verify EDIT access to the target canvas environment
    return 0 unless $self->check_canvas_access($canvas_id, $user_id, 1);

    # 3. Final Restoration (Contextual)
    my $sql_r = "UPDATE notes SET is_deleted = 0, canvas_id = ?, layer_id = ?, x = ?, y = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    my $sth_r = $self->{dbh}->prepare($sql_r);
    $sth_r->execute($canvas_id, $layer_id, $x, $y, $note_id);

    $self->touch_canvas($canvas_id);
    return 1;
}

# Permanently removes a note and its binary blob.
# Authority Check: Only canonical owners can permanently purge.
sub DB::purge_note {
    my ($self, $note_id, $user_id) = @_;
    $self->ensure_connection;

    # Authority Check: Only owner can permanently purge
    my $sth_o = $self->{dbh}->prepare("SELECT canvas_id FROM notes WHERE id = ? AND user_id = ?");
    $sth_o->execute($note_id, $user_id);
    my ($cid) = $sth_o->fetchrow_array();
    
    return 0 unless $cid;

    # 1. Delete Blobs
    $self->{dbh}->do("DELETE FROM note_blobs WHERE note_id = ?", undef, $note_id);
    
    # 2. Delete Note
    my $sth = $self->{dbh}->prepare("DELETE FROM notes WHERE id = ?");
    my $count = $sth->execute($note_id);
    
    $self->touch_canvas($cid) if $count;
    return $count;
}

# --- Shared Layer Aliasing ---

# Retrieves all layer aliases for a specific canvas.
# Returns: HashRef { layer_id => alias }
sub DB::get_canvas_layers {
    my ($self, $canvas_id) = @_;
    $self->ensure_connection;

    my $sql = "SELECT layer_id, alias FROM canvas_layers WHERE canvas_id = ?";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($canvas_id);

    my %map;
    while (my ($lid, $alias) = $sth->fetchrow_array()) {
        $map{$lid} = $alias;
    }
    return \%map;
}

# Persists a descriptive name for a specific canvas level.
# Parameters:
#   canvas_id : Target workspace.
#   layer_id  : Level number (1-99).
#   alias     : Descriptive name.
# Returns:
#   Boolean success.
sub DB::save_layer_alias {
    my ($self, $canvas_id, $layer_id, $alias) = @_;
    $self->ensure_connection;

    my $sql = "INSERT INTO canvas_layers (canvas_id, layer_id, alias) VALUES (?, ?, ?)
               ON DUPLICATE KEY UPDATE alias = VALUES(alias)";
    my $sth = $self->{dbh}->prepare($sql);
    return $sth->execute($canvas_id, $layer_id, $alias);
}

1;
