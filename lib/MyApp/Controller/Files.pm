# /lib/MyApp/Controller/Files.pm

package MyApp::Controller::Files;
use Mojo::Base 'Mojolicious::Controller';

use Mojo::Util qw(trim);
use Digest::SHA qw(sha256_hex);

# Controller for File Management and Storage.
# Features:
#   - Secure file upload with size limits and safe naming
#   - Role-based access control (Admin-only, specific users, or public)
#   - Safe file serving with correct MIME types and disposition
# Integration points:
#   - Uses DB::Files for BLOB storage and metadata
#   - Enforces strict Admin permissions for uploads/deletions
#   - Tracks download statistics

# Renders the file list dashboard.
# Route: GET /files
# Parameters: None
# Returns:
#   Rendered HTML template 'files/files' with file metadata and user list
sub index {
    my $c = shift;
    
    # Fetch metadata for display (BLOB data is excluded for performance)
    my $files = $c->db->get_all_files_metadata;
    my $users = $c->db->get_all_users;
    
    $c->render('files/files');
}

# Renders the file upload form.
# Route: GET /files/upload
# Parameters: None
# Returns:
#   Rendered HTML template 'files/upload'
#   Redirect to 'noperm' if not Admin
sub upload_form {
    my $c = shift;
    
    # Fetch users for the permission selector
    my $users = $c->db->get_all_users;
    $c->stash(users => $users);
    $c->render('files/upload');
}

# Processes a new file upload.
# Route: POST /files/upload
# Parameters:
#   file          : The file upload object (max 1GB)
#   description   : Optional text description
#   admin_only    : Flag to restrict access to admins (1/0)
#   allowed_users : List of usernames allowed to access the file
# Returns:
#   Redirects to file list on success
#   Renders error on validation failure or DB error
sub upload {
    my $c = shift;
    
    # Validate file presence
    my $upload = $c->param('file');
    unless ($upload) {
        return $c->render_error('No file uploaded');
    }
    
    # Extract file metadata
    my $original_filename = $upload->filename;
    my $file_size = $upload->size || 0;
    my $mime_type = $upload->headers->content_type || 'application/octet-stream';
    
    # Enforce file size limit (1GB)
    if ($file_size > 1024 * 1024 * 1024) {
        return $c->render_error('File too large (max 1GB)');
    }
    
    # Read file content into memory (Slurp)
    my $file_data = $upload->asset->slurp;
    
    # Generate a cryptographically safe system filename
    my $timestamp = time;
    my $random = int(rand(1000000));
    my ($ext) = $original_filename =~ /(\.[^.]+)$/;
    $ext = lc($ext || '');
    my $safe_filename = sha256_hex($original_filename . $timestamp . $random) . $ext;
    
    # Process optional parameters
    my $admin_only = $c->param('admin_only') ? 1 : 0;
    my $description = trim($c->param('description') || '');
    
    # Filter and validate allowed usernames to prevent injection or empty strings
    my @allowed_users = $c->every_param('allowed_users');
    @allowed_users = grep { defined $_ && length($_) > 0 && $_ =~ /^[a-zA-Z0-9_-]+$/ } @allowed_users;
    
    # Convert list to CSV string for storage (or undef if empty)
    my $allowed_users_str;
    if (@allowed_users) {
        $allowed_users_str = join(',', @allowed_users);
    } else {
        $allowed_users_str = undef; 
    }
    
    my $username = $c->session('user');
    
    # Persist file to database
    eval {
        $c->db->store_file(
            $safe_filename, $original_filename, $mime_type, $file_size,
            $file_data, $username, $admin_only, $allowed_users_str, $description
        );
    };
    if (my $err = $@) {
        $c->app->log->error("Failed to store file: $err");
        return $c->render_error('Error uploading file', 500);
    }
    
    $c->app->log->info("File uploaded: $original_filename ($file_size bytes) by $username");
    $c->flash(message => "File '$original_filename' uploaded successfully");
    return $c->redirect_to('/files');
}

# Serves the file content to the user.
# Route: GET /files/serve/:id
# Parameters:
#   id : Unique File ID
# Returns:
#   Binary file content with appropriate Content-Type and Disposition headers
#   Renders 403/404 on permission failure or missing file
sub serve {
    my $c = shift;
    
    # Validate File ID
    my $id = $c->param('id') // '';
    return $c->render_error('File ID not specified', 400) unless $id;
    return $c->render_error('Invalid file ID', 400) unless $id =~ /^\d+$/;
    
    # Retrieve file record
    my $file = $c->db->get_file_by_id($id);
    unless ($file) {
        return $c->render_error('File not found', 404);
    }
    
    # Determine Access Control Logic
    my $has_access = 0;
    my $current_user = $c->session('user') // '';
    
    if ($c->is_admin) {
        # Admins have global access
        $has_access = 1;
    }
    elsif ($file->{admin_only}) {
        # Restricted to admins only
        $has_access = 0;
    }
    elsif ($file->{allowed_users}) {
        # Check against allow-list
        my @allowed = split(',', $file->{allowed_users});
        $has_access = grep { $_ eq $current_user } @allowed;
    }
    else {
        # Public file
        $has_access = 1;
    }
    
    # Enforce Access Decision
    unless ($has_access) {
        $c->app->log->warn(
            "Unauthorized file access attempt: ID $id by " . ($current_user || 'anonymous')
        );
        return $c->render_error('Access denied', 403);
    }
    
    # Update usage statistics
    eval { $c->db->increment_download_count($file->{id}); };
    
    # Determine Content-Disposition (Inline vs Attachment)
    my $mime = $file->{mime_type} || 'application/octet-stream';
    my $disp = 'inline';
    
    # Force download for non-browser-safe types
    if ($mime !~ /^(image|text)\// && $mime !~ m{^application/(pdf)}i) {
        $disp = 'attachment';
    }
    
    # Serve content
    $c->res->headers->content_type($mime);
    $c->res->headers->content_disposition(
        qq{$disp; filename="$file->{original_filename}"}
    );
    
    return $c->render(data => $file->{file_data});
}

# Permanently deletes a file.
# Route: POST /files/delete
# Parameters:
#   id : Unique File ID
# Returns:
#   Redirects to file list on success
sub delete_file {
    my $c = shift;

    # Validate ID
    my $id = $c->param('id');
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render_error('Invalid file ID');
    }

    # Verify existence
    my $file = $c->db->get_file_by_id($id);
    unless ($file) {
        return $c->render_error('File not found', 404);
    }

    # Execute deletion
    $c->db->delete_file_record($id);

    my $username = $c->session('user') // '';
    $c->app->log->info("File deleted: $file->{original_filename} (id=$id) by $username");

    $c->flash(message => 'File deleted successfully');
    return $c->redirect_to('/files');
}

# Updates access permissions for an existing file.
# Route: POST /files/permissions
# Parameters:
#   id            : Unique File ID
#   admin_only    : Flag to restrict access (1/0)
#   allowed_users : List of allowed usernames
# Returns:
#   Redirects to file list on success
sub edit_permissions {
    my $c = shift;

    # Validate ID
    my $id = $c->param('id');
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render_error('Invalid file ID');
    }

    # Verify existence
    my $file = $c->db->get_file_by_id($id);
    unless ($file) {
        return $c->render_error('File not found', 404);
    }

    # Process permissions
    my $admin_only = $c->param('admin_only') ? 1 : 0;
    my @allowed_users = $c->every_param('allowed_users');
    my $allowed_users_str = @allowed_users ? join(',', @allowed_users) : undef;

    # Update record
    $c->db->update_file_permissions($id, $admin_only, $allowed_users_str);

    $c->flash(message => 'Permissions updated successfully');
    return $c->redirect_to('/files');
}

1;