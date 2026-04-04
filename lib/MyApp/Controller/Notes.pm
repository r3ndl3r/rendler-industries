# /lib/MyApp/Controller/Notes.pm

package MyApp::Controller::Notes;

use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for the /notes Whiteboard module.
#
# Features:
#   - Single Source of Truth handshake for initial SPA state.
#   - Atomic persistence for draggable sticky note coordinates.
#   - Multipart image upload processing with binary BLOB storage.
#   - Unified access for all registered/logged-in users.
#
# Integration Points:
#   - Strictly adheres to the project's MVC and privacy standards.
#   - Depends on DB::Notes for privacy-isolated SQL logic.
#   - Leverages localized serving for binary note blobs.

# Renders the main whiteboard skeleton.
# Route: GET /notes
# Description: Serves the Pure Skeleton SPA template.
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render('notes');
}

# Returns the consolidated state for the notes board.
# Route: GET /notes/api/state
# Description: SSO handshake for all user-specific sticky notes and viewport config.
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $canvas_id = $c->param('canvas_id') // 1;
    
    my $notes    = $c->db->get_user_notes($user_id, $canvas_id);
    my $viewport = $c->db->get_viewport($user_id, $canvas_id);

    $c->render(json => {
        success   => 1,
        notes     => $notes,
        user_id   => $user_id,
        canvas_id => int($canvas_id),
        viewport  => $viewport
    });
}

# Synchronizes or creates a sticky note record.
# Route: POST /notes/api/save
# Parameters: id (Optional), canvas_id, type, content, x, y, width, height, color, z_index, is_collapsed
sub api_save {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id = $c->current_user_id();
    my $canvas_id = $c->param('canvas_id') // 1;

    my $id = $c->param('id');
    $id = undef if $id && ($id eq 'null' || $id eq 'undefined' || $id eq '');

    my $params = {
        id           => $id,
        user_id      => $user_id,
        canvas_id    => $canvas_id,
        type         => $c->param('type') // 'text',
        title        => trim($c->param('title') // 'Untitled Note'),
        content      => trim($c->param('content') // ''),
        x            => int($c->param('x') // 2500),
        y            => int($c->param('y') // 2500),
        width        => int($c->param('width') // 280),
        height       => int($c->param('height') // 200),
        color        => $c->param('color') // '#fef3c7',
        z_index             => int($c->param('z_index') // 1),
        is_collapsed        => int($c->param('is_collapsed') // 0),
        is_options_expanded => int($c->param('is_options_expanded') // 0)
    };

    $id = $c->db->save_note($params);

    $c->render(json => {
        success   => 1,
        id        => int($id),
        canvas_id => int($canvas_id),
        notes     => $c->db->get_user_notes($user_id, $canvas_id)
    });
}

# Permanently removes a note record.
# Route: POST /notes/api/delete
# Parameters: id, canvas_id
sub api_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $id        = $c->param('id');
    my $canvas_id = $c->param('canvas_id') // 1;
    my $user_id   = $c->current_user_id();

    $c->db->delete_note($id, $user_id);

    $c->render(json => {
        success => 1,
        notes   => $c->db->get_user_notes($user_id, $canvas_id)
    });
}

# Persists the user's viewport scale and scroll position.
# Route: POST /notes/api/viewport
# Parameters: canvas_id, scale, scroll_x, scroll_y
sub api_save_viewport {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $canvas_id = $c->param('canvas_id') // 1;
    my $scale     = $c->param('scale')    // 1;
    my $centerX   = $c->param('scroll_x') // 2500; # Canonical X Center
    my $centerY   = $c->param('scroll_y') // 2500; # Canonical Y Center

    # Clamp scale to safe rendering bounds (Synchronized with notes.js:SCALE_MIN)
    $scale = 0.1  if $scale < 0.1;
    $scale = 3.00 if $scale > 3.00;

    # Persist Canonical Perspective (X, Y as floats for stable restoration)
    $c->db->save_viewport($user_id, $canvas_id, $scale, $centerX, $centerY);

    $c->render(json => { success => 1 });
}

# Processes a multipart image upload for a sticky note.
# Route: POST /notes/api/upload
# Parameters: note_id (Optional), file|image (Binary), x, y, canvas_id, title
sub api_upload {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id   = $c->current_user_id();
    my $note_id   = $c->param('note_id');
    my $upload    = $c->param('file') // $c->param('image'); # Alias support
    my $canvas_id = $c->param('canvas_id') // 1;
    
    # Image handling: Drafting Canvas Mode
    # If the Host Note has not been established (direct drag-and-drop), generate it now.
    # Primary Path: showCreateNoteModal (JS) -> api_save (ID) -> api_upload (ID).
    if (!$note_id && $upload) {
        $note_id = $c->db->save_note({
            user_id      => $user_id,
            canvas_id    => $canvas_id,
            type         => 'image',
            title        => $c->param('title') // $upload->filename,
            content      => $upload->filename,
            x            => $c->param('x') // 0,
            y            => $c->param('y') // 0,
            width        => 400, # Initial scale
            height       => 400,
            color        => '#ffffff',
            z_index             => $c->param('z_index') // 1,
            is_collapsed        => 0,
            is_options_expanded => int($c->param('is_options_expanded') // 0)
        });
    }

    unless ($upload && $note_id) {
        return $c->render(json => { success => 0, error => "Missing file or note_id" });
    }

    my $file_data = $upload->asset->slurp;
    my $mime_type = $upload->headers->content_type || 'image/png';
    my $file_size = $upload->size;

    # Ownership Verification: Ensures an active user is the record's primary anchor
    if ($c->param('note_id')) {
        unless ($c->db->check_note_ownership($note_id, $user_id)) {
            return $c->render(json => { success => 0, error => "Unauthorized note access" });
        }
    }

    $c->db->store_note_blob($note_id, $file_data, $mime_type, $file_size);

    $c->render(json => {
        success => 1,
        note_id => int($note_id),
        notes   => $c->db->get_user_notes($user_id, $canvas_id) # Refresh state for immediate UI sync
    });
}

# Serves raw binary content for an image note.
# Route: GET /notes/serve/:note_id
sub serve_blob {
    my $c = shift;
    return $c->render(text => 'Unauthorized', status => 403) unless $c->is_logged_in;

    my $note_id = $c->stash('note_id');
    my $user_id = $c->current_user_id();
    
    # Privacy Check: Verify record ownership before serving binary stream
    unless ($c->db->check_note_ownership($note_id, $user_id)) {
        return $c->render(text => 'Unauthorized or Not found', status => 403);
    }

    my $blob = $c->db->get_note_blob($note_id);
    return $c->render(text => 'Blob not found', status => 404) unless $blob;

    $c->res->headers->content_type($blob->{mime_type});
    $c->render(data => $blob->{file_data});
}

1;
