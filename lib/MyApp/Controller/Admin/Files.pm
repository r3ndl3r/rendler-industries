# /lib/MyApp/Controller/Admin/Files.pm

package MyApp::Controller::Admin::Files;
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
# Route: GET /admin/files
# Parameters: None
# Returns: Rendered HTML template 'files'.
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_admin;
    $c->render('admin/files', is_admin => 1);
}

# Returns the consolidated state for the file vault.
# Route: GET /admin/files/api/state
# Returns: JSON object { success, files, users, is_admin }
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => "Unauthorized" }, status => 403) unless $c->is_admin;
    
    my $username = $c->session('user');
    my $is_admin = $c->is_admin;
    
    my $files = $c->db->get_all_files_metadata($username, $is_admin);
    my $users = $c->db->get_all_users;
    
    return $c->render(json => { 
        success  => 1, 
        files    => $files,
        users    => $users,
        is_admin => $is_admin ? 1 : 0
    });
}

# Processes a new binary upload via AJAX.
# Route: POST /admin/files/api/upload
# Parameters:
#   file          : The multipart binary object (max 1GB)
#   description   : Optional context string (String)
#   admin_only    : Restriction flag (Boolean)
#   allowed_users : Whitelisted user IDs (ArrayRef[Int])
# Returns: JSON object { success, message }
sub api_upload {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    
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
    
    # Process ACL user IDs
    my $admin_only = $c->param('admin_only') ? 1 : 0;
    my $description = trim($c->param('description') || '');

    my @allowed_user_ids = $c->every_param('allowed_users[]');
    @allowed_user_ids = map { ref($_) eq 'ARRAY' ? @$_ : $_ } @allowed_user_ids;
    @allowed_user_ids = grep { defined $_ && $_ =~ /^\d+$/ } @allowed_user_ids;

    my $username = $c->session('user');

    # Persist to vault
    my $file_id = eval {
        $c->db->store_file(
            $safe_filename, $original_filename, $mime_type, $file_size,
            $file_data, $username, $admin_only, $description
        );
    };
    if (my $err = $@) {
        $c->app->log->error("Vault storage failure: $err");
        return $c->render(json => { success => 0, error => 'Database integrity error' });
    }

    if (@allowed_user_ids) {
        eval { $c->db->sync_file_acls($file_id, \@allowed_user_ids); };
    }

    $c->app->log->info("File stored: $original_filename ($file_size bytes) by $username");
    return $c->render(json => { success => 1, message => "File uploaded successfully." });
}

# Serves binary content with appropriate streaming headers.
# Route: GET /admin/files/serve/:id
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
    
    # Access Control: Admin always; non-admin checked via file_acls junction table
    my $has_access = 0;
    my $current_user = $c->session('user') // '';

    if ($c->is_admin) {
        $has_access = 1;
    } elsif ($file->{admin_only}) {
        $has_access = 0;
    } else {
        my $current_user_id = $c->session('user_id');
        $has_access = $c->db->file_is_accessible_by($id, $current_user_id);
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
# Route: POST /admin/files/api/delete/:id
# Parameters:
#   id : Unique File ID (Integer)
# Returns: JSON object { success, message }
sub api_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
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
# Route: POST /admin/files/api/permissions/:id
# Parameters:
#   id            : Unique File ID (Integer)
#   admin_only    : Restriction flag (Boolean)
#   allowed_users : Whitelisted user IDs (ArrayRef[Int])
# Returns: JSON object { success, message }
sub api_permissions {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    my $id = $c->param('id');

    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => 'Invalid resource ID' });
    }

    my $admin_only = $c->param('admin_only') ? 1 : 0;
    my @allowed_user_ids = $c->every_param('allowed_users[]');
    @allowed_user_ids = map { ref($_) eq 'ARRAY' ? @$_ : $_ } @allowed_user_ids;
    @allowed_user_ids = grep { defined $_ && $_ =~ /^\d+$/ } @allowed_user_ids;

    eval {
        $c->db->sync_file_acls($id, \@allowed_user_ids);
        $c->db->update_file_admin_only($id, $admin_only);
    };
    if ($@) {
        return $c->render(json => { success => 0, error => 'Failed to update ACL' });
    }

    return $c->render(json => { success => 1, message => 'Access permissions synchronized.' });
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{r}->get('/files/serve/:id')->to('admin-files#serve');
    $r->{admin}->get('/admin/files')->to('admin-files#index');
    $r->{admin}->get('/admin/files/api/state')->to('admin-files#api_state');
    $r->{admin}->post('/admin/files/api/upload')->to('admin-files#api_upload');
    $r->{admin}->post('/admin/files/api/delete/:id')->to('admin-files#api_delete');
    $r->{admin}->post('/admin/files/api/permissions/:id')->to('admin-files#api_permissions');
}

1;
