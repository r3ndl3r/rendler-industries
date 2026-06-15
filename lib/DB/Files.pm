# /lib/DB/Files.pm

package DB::Files;

use strict;
use warnings;
use DBI qw(:sql_types);

# Database helper for binary file storage and management.
# Features:
#   - BLOB storage for arbitrary file types
#   - Metadata retrieval (excluding heavy BLOB data for lists)
#   - Permission management via file_acls junction table (user_id-based)
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
#   description       : Optional text description
# Returns:
#   Integer ID of the newly inserted record
sub DB::store_file {
    my ($self, $filename, $original_filename, $mime_type, $file_size, $file_data, $uploaded_by, $admin_only, $description) = @_;

    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "INSERT INTO files (filename, original_filename, mime_type, file_size, file_data, uploaded_by, admin_only, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );

    $sth->bind_param(1, $filename);
    $sth->bind_param(2, $original_filename);
    $sth->bind_param(3, $mime_type);
    $sth->bind_param(4, $file_size);
    $sth->bind_param(5, $file_data, SQL_BLOB);
    $sth->bind_param(6, $uploaded_by);
    $sth->bind_param(7, $admin_only);
    $sth->bind_param(8, $description);

    $sth->execute();

    return $self->{dbh}->last_insert_id(undef, undef, 'files', 'id');
}

# Retrieves metadata for files based on user access levels.
# Parameters:
#   username : Current user identifier
#   is_admin : Boolean flag (1/0)
#   user_id  : Current user ID (optional, required for non-admin access filtering)
# Returns:
#   ArrayRef of HashRefs containing accessible file details (excluding binary content)
sub DB::get_all_files_metadata {
    my ($self, $username, $is_admin, $user_id) = @_;

    $self->ensure_connection;

    my $sql = "SELECT f.id, f.filename, f.original_filename, f.mime_type, f.file_size, f.uploaded_by,
               DATE_FORMAT(f.uploaded_at, '%d-%m-%Y %h:%i %p') AS uploaded_at,
               f.admin_only, f.description, f.download_count,
               (SELECT GROUP_CONCAT(fa.user_id ORDER BY fa.user_id)
                FROM file_acls fa
                WHERE fa.file_id = f.id) AS allowed_user_ids
               FROM files f";

    my @params;
    unless ($is_admin) {
        $sql .= " WHERE f.admin_only = 0
                  AND (f.uploaded_by = ?
                       OR EXISTS (SELECT 1 FROM file_acls fa2 WHERE fa2.file_id = f.id AND fa2.user_id = ?)
                       OR NOT EXISTS (SELECT 1 FROM file_acls fa3 WHERE fa3.file_id = f.id))";
        push @params, $username, $user_id;
    }

    $sql .= " ORDER BY f.id DESC";

    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(@params);

    return $sth->fetchall_arrayref({});
}

# Permanently removes a file record. file_acls cleaned up via ON DELETE CASCADE.
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

# Updates download statistics for a file.
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

# Updates the admin_only flag for a file.
# Parameters:
#   id         : Unique ID of the file
#   admin_only : Boolean flag (1/0)
# Returns:
#   Result of execute() (true on success)
sub DB::update_file_admin_only {
    my ($self, $id, $admin_only) = @_;

    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("UPDATE files SET admin_only = ? WHERE id = ?");
    $sth->execute($admin_only, $id);
}

# Synchronizes ACL entries for a file by replacing all existing entries with the given user IDs.
# Parameters:
#   id       : Unique ID of the file
#   user_ids : ArrayRef of user IDs (integers)
# Returns:
#   True on success
sub DB::sync_file_acls {
    my ($self, $id, $user_ids) = @_;

    $self->ensure_connection;
    my $dbh = $self->{dbh};

    my $autocommit = $dbh->{AutoCommit};
    $dbh->begin_work unless !$autocommit;

    eval {
        $dbh->do("DELETE FROM file_acls WHERE file_id = ?", undef, $id);

        if ($user_ids && @$user_ids) {
            my $sth = $dbh->prepare("INSERT INTO file_acls (file_id, user_id) VALUES (?, ?)");
            foreach my $uid (@$user_ids) {
                next unless defined $uid && $uid =~ /^\d+$/;
                $sth->execute($id, $uid);
            }
        }

        $dbh->commit unless !$autocommit;
        1;
    } or do {
        my $err = $@ || 'Unknown error';
        $dbh->rollback unless !$autocommit;
        die $err;
    };
}

# Checks whether a file is accessible by a specific user.
# Returns 1 if the file has no ACL entries (public), or if the user is in the ACL.
# Returns 0 if ACL entries exist but the user is not among them (or user_id is undef).
# Parameters:
#   file_id : Unique ID of the file
#   user_id : ID of the user to check (may be undef for anonymous)
# Returns:
#   1 if accessible, 0 otherwise
sub DB::file_is_accessible_by {
    my ($self, $file_id, $user_id) = @_;

    $self->ensure_connection;

    my ($acl_count) = $self->{dbh}->selectrow_array(
        "SELECT COUNT(*) FROM file_acls WHERE file_id = ?",
        undef, $file_id
    );
    return 1 unless $acl_count;

    return 0 unless $user_id;
    my ($found) = $self->{dbh}->selectrow_array(
        "SELECT 1 FROM file_acls WHERE file_id = ? AND user_id = ?",
        undef, $file_id, $user_id
    );
    return $found ? 1 : 0;
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
