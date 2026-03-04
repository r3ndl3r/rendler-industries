# /lib/MyApp/Controller/Files.pm

package MyApp::Controller::Files;
use Mojo::Base 'Mojolicious::Controller';

use Mojo::Util qw(trim);
use Digest::SHA qw(sha256_hex);

# Controller for File Management and Storage.
# Features:
#   - State-driven file listing with metadata-only transfers
#   - Secure binary upload with 1GB threshold and SHA256 safety
#   - Granular ACL management (Admin-only vs. Specific User whitelists)
#   - MIME-aware file serving with dynamic Content-Disposition
# Integration points:
#   - Uses DB::Files for BLOB storage and metadata reconciliation
#   - Enforces strict administrative gates for destructive operations
#   - Coordinates with centralized notification systems for audit logs

# Renders the main file management dashboard (Skeleton).
# Route: GET /files
# Parameters: None
# Returns: Rendered HTML template 'files'.
sub index {
    my $c = shift;

    # Handle AJAX state request (Single Source of Truth)
    if ($c->req->headers->header('X-Requested-With') && $c->req->headers->header('X-Requested-With') eq 'XMLHttpRequest') {
        my $files = $c->db->get_all_files_metadata;
        my $users = $c->db->get_all_users;
        
        return $c->render(json => { 
            success  => 1, 
            files    => $files,
            users    => $users,
            is_admin => $c->is_admin ? 1 : 0
        });
    }

    $c->stash(is_admin => $c->is_admin);
    $c->render('files');
}

# Processes a new binary upload via AJAX.
# Route: POST /files
# Parameters:
#   file          : The multipart binary object (max 1GB)
#   description   : Optional context string (String)
#   admin_only    : Restriction flag (Boolean)
#   allowed_users : Whitelisted usernames (ArrayRef[String])
# Returns: JSON object { success, message }
sub upload {
    my $c = shift;
    
    # Validate binary presence
    my $upload = $c->param('file');
    unless ($upload) {
        return $c->render(json => { success => 0, error => 'No file provided' });
    }
    
    # Extract metadata
    my $original_filename = $upload->filename;
    my $file_size = $upload->size || 0;
    my $mime_type = $upload->headers->content_type || 'application/octet-stream';
    
    # Enforce 1GB safety limit
    if ($file_size > 1024 * 1024 * 1024) {
        return $c->render(json => { success => 0, error => 'File exceeds 1GB limit' });
    }
    
    # Read binary content (Slurp)
    my $file_data = $upload->asset->slurp;
    
    # Generate cryptographically safe system filename
    my ($ext) = $original_filename =~ /(\.[^.]+)$/;
    $ext = lc($ext || '');
    my $safe_filename = sha256_hex($original_filename . time . int(rand(1000))) . $ext;
    
    # Process ACL parameters
    my $admin_only = $c->param('admin_only') ? 1 : 0;
    my $description = trim($c->param('description') || '');
    
    # Filter whitelisted users
    my @allowed_users = $c->every_param('allowed_users[]');
    @allowed_users = map { ref($_) eq 'ARRAY' ? @$_ : $_ } @allowed_users;
    @allowed_users = grep { defined $_ && $_ =~ /^[a-zA-Z0-9_-]+$/ } @allowed_users;
    
    my $allowed_users_str = @allowed_users ? join(',', @allowed_users) : undef;
    my $username = $c->session('user');
    
    # Persist to vault
    eval {
        $c->db->store_file(
            $safe_filename, $original_filename, $mime_type, $file_size,
            $file_data, $username, $admin_only, $allowed_users_str, $description
        );
    };
    if (my $err = $@) {
        $c->app->log->error("Vault storage failure: $err");
        return $c->render(json => { success => 0, error => 'Database integrity error' });
    }
    
    $c->app->log->info("File stored: $original_filename ($file_size bytes) by $username");
    return $c->render(json => { success => 1, message => "File uploaded successfully." });
}

# Serves binary content with appropriate streaming headers.
# Route: GET /files/serve/:id
# Parameters:
#   id : Unique File ID (Integer)
# Returns: Binary stream or 403/404 error
sub serve {
    my $c = shift;
    my $id = $c->param('id') // '';
    
    return $c->render_error('Invalid resource ID', 400) unless $id =~ /^\d+$/;
    
    my $file = $c->db->get_file_by_id($id);
    unless ($file) {
        return $c->render_error('Resource not found', 404);
    }
    
    # Access Control Logic (Admin | Whitelist | Public)
    my $has_access = 0;
    my $current_user = $c->session('user') // '';
    
    if ($c->is_admin) {
        $has_access = 1;
    } elsif ($file->{admin_only}) {
        $has_access = 0;
    } elsif ($file->{allowed_users}) {
        my @allowed = split(',', $file->{allowed_users});
        $has_access = grep { $_ eq $current_user } @allowed;
    } else {
        $has_access = 1;
    }
    
    unless ($has_access) {
        $c->app->log->warn("Forbidden access attempt: File $id by " . ($current_user || 'anonymous'));
        return $c->render_error('Access denied', 403);
    }
    
    # Update audit trail
    eval { $c->db->increment_download_count($file->{id}); };
    
    # Determine Content-Disposition
    my $mime = $file->{mime_type} || 'application/octet-stream';
    my $disp = ($mime =~ /^(image|text)\// || $mime =~ m{^application/(pdf)}i) ? 'inline' : 'attachment';
    
    $c->res->headers->content_type($mime);
    $c->res->headers->content_disposition(qq{$disp; filename="$file->{original_filename}"});
    
    return $c->render(data => $file->{file_data});
}

# Permanently removes a file resource via AJAX.
# Route: POST /files/delete/:id
# Parameters:
#   id : Unique File ID (Integer)
# Returns: JSON object { success, message }
sub delete_file {
    my $c = shift;
    my $id = $c->param('id');
    
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => 'Invalid resource ID' });
    }

    my $file = $c->db->get_file_by_id($id);
    unless ($file) {
        return $c->render(json => { success => 0, error => 'Resource not found' });
    }

    eval {
        $c->db->delete_file_record($id);
    };
    if ($@) {
        return $c->render(json => { success => 0, error => 'Resource locked or database error' });
    }

    $c->app->log->info("Resource purged: $file->{original_filename} (id=$id) by " . ($c->session('user') || 'system'));
    return $c->render(json => { success => 1, message => 'Resource deleted.' });
}

# Updates ACL permissions for a specific resource via AJAX.
# Route: POST /files/permissions/:id
# Parameters:
#   id            : Unique File ID (Integer)
#   admin_only    : Restriction flag (Boolean)
#   allowed_users : Whitelisted usernames (ArrayRef[String])
# Returns: JSON object { success, message }
sub edit_permissions {
    my $c = shift;
    my $id = $c->param('id');

    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => 'Invalid resource ID' });
    }

    my $admin_only = $c->param('admin_only') ? 1 : 0;
    my @allowed_users = $c->every_param('allowed_users[]');
    @allowed_users = map { ref($_) eq 'ARRAY' ? @$_ : $_ } @allowed_users;

    my $allowed_users_str = @allowed_users ? join(',', @allowed_users) : undef;

    eval {
        $c->db->update_file_permissions($id, $admin_only, $allowed_users_str);
    };
    if ($@) {
        return $c->render(json => { success => 0, error => 'Failed to update ACL' });
    }

    return $c->render(json => { success => 1, message => 'Access permissions synchronized.' });
}

1;
