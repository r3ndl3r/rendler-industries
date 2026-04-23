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
    
    # 4. Privacy Lock: Determine if content is accessible
    my $unlocked_ids = $c->_get_unlocked_ids;
    my $is_locked    = $c->is_canvas_locked($cid);
    
    # Slide the window if validly accessed
    $c->refresh_canvas_lock($cid) unless $is_locked;

    my $notes      = $is_locked ? [] : $c->db->get_user_notes($user_id, $cid, $unlocked_ids);
    my $share_list = $c->db->get_canvas_shares($cid);

    # 🚀 Performance Optimization: Delta Handshake
    my $client_hash = $c->param('note_map_hash') || '';
    my $fingerprint = $c->db->get_note_map_fingerprint($user_id);
    
    my $note_map;
    if ($is_locked) {
        $note_map = {}; # Content hidden
    } elsif (!defined $fingerprint) {
        $note_map    = $c->db->get_all_accessible_note_metadata($user_id, $unlocked_ids);
        $fingerprint = ''; 
    } else {
        $note_map = ($client_hash ne $fingerprint) 
                  ? $c->db->get_all_accessible_note_metadata($user_id, $unlocked_ids) 
                  : undef;
    }

    # Mask the fingerprint if the board is locked. 
    # This prevents the client from caching a valid hash from a restricted state.
    $fingerprint = undef if $is_locked;

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
        last_mutation => $c->db->get_board_mutation_time($cid),
        is_locked     => $is_locked,
        unlocked_canvases => $unlocked_ids
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

    my $sid = $c->param('session_id');
    unless (defined $sid && length $sid) {
        return $c->render(json => { success => 0, error => 'Missing or invalid session_id' }, status => 400);
    }
    $params->{session_id} = $sid;

    my $result_id = $c->db->save_note($params);

    if (defined $result_id && $result_id == -1) {
        return $c->render(json => { success => 0, error => 'Note is locked by another session' }, status => 403);
    }
    
    unless (defined $result_id) {
        return $c->render(json => { success => 0, error => 'Board Permission Denied (Read-Only?)' }, status => 403);
    }

    $c->refresh_canvas_lock($canvas_id) if defined $canvas_id;
    
    # Optional Purge: Process any attachments marked for deletion in this save cycle
    my $deleted_blobs_json = $c->param('deleted_blobs');
    if ($deleted_blobs_json) {
        my $deleted_blobs = eval { Mojo::JSON::decode_json($deleted_blobs_json) };
        if ($@) {
            $c->app->log->warn("Failed to decode deleted_blobs: $@");
        }
        if (ref $deleted_blobs eq 'ARRAY' && @$deleted_blobs) {
            $c->db->delete_blobs($result_id, $deleted_blobs);
        }
    }

    my $unlocked_ids = $c->_get_unlocked_ids;
    $c->render(json => {
        success       => 1,
        id            => int($result_id),
        canvas_id     => int($canvas_id),
        notes         => $c->db->get_user_notes($user_id, $canvas_id, $unlocked_ids),
        note_map      => $c->db->get_all_accessible_note_metadata($user_id, $unlocked_ids),
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
        layer_id            => int($c->param('layer_id') // 1),
    };
    # Only include color when the caller explicitly sends it; omitting the key
    # signals save_note_geometry to preserve the existing DB value rather than
    # overwriting it with NULL on geometry-only calls (collapse, drag, resize).
    $params->{color} = $c->param('color') if defined $c->param('color');

    # Resolve canvas context for lock check BEFORE write
    my $canvas_id = $c->db->get_canvas_for_note_id($id, $user_id);
    if ($canvas_id && $c->is_canvas_locked($canvas_id)) {
        return $c->render(json => { success => 0, error => 'Canvas is locked' }, status => 403);
    }

    # 2. Board Context & Authority: Direct coordinate/dimension synchronization
    my $sid = $c->param('session_id');
    unless (defined $sid && length $sid) {
        return $c->render(json => { success => 0, error => 'Missing or invalid session_id' }, status => 400);
    }
    $params->{session_id} = $sid;
    my ($result_id) = $c->db->save_note_geometry($params);

    if (defined $result_id && $result_id == -1) {
        return $c->render(json => { success => 0, error => 'Note is locked by another session' }, status => 403);
    }

    unless (defined $result_id) {
        return $c->render(json => { success => 0, error => 'Board Permission Denied' }, status => 403);
    }

    $c->refresh_canvas_lock($canvas_id) if defined $canvas_id;
    
    $c->render(json => {
        success       => 1,
        id            => int($result_id),
        canvas_id     => int($canvas_id),
        last_mutation => $c->db->get_board_mutation_time($canvas_id)
    });
}

# Persists coordinate and metadata changes for a group of notes in a single atomic transaction.
# Route: POST /notes/api/batch_geometry
sub api_batch_geometry {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id = $c->current_user_id();
    my $sid     = $c->req->headers->header('X-Notes-Session-ID') // $c->param('session_id') // '';
    my $data    = $c->req->json // {};

    my $canvas_id = $data->{canvas_id} // $c->param('canvas_id');
    my $updates   = $data->{updates}   // $c->param('updates');

    unless (defined $canvas_id && $canvas_id =~ /\A\d+\z/) {
        return $c->render(json => { success => 0, error => 'Invalid canvas_id' }, status => 400);
    }

    # Accept pre-decoded array (JSON body) or a JSON string (form-encoded fallback)
    if (defined $updates && !ref($updates)) {
        eval { $updates = Mojo::JSON::decode_json($updates) };
    }
    unless ($updates && ref($updates) eq 'ARRAY') {
        return $c->render(json => { success => 0, error => 'Invalid payload format' }, status => 400);
    }

    if (scalar @$updates > 100) {
        return $c->render(json => { success => 0, error => 'Batch size exceeds limit (100)' }, status => 400);
    }

    my $result = $c->db->update_batch_geometry($updates, $user_id, $sid);

    if ($result->{success}) {
        $c->render(json => {
            success       => 1,
            last_mutation => $c->db->get_board_mutation_time($canvas_id)
        });
    } else {
        $c->render(json => {
            success => 0,
            error   => $result->{error} // 'Partial or total update failure',
        });
    }
}

# Permanently removes a note record.
# Route: POST /notes/api/delete
# Parameters: id, canvas_id
sub api_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $id        = $c->param('id');
    my $user_id   = $c->current_user_id();

    my $cid = $c->db->get_canvas_for_note_id($id, $user_id);
    if ($cid && $c->is_canvas_locked($cid)) {
        return $c->render(json => { success => 0, error => 'Canvas is locked' }, status => 403);
    }

    my $ok = $c->db->delete_note($id, $user_id);

    if ($ok == -1) {
        return $c->render(json => { success => 0, error => 'Note is locked by another session' }, status => 409);
    }
    unless ($ok) {
        return $c->render(json => { success => 0, error => 'Permission Denied or Note Not Found' }, status => 403);
    }

    $c->refresh_canvas_lock($cid) if defined $cid;

    my $unlocked_ids = $c->_get_unlocked_ids;
    $c->render(json => {
        success       => 1,
        notes         => $c->db->get_user_notes($user_id, $cid, $unlocked_ids),
        last_mutation => $c->db->get_board_mutation_time($cid)
    });
}

# Processes a bulk deletion request for a group of lassoed notes.
# Route: POST /notes/api/batch_delete
# Parameters: ids (JSON Array), canvas_id (Optional)
sub api_batch_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id = $c->current_user_id();
    my $sid     = $c->req->headers->header('X-Notes-Session-ID') // $c->param('session_id') // '';
    my $data    = $c->req->json // {};
    my $ids     = $data->{ids} // $c->param('ids');
    my $canvas_id = $data->{canvas_id} // $c->param('canvas_id');

    # Accept pre-decoded array (JSON body) or a JSON string (form-encoded fallback)
    if (defined $ids && !ref($ids)) {
        eval { $ids = Mojo::JSON::decode_json($ids) };
    }
    unless ($ids && ref($ids) eq 'ARRAY' && @$ids) {
        return $c->render(json => { success => 0, error => 'Invalid or empty IDs list' }, status => 400);
    }

    # Resolution: Collect all distinct canvas IDs for the requested notes and
    # verify each one is accessible and not locked before proceeding.
    my %seen_canvas;
    for my $note_id (@$ids) {
        my $cid = $c->db->get_canvas_for_note_id($note_id, $user_id);
        unless ($cid) {
            return $c->render(json => { success => 0, error => "Note #$note_id not found or access denied" }, status => 403);
        }
        $seen_canvas{$cid} = 1;
    }
    for my $cid (keys %seen_canvas) {
        if ($c->is_canvas_locked($cid)) {
            return $c->render(json => { success => 0, error => 'Canvas is locked' }, status => 403);
        }
    }
    # Use the first resolved canvas for post-delete side effects if not explicitly provided
    $canvas_id //= (keys %seen_canvas)[0];

    my $result = $c->db->delete_batch_notes($ids, $user_id, $sid);

    if ($result->{success}) {
        $c->refresh_canvas_lock($canvas_id) if $canvas_id;
        
        my $unlocked_ids = $c->_get_unlocked_ids;
        $c->render(json => {
            success       => 1,
            deleted_count => scalar(@{$result->{deleted_ids} // []}),
            notes         => $c->db->get_user_notes($user_id, $canvas_id, $unlocked_ids),
            last_mutation => $c->db->get_board_mutation_time($canvas_id)
        });
    } else {
        $c->render(json => {
            success => 0,
            error   => $result->{error} // 'Partial or total deletion failure',
        });
    }
}

# Acquires an exclusive collaborative lock.
# Route: POST /notes/api/lock
sub api_lock {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $id      = $c->param('id');
    my $sid     = $c->param('session_id');
    my $user_id = $c->current_user_id();

    if ($c->db->lock_note($id, $user_id, $sid)) {
        return $c->render(json => { success => 1 });
    }
    return $c->render(json => { success => 0, error => 'Note is already locked by another user' });
}

# Releases an exclusive collaborative lock.
# Route: POST /notes/api/unlock
sub api_unlock {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $id      = $c->param('id');
    my $sid     = $c->param('session_id');
    my $user_id = $c->current_user_id();

    if ($c->db->unlock_note($id, $user_id, $sid)) {
        return $c->render(json => { success => 1 });
    }

    return $c->render(json => { success => 0, error => 'Unlock denied or note not found' }, status => 403);
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
    my $cid = $canvas_id;
    if ($note_id) {
        $cid = $c->db->get_canvas_for_note_id($note_id, $user_id);
    }

    # Permission Pre-Flight: Verify access to the destination canvas
    unless ($cid && $c->db->check_canvas_access($cid, $user_id, 1)) {
        return $c->render(json => { success => 0, error => "Permission Denied" }, status => 403);
    }

    if ($c->is_canvas_locked($cid)) {
        return $c->render(json => { success => 0, error => 'Canvas is locked' }, status => 403);
    }

    unless ($upload) {
        return $c->render(json => { success => 0, error => 'Missing file' }, status => 400);
    }

    my $mime_type = $upload->headers->content_type || 'application/octet-stream';
    my $type = ($mime_type =~ m/^image\//) ? 'image' : 'file';

    my $sid = $c->param('session_id');
    unless (defined $sid && length $sid) {
        return $c->render(json => { success => 0, error => 'Missing or invalid session_id' }, status => 400);
    }

    if (!$note_id && $upload) {
        $note_id = $c->db->save_note({
            user_id      => $user_id,
            canvas_id    => $cid,
            session_id   => $sid,
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
        my $lock = $c->db->{dbh}->selectrow_hashref(
            "SELECT locked_by_session_id, locked_at FROM notes WHERE id = ?", undef, $note_id
        );
        if ($lock && $lock->{locked_by_session_id}
            && $lock->{locked_by_session_id} ne $sid
            && $lock->{locked_at} gt DateTime->now->subtract(minutes => 5)->iso8601) {
            return $c->render(json => { success => 0, error => 'Note is locked by another session' }, status => 409);
        }
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

    $c->refresh_canvas_lock($cid) if defined $cid;

    my $unlocked_ids = $c->_get_unlocked_ids;
    $c->render(json => {
        success       => 1,
        note_id       => int($note_id),
        notes         => $c->db->get_user_notes($user_id, $cid, $unlocked_ids),
        last_mutation => $c->db->get_board_mutation_time($cid)
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

    # Security Gate: Resolve the actual canvas context
    my $cid = $c->db->get_canvas_for_note_id($note_id, $user_id);
    unless ($cid && $c->db->check_note_edit_permission($note_id, $user_id)) {
        return $c->render(json => { success => 0, error => "Permission Denied" }, status => 403);
    }

    if ($c->is_canvas_locked($cid)) {
        return $c->render(json => { success => 0, error => 'Canvas is locked' }, status => 403);
    }

    # Atomic Deletion
    $c->db->delete_blobs($note_id, [$blob_id]);

    $c->refresh_canvas_lock($cid) if defined $cid;

    my $unlocked_ids = $c->_get_unlocked_ids;
    $c->render(json => {
        success       => 1,
        notes         => $c->db->get_user_notes($user_id, $cid, $unlocked_ids),
        last_mutation => $c->db->get_board_mutation_time($cid)
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
    my $filename  = Mojo::Util::trim($c->param('filename') // '');

    return $c->render(json => { success => 0, error => 'Filename required' }) unless length($filename) >= 1;

    # Security Gate: Resolve the actual canvas context
    my $cid = $c->db->get_canvas_for_note_id($note_id, $user_id);
    unless ($cid && $c->db->check_note_edit_permission($note_id, $user_id)) {
        return $c->render(json => { success => 0, error => 'Permission Denied' }, status => 403);
    }

    if ($c->is_canvas_locked($cid)) {
        return $c->render(json => { success => 0, error => 'Canvas is locked' }, status => 403);
    }

    my $ok = $c->db->update_blob_filename($blob_id, $note_id, $filename);

    $c->refresh_canvas_lock($cid) if defined $cid;

    my $unlocked_ids = $c->_get_unlocked_ids;
    $c->render(json => {
        success       => $ok ? 1 : 0,
        notes         => $c->db->get_user_notes($user_id, $cid, $unlocked_ids),
        last_mutation => $c->db->get_board_mutation_time($cid)
    });
}

# Serves raw binary content for an image note (Legacy fallback returns first blob)
# Route: GET /notes/serve/:note_id
sub serve_blob {
    my $c = shift;
    return $c->render(text => 'Unauthorized', status => 403) unless $c->is_logged_in;

    my $note_id = $c->stash('note_id');
    my $user_id = $c->current_user_id();
    my $unlocked_ids = $c->_get_unlocked_ids;

    my $blob = $c->db->get_note_blob($note_id, $user_id, $unlocked_ids);
    unless ($blob) {
        my $cid = $c->db->get_canvas_for_note_id($note_id, $user_id);
        if ($cid && $c->is_canvas_locked($cid)) {
            return $c->render(text => 'Canvas Locked', status => 403);
        }
        return $c->render(text => 'Not found or Unauthorized', status => 403);
    }

    my $filename    = $blob->{filename} || "note_attachment_$note_id";
    (my $safe_filename = $filename) =~ s/["\r\n\\]/_/g;
    my $disposition = ($blob->{mime_type} =~ m/^image\//) ? 'inline' : 'attachment';
    $c->res->headers->content_disposition("$disposition; filename=\"$safe_filename\"");
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
    my $unlocked_ids = $c->_get_unlocked_ids;

    my $blob = $c->db->get_blob_by_id($blob_id, $user_id, $unlocked_ids);
    unless ($blob) {
        if ($blob_id) {
            # Note: Minimal DB call to resolve canvas for security check
            my $sth = $c->db->{dbh}->prepare("SELECT n.canvas_id FROM note_blobs nb JOIN notes n ON nb.note_id = n.id WHERE nb.id = ?");
            $sth->execute($blob_id);
            my ($cid) = $sth->fetchrow_array();
            if ($cid && $c->is_canvas_locked($cid)) {
                return $c->render(text => 'Canvas Locked', status => 403);
            }
        }
        return $c->render(text => 'Not found or Unauthorized', status => 403);
    }

    my $filename    = $blob->{filename} || "attachment_$blob_id";
    (my $safe_filename = $filename) =~ s/["\r\n\\]/_/g;
    my $disposition = ($blob->{mime_type} =~ m/^(image\/|application\/pdf)/) ? 'inline' : 'attachment';
    $c->res->headers->content_disposition("$disposition; filename=\"$safe_filename\"");
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

    my $notes = $c->db->get_global_search_notes($user_id, $query, $c->_get_unlocked_ids);
    
    $c->render(json => $notes);
}

# Copies a note to a different board.
sub api_copy_note {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $note_id   = $c->param('id');
    my $new_cid   = $c->param('canvas_id');

    # Security: Resolve source and verify locks on both sides
    my $source_cid = $c->db->get_canvas_for_note_id($note_id, $user_id);
    if ($source_cid && $c->is_canvas_locked($source_cid)) {
        return $c->render(json => { success => 0, error => 'Source Canvas is locked' }, status => 403);
    }
    if ($new_cid && $c->db->check_canvas_access($new_cid, $user_id, 0) && $c->is_canvas_locked($new_cid)) {
        return $c->render(json => { success => 0, error => 'Destination Canvas is locked' }, status => 403);
    }

    if ($c->db->copy_note($note_id, $new_cid, $user_id)) {
        $c->refresh_canvas_lock($source_cid) if $source_cid;
        $c->refresh_canvas_lock($new_cid)    if $new_cid;
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
        last_mutation => $last_mutation // '1970-01-01 00:00:00',
        is_locked     => $c->is_canvas_locked($canvas_id)
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

    if ($c->is_canvas_locked($canvas_id)) {
        return $c->render(json => { success => 0, error => 'Canvas is locked' }, status => 403);
    }

    if ($c->db->restore_note($id, $user_id, $canvas_id, $layer_id, $x, $y)) {
        $c->refresh_canvas_lock($canvas_id) if defined $canvas_id;
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

    # Authority Check: Resolve canvas ID to prevent unauthorized leaks of private note geometry
    my $cid = $c->db->get_canvas_for_note_id($id, $user_id);
    if ($cid && $c->is_canvas_locked($cid)) {
        return $c->render(json => { success => 0, error => 'Canvas is locked' }, status => 403);
    }

    if ($c->db->purge_note($id, $user_id)) {
        $c->refresh_canvas_lock($cid) if $cid;
        $c->render(json => { success => 1 });
    } else {
        $c->render(json => { success => 0, error => 'Purge Failed or Permission Denied' });
    }
}

# Permanently removes all binned notes for the current user.
# Route: POST /notes/api/purge_all
sub api_purge_all {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id = $c->current_user_id();
    my $count   = $c->db->purge_all_notes($user_id);
    $c->render(json => { success => 1, count => $count + 0 });
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

# --- Security & Privacy Handlers ---

# Verifies and unlocks a protected canvas for the current session.
sub api_unlock_canvas {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $canvas_id = $c->param('canvas_id') || '';
    my $password  = $c->param('password')  || '';

    # Strict integer validation for canvas_id
    return $c->render(json => { success => 0, error => 'Invalid canvas_id' }, status => 400) 
        unless $canvas_id =~ /^\d+$/;

    # ACL Check: Prevent guessing passwords for boards the user doesn't even have access to
    return $c->render(json => { success => 0, error => 'Permission Denied' }, status => 403)
        unless $c->db->check_canvas_access($canvas_id, $c->current_user_id, 0);

    # Unified Rate Limiting check
    my $limit_error = $c->_check_rate_limit($canvas_id);
    return $c->render(json => { success => 0, error => $limit_error }, status => 429) if $limit_error;

    if ($c->db->verify_canvas_password($canvas_id, $password)) {
        # Successful Unlock: Reset attempt counter
        $c->session->{'unlock_fails_' . $canvas_id} = 0;
        
        my $unlocked = $c->session->{unlocked_canvases} || {};
        if (ref $unlocked eq 'HASH') {
            my $lock_version = $c->db->get_canvas_lock_version($canvas_id);
            $unlocked->{$canvas_id} = {
                expiry  => time + 1800,
                version => $lock_version
            };
            $c->session(unlocked_canvases => $unlocked);
        }
        
        return $c->render(json => { 
            success => 1,
            unlocked_canvases => $c->_get_unlocked_ids
        });
    }

    # Increment failure counter
    my $rate_data = $c->session->{'unlock_fails_' . $canvas_id} || { count => 0, since => time };
    $rate_data->{since} = time unless $rate_data->{count};
    $rate_data->{count}++;
    $c->session->{'unlock_fails_' . $canvas_id} = $rate_data;

    return $c->render(json => { success => 0, error => 'Incorrect password' });
}

# Removes a canvas from the session-unlock list.
sub api_lock_canvas {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $canvas_id = $c->param('canvas_id') || '';
    
    # Strict integer validation
    return $c->render(json => { success => 0, error => 'Invalid canvas_id' }, status => 400) 
        unless $canvas_id =~ /^\d+$/;
    
    my $unlocked = $c->session->{unlocked_canvases} || {};
    if (ref $unlocked eq 'HASH') {
        delete $unlocked->{$canvas_id};
        $c->session(unlocked_canvases => $unlocked);
    }

    return $c->render(json => { 
        success => 1,
        unlocked_canvases => $c->_get_unlocked_ids
    });
}

# Sets or updates a canvas password (Owner Only).
sub api_canvas_password_set {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id;
    my $canvas_id = $c->param('canvas_id') || '';
    my $new_pass  = $c->param('password');
    my $old_pass  = $c->param('old_password');

    # Strict integer validation
    return $c->render(json => { success => 0, error => 'Invalid canvas_id' }, status => 400) 
        unless $canvas_id =~ /^\d+$/;

    # Server-side non-empty check for new passwords
    return $c->render(json => { success => 0, error => 'Password cannot be empty' }, status => 400)
        unless defined $new_pass && length $new_pass;

    # Authority: resolve board context
    my $canvases = $c->db->get_available_canvases($user_id);
    my ($canvas) = grep { $_->{id} == $canvas_id && $_->{is_owner} } @$canvases;
    return $c->render(json => { success => 0, error => 'Permission Denied' }, status => 403) unless $canvas;

    # Rate limit current password verification if changing
    if ($canvas->{is_protected}) {
        my $limit_error = $c->_check_rate_limit($canvas_id);
        return $c->render(json => { success => 0, error => $limit_error }, status => 429) if $limit_error;

        unless (defined $old_pass && $c->db->verify_canvas_password($canvas_id, $old_pass)) {
            # Increment failure counter
            my $rate_data = $c->session->{'unlock_fails_' . $canvas_id} || { count => 0, since => time };
            $rate_data->{since} = time unless $rate_data->{count};
            $rate_data->{count}++;
            $c->session->{'unlock_fails_' . $canvas_id} = $rate_data;

            return $c->render(json => { success => 0, error => 'Incorrect current password' });
        }
    }

    $c->db->set_canvas_password($canvas_id, $new_pass);
    
    # Invalidate current unlocks for all users to force zero-trust fresh start
    my $unlocked = $c->session->{unlocked_canvases} || {};
    if (ref $unlocked eq 'HASH') {
        delete $unlocked->{$canvas_id};
        
        # Self-Unlock: owner remains unlocked with the NEW version
        if ($new_pass) {
            my $lock_version = $c->db->get_canvas_lock_version($canvas_id);
            $unlocked->{$canvas_id} = {
                expiry  => time + 1800,
                version => $lock_version
            };
        }
        $c->session(unlocked_canvases => $unlocked);
    }

    # Reset failure counter on successful change
    $c->session->{'unlock_fails_' . $canvas_id} = 0;

    return $c->render(json => { success => 1 });
}

# Removes password protection from a canvas (Owner Only).
sub api_canvas_password_clear {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id;
    my $canvas_id = $c->param('canvas_id') || '';
    my $password  = $c->param('password')  || '';

    # Strict integer validation
    return $c->render(json => { success => 0, error => 'Invalid canvas_id' }, status => 400) 
        unless $canvas_id =~ /^\d+$/;

    # Authority Check MUST precede Rate Limiting
    # non-owners from exhausting the owner's attempt window.
    my $canvases = $c->db->get_available_canvases($user_id);
    my ($canvas) = grep { $_->{id} == $canvas_id && $_->{is_owner} } @$canvases;
    return $c->render(json => { success => 0, error => 'Permission Denied' }, status => 403) unless $canvas;

    # Rate limiting
    my $limit_error = $c->_check_rate_limit($canvas_id);
    return $c->render(json => { success => 0, error => $limit_error }, status => 429) if $limit_error;

    # Intent Verification
    unless ($c->db->verify_canvas_password($canvas_id, $password)) {
        # Increment failure counter
        my $rate_data = $c->session->{'unlock_fails_' . $canvas_id} || { count => 0, since => time };
        $rate_data->{since} = time unless $rate_data->{count};
        $rate_data->{count}++;
        $c->session->{'unlock_fails_' . $canvas_id} = $rate_data;

        return $c->render(json => { success => 0, error => 'Incorrect password' });
    }

    $c->db->set_canvas_password($canvas_id, undef);
    
    # Reset failure counter on successful clear
    $c->session->{'unlock_fails_' . $canvas_id} = 0;

    my $unlocked = $c->session->{unlocked_canvases} || {};
    if (ref $unlocked eq 'HASH') {
        delete $unlocked->{$canvas_id};
        $c->session(unlocked_canvases => $unlocked);
    }

    return $c->render(json => { success => 1 });
}

# --- Controller Helpers ---

# Validates and extracts active session-unlocked canvas IDs.
sub _get_unlocked_ids {
    my $c = shift;
    
    # Request-level caching for UNION query performance
    return $c->stash->{_unlocked_ids_cache} if exists $c->stash->{_unlocked_ids_cache};

    my $user_id = $c->current_user_id;
    my $unlocked = $c->session->{unlocked_canvases} || {};
    my $now = time;
    my $canvases   = $c->db->get_available_canvases($user_id);
    my %accessible;
    foreach my $item (@$canvases) {
        $accessible{$item->{id}} = $item->{lock_version} // 0;
    }

    my @candidates;
    for my $cid (keys %$unlocked) {
        my $token = $unlocked->{$cid};
        next unless exists $accessible{$cid};

        if (ref $token eq 'HASH') {
            # Version match: Use the version already prefetched in %accessible
            next if $token->{version} != $accessible{$cid};
            push @candidates, $cid if $token->{expiry} > $now;
        } else {
            # Legacy token support
            push @candidates, $cid if ($token // 0) > $now;
        }
    }

    my @unlocked_ids = @candidates;
    return $c->stash->{_unlocked_ids_cache} = \@unlocked_ids;
}

# Read-only check: Is the specific canvas currently restricted?
sub is_canvas_locked {
    my ($c, $canvas_id) = @_;
    return 0 unless $canvas_id;

    # Optimization: Cache protection metadata in request stash.
    my $cache = $c->stash->{_canvas_protected_cache} //= {};
    my $is_protected = $cache->{$canvas_id} //= $c->db->is_canvas_protected($canvas_id);

    return 1 if $is_protected && !grep { $_ == $canvas_id } @{ $c->_get_unlocked_ids };
    return 0;
}

# --- Internal Security Helpers ---

# Time-decayed rate limiting for password attempts.
# Returns error message if limited, undef otherwise.
sub _check_rate_limit {
    my ($c, $canvas_id) = @_;
    
    my $rate_data = $c->session->{'unlock_fails_' . $canvas_id};
    return undef unless $rate_data; # No failures yet

    # Support legacy flat counters
    if (ref $rate_data ne 'HASH') {
        # Ensure local state synchronization post-session write.
        # Prevents "Not a HASH reference" crash in the cooldown logic below.
        $rate_data = { count => $rate_data, since => time };
        $c->session->{'unlock_fails_' . $canvas_id} = $rate_data;
        return undef if $rate_data->{count} < 3;
    }

    # Cooldown window (15 minutes)
    if (time - $rate_data->{since} > 900) {
        $c->session->{'unlock_fails_' . $canvas_id} = 0;
        return undef;
    }

    if ($rate_data->{count} >= 3) {
        my $wait = 900 - (time - $rate_data->{since});
        $c->res->headers->header('Retry-After' => $wait);
        return "Too many failed attempts. Try again in " . int($wait / 60) . " minutes.";
    }

    return undef;
}

# Slide the 30-minute window for an unlocked canvas.
sub refresh_canvas_lock {
    my ($c, $canvas_id) = @_;
    return unless defined $canvas_id && $canvas_id;

    my $unlocked = $c->session->{unlocked_canvases} || {};
    my $token    = $unlocked->{$canvas_id};
    return unless $token;

    # Standardize session token format for consistent validation.
    # The session sliding window must respect the new {expiry, version} token format.
    if (ref $token eq 'HASH') {
        # Only slide if not already expired; do not silently resurrect a dead token
        return unless $token->{expiry} > time;
        $token->{expiry} = time + 1800;
        $unlocked->{$canvas_id} = $token;
    } else {
        # Legacy migration path for older integer timestamps
        return unless $token > time;
        $unlocked->{$canvas_id} = time + 1800;
    }

    $c->session(unlocked_canvases => $unlocked);
}

1;
