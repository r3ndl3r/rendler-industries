# /lib/DB/Files.pm

package DB::Files;

use strict;
use warnings;
use DBI qw(:sql_types);

# Database helper for binary file storage and management.
# Features:
#   - BLOB storage for arbitrary file types
#   - Metadata retrieval (excluding heavy BLOB data for lists)
#   - Permission management (admin-only, specific users)
#   - Usage tracking (download counts)
# Integration points:
#   - Extends DB package via package injection
#   - Requires DBI SQL_BLOB constants for proper binary handling

# Stores a new file and its metadata in the database.
# Parameters:
#   filename          : Unique system filename
#   original_filename : Original name uploaded by user
#   mime_type         : MIME type string
#   file_size         : Size in bytes
#   file_data         : Binary content (BLOB)
#   uploaded_by       : Username of uploader
#   admin_only        : Boolean flag (1/0)
#   allowed_users     : Comma-separated list of allowed users (or undef)
#   description       : Optional text description
# Returns:
#   Integer ID of the newly inserted record
sub DB::store_file {
    my ($self, $filename, $original_filename, $mime_type, $file_size, $file_data, $uploaded_by, $admin_only, $allowed_users, $description) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare(
        "INSERT INTO files (filename, original_filename, mime_type, file_size, file_data, uploaded_by, admin_only, allowed_users, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    
    # Explicitly bind parameters to ensure BLOB data is handled correctly by the driver
    $sth->bind_param(1, $filename);
    $sth->bind_param(2, $original_filename);
    $sth->bind_param(3, $mime_type);
    $sth->bind_param(4, $file_size);
    $sth->bind_param(5, $file_data, SQL_BLOB);
    $sth->bind_param(6, $uploaded_by);
    $sth->bind_param(7, $admin_only);
    $sth->bind_param(8, $allowed_users);
    $sth->bind_param(9, $description);
    
    $sth->execute();
    
    # Return the auto-generated ID
    return $self->{dbh}->last_insert_id(undef, undef, 'files', 'id');
}

# Retrieves full file record by system filename.
# Parameters:
#   filename : System identifier
# Returns:
#   HashRef containing all fields including binary data, or undef if not found
sub DB::get_file_by_filename {
    my ($self, $filename) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT * FROM files WHERE filename = ?");
    $sth->execute($filename);
    
    return $sth->fetchrow_hashref();
}

# Retrieves metadata for all files.
# Parameters: None
# Returns:
#   ArrayRef of HashRefs containing file details (excluding binary content)
sub DB::get_all_files_metadata {
    my ($self) = @_;
    
    $self->ensure_connection;
    
    # Fetch lightweight columns only; exclude 'file_data' BLOB for performance
    my $sth = $self->{dbh}->prepare(
        "SELECT id, filename, original_filename, mime_type, file_size, uploaded_by, uploaded_at, admin_only, allowed_users, description, download_count
        FROM files ORDER BY uploaded_at DESC"
    );
    
    $sth->execute();
    
    return $sth->fetchall_arrayref({});
}

# Permanently removes a file record.
# Parameters:
#   id : Unique ID of the file
# Returns:
#   Result of execute() (true on success)
sub DB::delete_file_record {
    my ($self, $id) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("DELETE FROM files WHERE id = ?");
    $sth->execute($id);
}

# Updates the download statistics for a file.
# Parameters:
#   id : Unique ID of the file
# Returns:
#   Result of execute() (true on success)
sub DB::increment_download_count {
    my ($self, $id) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("UPDATE files SET download_count = download_count + 1 WHERE id = ?");
    $sth->execute($id);
}

# Updates access control settings for a file.
# Parameters:
#   id            : Unique ID of the file
#   admin_only    : Boolean flag (1/0)
#   allowed_users : Comma-separated string of users, or undef
# Returns:
#   Result of execute() (true on success)
sub DB::update_file_permissions {
    my ($self, $id, $admin_only, $allowed_users) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("UPDATE files SET admin_only = ?, allowed_users = ? WHERE id = ?");
    $sth->execute($admin_only, $allowed_users, $id);
}

# Retrieves full file record by ID.
# Parameters:
#   id : Unique ID of the file
# Returns:
#   HashRef containing all fields including binary data, or undef if not found
sub DB::get_file_by_id {
    my ($self, $id) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT * FROM files WHERE id = ?");
    $sth->execute($id);
    
    return $sth->fetchrow_hashref();
}

1;