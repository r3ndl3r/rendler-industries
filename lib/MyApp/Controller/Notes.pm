# /lib/MyApp/Controller/Notes.pm

package MyApp::Controller::Notes;

use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for the /notes Whiteboard module.
#
# Features:
#   - Consolidated state-handshake for atomic module bootstrapping.
#   - Atomic persistence for draggable sticky note coordinates.
#   - Multipart image upload processing with binary BLOB storage.
#   - Multi-canvas management with collaborative sharing and permission-aware ACL.
#   - Unified access for all registered and shared users.
#
# Integration Points:
#   - Adheres to the mission-critical MVC and privacy standards.
#   - Depends on DB::Notes for privacy-isolated SQL logic.
#   - Leverages localized serving for binary note blobs.

# Renders the main whiteboard skeleton.
# Route: GET /notes
# Description: Serves the Pure Skeleton template.
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render('notes');
}

# Returns the consolidated state for the notes board.
# Route: GET /notes/api/state
# Description: SSO handshake for all user-specific sticky notes, canvases, and viewport config.
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $canvases  = $c->db->get_available_canvases($user_id);
    
    # 1. Verification: Determine the active Board context via tiered priority
    if (!scalar @$canvases) {
        # Initialize default notebook for new users
        my $new_id = int($c->db->create_canvas($user_id, 'My Notebook'));
        $canvases = $c->db->get_available_canvases($user_id);
    }

    # 1. Canvas Context Resolution Logic
    my $cid;
    my $lid = $c->param('layer_id');
    
    # Resolution Hierarchy:
    #   1. Explicit Note Deep Link (?note_id=X) -> Resolves parent board
    #   2. Explicit Canvas Context (?canvas_id=X)
    #   3. Session Persistence (Last-touched viewport)
    #   4. Fallback (First available record)
    if (my $nid = $c->param('note_id')) {
        $cid = $c->db->get_canvas_for_note_id($nid, $user_id);
    }
    
    unless ($cid) {
        $cid = $c->param('canvas_id') 
               || $c->db->get_last_viewed_canvas($user_id) 
               || $canvases->[0]->{id};
    }
    
    # 2. Security Gate: Verify the user has access to the resolved board
    unless ($cid && $c->db->check_canvas_access($cid, $user_id, 0)) {
        # Recovery: If specific context is denied or stale, force resolution to first valid board
        $cid = $canvases->[0]->{id};
    }

    # 3. Session Persistence: Resolve the viewport (Specific layer or most recent)
    my $viewport = $c->db->get_viewport($user_id, $cid, $lid);
    
    my $notes      = $c->db->get_user_notes($user_id, $cid);
    my $share_list = $c->db->get_canvas_shares($cid);

    # 🚀 Performance Optimization: Delta Handshake
    # Logic: If the client provides a hash that matches our DB fingerprint, we skip the O(N) metadata fetch.
    my $client_hash = $c->param('note_map_hash') || '';
    my $fingerprint = $c->db->get_note_map_fingerprint($user_id);
    
    my $note_map;
    if (!defined $fingerprint) {
        # Recovery: If fingerprint lookup fails, force a full fetch to maintain data integrity
        $note_map    = $c->db->get_all_accessible_note_metadata($user_id);
        $fingerprint = ''; 
    } else {
        $note_map = ($client_hash ne $fingerprint) 
                  ? $c->db->get_all_accessible_note_metadata($user_id) 
                  : undef;
    }

    $c->render(json => {
        success       => 1,
        canvas_id     => int($cid),
        notes         => $notes,
        user_id       => $user_id,
        canvases      => $canvases,
        viewport      => $viewport,
        share_list    => $share_list,
        note_map      => $note_map,
        note_map_hash => $fingerprint,
        layer_map     => $c->db->get_canvas_layers($cid),
        last_mutation => $c->db->get_board_mutation_time($cid)
    });
}

# Synchronizes or creates a sticky note record.
# Route: POST /notes/api/save
sub api_save {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $canvas_id = $c->param('canvas_id');

    my $id = $c->param('id');
    $id = undef if $id && ($id eq 'null' || $id eq 'undefined' || $id eq '');

    my $params = {
        user_id             => $user_id,
        canvas_id           => $canvas_id,
        id                  => $id,
        source_id           => $c->param('source_id'),
        layer_id            => int($c->param('layer_id') // 1),
        type                => $c->param('type') // 'text',
        title               => trim($c->param('title') // 'Untitled Note'),
        content             => trim($c->param('content') // ''),
        filename            => trim($c->param('filename') // ''),
        x                   => int($c->param('x') // 2500),
        y                   => int($c->param('y') // 2500),
        width               => int($c->param('width') // 280),
        height              => int($c->param('height') // 200),
        color               => $c->param('color') // '#fef3c7',
        z_index             => int($c->param('z_index') // 1),
        is_collapsed        => int($c->param('is_collapsed') // 0),
        is_options_expanded => int($c->param('is_options_expanded') // 0)
    };

    my $result_id = $c->db->save_note($params);

    unless (defined $result_id) {
        return $c->render(json => { success => 0, error => 'Board Permission Denied (Read-Only?)' }, status => 403);
    }
    
    # Optional Purge: Process any attachments marked for deletion in this save cycle
    my $deleted_blobs_json = $c->param('deleted_blobs');
    if ($deleted_blobs_json) {
        my $deleted_blobs = Mojo::JSON::decode_json($deleted_blobs_json);
        if (ref $deleted_blobs eq 'ARRAY' && @$deleted_blobs) {
            $c->db->delete_blobs($result_id, $deleted_blobs);
        }
    }

    $c->render(json => {
        success       => 1,
        id            => int($result_id),
        canvas_id     => int($canvas_id),
        notes         => $c->db->get_user_notes($user_id, $canvas_id),
        note_map      => $c->db->get_all_accessible_note_metadata($user_id),
        last_mutation => $c->db->get_board_mutation_time($canvas_id)
    });
}

# Surgical persistence for note geometry (Move/Resize/Collapse).
# Route: POST /notes/api/geometry
# Description: Prevents stale payload race conditions by specifically ignoring 'content' and 'title'.
sub api_save_geometry {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id = $c->current_user_id();
    my $id      = $c->param('id');
    
    # 1. Parameter Extraction: Positional and Structural data ONLY
    my $params = {
        user_id             => $user_id,
        id                  => $id,
        x                   => int($c->param('x') // 0),
        y                   => int($c->param('y') // 0),
        width               => int($c->param('width') // 0),
        height              => int($c->param('height') // 0),
        z_index             => int($c->param('z_index') // 1),
        is_collapsed        => int($c->param('is_collapsed') // 0),
        is_options_expanded => int($c->param('is_options_expanded') // 0),
        layer_id            => int($c->param('layer_id') // 1)
    };

    # 2. Board Context & Authority: Perform surgical coordinate sync
    my ($result_id, $canvas_id) = $c->db->save_note_geometry($params);

    unless (defined $result_id) {
        return $c->render(json => { success => 0, error => 'Board Permission Denied' }, status => 403);
    }
    
    $c->render(json => {
        success       => 1,
        id            => int($result_id),
        canvas_id     => int($canvas_id),
        last_mutation => $c->db->get_board_mutation_time($canvas_id)
    });
}

# Permanently removes a note record.
# Route: POST /notes/api/delete
# Parameters: id, canvas_id
sub api_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $id        = $c->param('id');
    my $canvas_id = $c->param('canvas_id');
    my $user_id   = $c->current_user_id();

    my $ok = $c->db->delete_note($id, $user_id);

    unless ($ok) {
        return $c->render(json => { success => 0, error => 'Permission Denied or Note Not Found' }, status => 403);
    }

    $c->render(json => {
        success       => 1,
        notes         => $c->db->get_user_notes($user_id, $canvas_id),
        last_mutation => $c->db->get_board_mutation_time($canvas_id)
    });
}

# Persists the user's viewport scale and scroll position.
# Route: POST /notes/api/viewport
# Parameters: canvas_id, scale, scroll_x, scroll_y
sub api_save_viewport {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $canvas_id = $c->param('canvas_id');
    my $scale     = $c->param('scale')    // 1;
    my $centerX   = $c->param('scroll_x') // 2500;
    my $centerY   = $c->param('scroll_y') // 2500;
    my $layer_id  = $c->param('layer_id') // 1;

    $scale = 0.1  if $scale < 0.1;
    $scale = 3.00 if $scale > 3.00;

    $c->db->save_viewport($user_id, $canvas_id, $scale, $centerX, $centerY, $layer_id);
    $c->render(json => { 
        success       => 1,
        last_mutation => $c->db->get_board_mutation_time($canvas_id)
    });
}

# Processes a multipart image upload for a sticky note.
# Route: POST /notes/api/upload
sub api_upload {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $note_id   = $c->param('note_id');
    my $upload    = $c->param('file') // $c->param('image');
    my $canvas_id = $c->param('canvas_id');
    
    # Permission Pre-Flight: Verify access to the destination canvas
    unless ($c->db->check_canvas_access($canvas_id, $user_id, 1)) {
        return $c->render(json => { success => 0, error => "Permission Denied" }, status => 403);
    }

    my $mime_type = $upload->headers->content_type || 'application/octet-stream';
    my $type = ($mime_type =~ m/^image\//) ? 'image' : 'file';

    if (!$note_id && $upload) {
        $note_id = $c->db->save_note({
            user_id      => $user_id,
            canvas_id    => $canvas_id,
            layer_id     => $c->param('layer_id') // 1,
            type         => $type,
            title        => $c->param('title') // $upload->filename,
            content      => $c->param('content') // '',
            filename     => $upload->filename,
            x            => $c->param('x') // 0,
            y            => $c->param('y') // 0,
            width        => 400,
            height       => 400,
            color        => '#ffffff',
            z_index             => $c->param('z_index') // 1,
            is_collapsed        => 0,
            is_options_expanded => int($c->param('is_options_expanded') // 0)
        });
    } elsif ($note_id && $upload) {
        # Edge Case Fix: Update existing note metadata to reflect binary conversion
        $c->db->promote_note_to_binary($note_id, $type, $upload->filename);
    }

    unless ($upload && $note_id) {
        return $c->render(json => { success => 0, error => "Missing file or note_id" });
    }

    my $file_data = $upload->asset->slurp;
    # Recalculate MIME/size for blob storage
    $mime_type = $upload->headers->content_type || ($type eq 'image' ? 'image/png' : 'application/octet-stream');
    my $file_size = $upload->size;

    $c->db->store_note_blob($note_id, $file_data, $mime_type, $file_size, $upload->filename);

    $c->render(json => {
        success       => 1,
        note_id       => int($note_id),
        notes         => $c->db->get_user_notes($user_id, $canvas_id),
        last_mutation => $c->db->get_board_mutation_time($canvas_id)
    });
}

# Permanently removes a single binary attachment from a note.
# Route: POST /notes/api/attachment/delete
# Parameters: note_id, blob_id, canvas_id
sub api_attachment_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $note_id   = $c->param('note_id');
    my $blob_id   = $c->param('blob_id');
    my $canvas_id = $c->param('canvas_id');

    # Security Gate: Verify EDIT access to the board containing the note
    unless ($c->db->check_note_edit_permission($note_id, $user_id)) {
        return $c->render(json => { success => 0, error => "Permission Denied" }, status => 403);
    }

    # Atomic Deletion
    $c->db->delete_blobs($note_id, [$blob_id]);

    $c->render(json => {
        success       => 1,
        notes         => $c->db->get_user_notes($user_id, $canvas_id),
        last_mutation => $c->db->get_board_mutation_time($canvas_id)
    });
}

# Updates the display filename for a specific binary attachment in-place.
# Route: POST /notes/api/attachment/rename
# Parameters: note_id, blob_id, canvas_id, filename
sub api_attachment_rename {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $note_id   = $c->param('note_id');
    my $blob_id   = $c->param('blob_id');
    my $canvas_id = $c->param('canvas_id');
    my $filename  = Mojo::Util::trim($c->param('filename') // '');

    return $c->render(json => { success => 0, error => 'Filename required' }) unless length($filename) >= 1;

    # Security Gate: Verify EDIT access to the board containing the note
    unless ($c->db->check_note_edit_permission($note_id, $user_id)) {
        return $c->render(json => { success => 0, error => 'Permission Denied' }, status => 403);
    }

    my $ok = $c->db->update_blob_filename($blob_id, $note_id, $filename);

    $c->render(json => {
        success       => $ok ? 1 : 0,
        notes         => $c->db->get_user_notes($user_id, $canvas_id),
        last_mutation => $c->db->get_board_mutation_time($canvas_id)
    });
}

# Serves raw binary content for an image note (Legacy fallback returns first blob)
# Route: GET /notes/serve/:note_id
sub serve_blob {
    my $c = shift;
    return $c->render(text => 'Unauthorized', status => 403) unless $c->is_logged_in;

    my $note_id = $c->stash('note_id');
    my $user_id = $c->current_user_id();

    my $blob = $c->db->get_note_blob($note_id, $user_id);
    return $c->render(text => 'Not found or Unauthorized', status => 403) unless $blob;

    my $filename    = $blob->{filename} || "note_attachment_$note_id";
    my $disposition = ($blob->{mime_type} =~ m/^image\//) ? 'inline' : 'attachment';
    $c->res->headers->content_disposition("$disposition; filename=\"$filename\"");
    $c->res->headers->content_type($blob->{mime_type});
    $c->res->headers->header('Access-Control-Allow-Origin' => '*');
    $c->render(data => $blob->{file_data});
}

# Serves precisely targeted reel attachments.
# Route: GET /notes/attachment/serve/:blob_id
sub serve_attachment_blob {
    my $c = shift;
    return $c->render(text => 'Unauthorized', status => 403) unless $c->is_logged_in;

    my $blob_id = $c->stash('blob_id');
    my $user_id = $c->current_user_id();

    my $blob = $c->db->get_blob_by_id($blob_id, $user_id);
    return $c->render(text => 'Not found or Unauthorized', status => 403) unless $blob;

    my $filename    = $blob->{filename} || "attachment_$blob_id";
    my $disposition = ($blob->{mime_type} =~ m/^(image\/|application\/pdf)/) ? 'inline' : 'attachment';
    $c->res->headers->content_disposition("$disposition; filename=\"$filename\"");
    $c->res->headers->content_type($blob->{mime_type});
    $c->res->headers->header('Access-Control-Allow-Origin' => '*');
    $c->render(data => $blob->{file_data});
}
# --- Multi-Canvas API Expansion ---

# Initializes a new canonical board record.
sub api_canvas_create {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id = $c->current_user_id();
    my $name    = trim($c->param('name') // 'Untitled Workspace');
    
    my $id = $c->db->create_canvas($user_id, $name);
    $c->render(json => { success => 1, id => int($id) });
}

# Purges a board record (Owner only).
sub api_canvas_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $canvas_id = $c->param('canvas_id');

    # 1. Retention Check: Prevent users from deleting their ONLY workspace
    my $canvases = $c->db->get_available_canvases($user_id);
    my @owned = grep { $_->{is_owner} } @$canvases;
    
    if (scalar @owned <= 1) {
        return $c->render(json => { 
            success => 0, 
            error   => 'Retention Error: You must maintain at least one Notebook.' 
        });
    }
    
    $c->db->delete_canvas($canvas_id, $user_id);
    $c->render(json => { success => 1 });
}

# Updates the display sequence of boards via drag-and-drop.
sub api_canvas_reorder {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $order_map = $c->req->json; # Expects [{id: X, order: Y}, ...]

    unless ($order_map && ref $order_map eq 'ARRAY') {
        return $c->render(json => { success => 0, error => 'Invalid payload' });
    }

    # Explicit authority check: only the owner or the current user (for their share record) can update sort order.
    $c->db->update_canvas_order($user_id, $order_map);

    $c->render(json => { success => 1 });
}

# Manages shared access permissions.
sub api_canvas_share {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $canvas_id = $c->param('canvas_id');
    my $target    = $c->param('username');
    my $can_edit  = int($c->param('can_edit') // 1);
    my $revoke    = int($c->param('revoke') // 0);

    # 1. Authority Check: Only owner can manage shares
    my $canvases = $c->db->get_available_canvases($user_id);
    my ($canvas) = grep { $_->{id} == $canvas_id && $_->{is_owner} } @$canvases;
    return $c->render(json => { success => 0, error => 'Permission Denied' }, status => 403) unless $canvas;

    # 2. Target Resolution
    my $target_id = $c->db->get_user_id($target);
    return $c->render(json => { success => 0, error => 'User not found' }) unless $target_id;

    # Self-Share Guard: Owners cannot add themselves as a collaborator
    return $c->render(json => { success => 0, error => 'Cannot share a board with yourself' })
        if $target_id == $user_id;

    if ($revoke) {
        $c->db->unshare_canvas($canvas_id, $target_id);
    } else {
        $c->db->share_canvas($canvas_id, $target_id, $can_edit);
    }

    $c->render(json => { success => 1, share_list => $c->db->get_canvas_shares($canvas_id) });
}

# Real-time User Search (Search-as-you-type).
sub api_user_search {
    my $c = shift;
    return $c->render(json => [] ) unless $c->is_logged_in;

    my $query = trim($c->param('q') // '');
    my $me    = $c->current_user_id();

    return $c->render(json => []) if length $query < 2;

    # Logic-Pure Filtering: Only active/approved users, exclude self
    my $all_users = $c->db->get_all_users();
    my @matched = grep { 
        $_->{id} != $me && 
        $_->{status} eq 'approved' && 
        $_->{username} =~ m/\Q$query\E/i 
    } @$all_users;

    $c->render(json => \@matched);
}

# Performs an ACL-aware global search across all accessible boards.
# Route: GET /notes/api/search
sub api_search {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id = $c->current_user_id();
    my $query   = trim($c->param('q') // '');
    
    # Logic-Pure: Immediate exit for empty queries
    return $c->render(json => []) if length $query < 1;

    my $notes = $c->db->get_global_search_notes($user_id, $query);
    
    $c->render(json => $notes);
}

# Copies a note to a different board.
sub api_copy_note {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $note_id   = $c->param('id');
    my $new_cid   = $c->param('canvas_id');

    if ($c->db->copy_note($note_id, $new_cid, $user_id)) {
        $c->render(json => { success => 1 });
    } else {
        $c->render(json => { success => 0, error => 'Logic Error or Permission Denied' });
    }
}
# Renames a board record (Owner only).
# Route: POST /notes/api/canvases/rename
sub api_canvas_rename {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $canvas_id = $c->param('canvas_id');
    my $new_name  = trim($c->param('name') // '');
    
    return $c->render(json => { success => 0, error => 'Invalid name' }) unless length($new_name) >= 1;

    if ($c->db->rename_canvas($canvas_id, $user_id, $new_name)) {
        $c->render(json => { success => 1, name => $new_name });
    } else {
        $c->render(json => { success => 0, error => 'Permission denied or update failed' });
    }
}

# --- Real-Time Sync Heartbeat ---

# Returns the latest mutation timestamp for a specific workspace.
# Used by the mutation listener for cross-session state reconciliation.
sub api_heartbeat {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $canvas_id = $c->stash('canvas_id');
    my $layer_id  = $c->param('layer_id');
    my $user_id   = $c->current_user_id();

    # Authority Check: Ensure the user has at least read-access to this board
    unless ($user_id && $c->db->check_canvas_access($canvas_id, $user_id, 0)) {
        return $c->render(json => { success => 0, error => 'Access Denied' }, status => 403);
    }

    # Signal Fetch: Get optimized aggregate timestamp from notes + canvases
    # If layer_id is present, the mutation baseline is focused solely on the user's current perspective.
    my $last_mutation = $c->db->get_board_mutation_time($canvas_id, $layer_id);

    $c->render(json => {
        success       => 1,
        last_mutation => $last_mutation // '1970-01-01 00:00:00'
    });
}

# --- Bin & Recovery API ---

# Retrieves all soft-deleted notes for the active user.
# Route: GET /notes/api/bin
sub api_bin {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id = $c->current_user_id();
    my $notes   = $c->db->get_deleted_notes($user_id);

    $c->render(json => {
        success => 1,
        notes   => $notes
    });
}

# Restores a note from the bin.
# Route: POST /notes/api/restore
sub api_restore {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $id        = $c->param('id');
    my $canvas_id = $c->param('canvas_id');
    my $layer_id  = $c->param('layer_id');
    my $x         = $c->param('x');
    my $y         = $c->param('y');
    my $user_id   = $c->current_user_id();

    if ($c->db->restore_note($id, $user_id, $canvas_id, $layer_id, $x, $y)) {
        $c->render(json => { success => 1 });
    } else {
        $c->render(json => { success => 0, error => 'Restoration Failed or Permission Denied' });
    }
}

# Permanently removes a note record.
# Route: POST /notes/api/purge
sub api_purge {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $id      = $c->param('id');
    my $user_id = $c->current_user_id();

    if ($c->db->purge_note($id, $user_id)) {
        $c->render(json => { success => 1 });
    } else {
        $c->render(json => { success => 0, error => 'Purge Failed or Permission Denied' });
    }
}

# Updates the descriptive name for a specific board level.
# Route: POST /notes/api/layer/rename
sub api_layer_rename {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $canvas_id = $c->param('canvas_id');
    my $layer_id  = int($c->param('layer_id') // 0);
    my $name      = trim($c->param('name') // '');

    # Logic-Pure Validation: Layers must be in the 1-99 range
    return $c->render(json => { success => 0, error => 'Invalid level' }) if $layer_id < 1 || $layer_id > 99;
    
    # 1. Authority Check: Requires EDIT access to the targeted board
    unless ($c->db->check_canvas_access($canvas_id, $user_id, 1)) {
        return $c->render(json => { success => 0, error => 'Permission Denied' }, status => 403);
    }

    if ($c->db->save_layer_alias($canvas_id, $layer_id, $name)) {
        # Global sync pulse
        $c->db->touch_canvas($canvas_id);
        
        $c->render(json => { 
            success   => 1, 
            layer_map => $c->db->get_canvas_layers($canvas_id) 
        });
    } else {
        $c->render(json => { success => 0, error => 'Update failed' });
    }
}

# Migrates all notes from one layer to another.
sub api_move_layer {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $canvas_id = $c->param('canvas_id');
    my $from      = int($c->param('from_id') // 0);
    my $to        = int($c->param('to_id')   // 0);

    return $c->render(json => { success => 0, error => 'Source level must be 1-99' }) if $from < 1 || $from > 99;
    return $c->render(json => { success => 0, error => 'Target level must be 1-99' }) if $to < 1 || $to > 99;
    return $c->render(json => { success => 0, error => 'Target level is same as source' }) if $from == $to;

    # Security: Verify edit access
    return $c->render(json => { success => 0, error => 'Read-Only' }, status => 403) 
        unless $c->db->check_canvas_access($canvas_id, $user_id, 1);

    my $rows  = $c->db->move_layer_content($canvas_id, $from, $to);
    my $count = int($rows) || 0;

    return $c->render(json => { 
        success => 1, 
        count   => $count,
        message => "Migrated $count notes to Level $to"
    });
}

1;
