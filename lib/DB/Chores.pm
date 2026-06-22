# /lib/DB/Chores.pm

package DB::Chores;

use strict;
use warnings;
use DBI qw(:sql_types);

# DB Helper module managing Chores / Bounty Board.

# Retrieves active global chores and chores targeted specifically to a user.
# Parameters:
#   $self    : DB Instance
#   $user_id : User ID requesting the list
#   $is_admin: Boolean (true to return all active chores)
# Returns:
#   ArrayRef of chore hashes.
sub DB::get_active_chores {
    my ($self, $user_id, $is_admin) = @_;
    $self->ensure_connection();

    my $query = "SELECT c.id, c.title, c.points, c.assigned_to, u.username as assigned_username, u.emoji as assigned_emoji, c.created_at
                 FROM chores c
                 LEFT JOIN users u ON c.assigned_to = u.id
                 WHERE c.status = 'active'";
    my @bind;
    
    unless ($is_admin) {
        $query .= " AND (c.assigned_to IS NULL OR c.assigned_to = ?)";
        push @bind, $user_id;
    }
    
    $query .= " ORDER BY c.created_at DESC";

    my $sth = $self->{dbh}->prepare($query);
    $sth->execute(@bind);
    
    my @chores;
    while (my $row = $sth->fetchrow_hashref()) {
        push @chores, $row;
    }
    return \@chores;
}

# Processes an atomic claim on a chore to prevent double-dipping and enforce targeting.
# Parameters:
#   $self     : DB Instance
#   $chore_id    : Target Chore ID
#   $user_id     : User ID claiming the chore
#   $completed_at: Formatted timestamp string (Y-m-d H:M:S)
# Returns:
#   Boolean true if claim was successful, false if already claimed/missing.
sub DB::claim_chore {
    my ($self, $chore_id, $user_id, $completed_at) = @_;
    $self->ensure_connection();

    my $sth = $self->{dbh}->prepare(
        "UPDATE chores 
         SET status = 'completed', 
             completed_by = ?, 
             completed_at = ? 
         WHERE id = ? AND status = 'active' AND (assigned_to IS NULL OR assigned_to = ?)"
    );
    my $rows_affected = $sth->execute($user_id, $completed_at, $chore_id, $user_id);
    
    # 0 = failed to claim (someone else got it first, or it doesn't exist)
    return $rows_affected == 1 ? 1 : 0;
}

# Adds a new chore to the board.
# Parameters:
#   $self   : DB Instance
#   $title  : String label
#   $points : Integer reward
#   $assigned_to : Optional strict target (User ID or undef)
# Returns:
#   Integer (new row ID)
sub DB::add_chore {
    my ($self, $title, $points, $assigned_to) = @_;
    $self->ensure_connection();

    # Normalize assigned_to: if it's 0 or empty string, force to NULL
    $assigned_to = undef unless defined $assigned_to && $assigned_to =~ /^\d+$/ && $assigned_to > 0;

    my $sth = $self->{dbh}->prepare(
        "INSERT INTO chores (title, points, assigned_to) VALUES (?, ?, ?)"
    );
    $sth->execute($title, $points, $assigned_to);
    return $self->{dbh}->last_insert_id(undef, undef, 'chores', undef);
}

# Retrieves recently created distinct chores for the Admin Quick-Add panel.
# Returns: ArrayRef
sub DB::get_recent_chore_templates {
    my ($self) = @_;
    $self->ensure_connection();

    # Groups by title returning their general point values and assignment context
    my $sth = $self->{dbh}->prepare(
        "SELECT c.title, c.points, c.assigned_to, u.username as assigned_username, u.emoji as assigned_emoji
         FROM chores c
         LEFT JOIN users u ON c.assigned_to = u.id
         WHERE c.id IN (SELECT MAX(id) FROM chores GROUP BY title)
         ORDER BY c.id DESC
         LIMIT 12"
    );
    $sth->execute();
    
    my @templates;
    while (my $row = $sth->fetchrow_hashref()) {
        push @templates, $row;
    }
    return \@templates;
}

# Retrieves recent completed chores (History) for Admin audits.
# Returns: ArrayRef
sub DB::get_completed_chores_history {
    my ($self) = @_;
    $self->ensure_connection();

    my $sth = $self->{dbh}->prepare(
        "SELECT c.id, c.title, c.points, c.completed_at, u.username as completed_by_name, u.emoji as completed_by_emoji, CAST('chore' AS CHAR) as source
         FROM chores c
         LEFT JOIN users u ON c.completed_by = u.id
         WHERE c.status = 'completed'
         UNION ALL
         SELECT cs.id, cs.description as title, cs.points_awarded as points, cs.reviewed_at as completed_at, u.username as completed_by_name, u.emoji as completed_by_emoji, CAST('submission' AS CHAR) as source
         FROM chore_submissions cs
         JOIN users u ON cs.user_id = u.id
         WHERE cs.status = 'approved'
         ORDER BY completed_at DESC
         LIMIT 50"
    );
    $sth->execute();
    
    my @history;
    while (my $row = $sth->fetchrow_hashref()) {
        push @history, $row;
    }
    return \@history;
}

# Finds a specific chore by ID, including assigned/completer metadata for notifications.
sub DB::get_chore_by_id {
    my ($self, $chore_id) = @_;
    $self->ensure_connection();
    
    my $query = "SELECT c.*, 
                 u1.username as assigned_username, u1.emoji as assigned_emoji,
                 u2.username as completed_username, u2.emoji as completed_by_emoji
                 FROM chores c
                 LEFT JOIN users u1 ON c.assigned_to = u1.id
                 LEFT JOIN users u2 ON c.completed_by = u2.id
                 WHERE c.id = ?";
                 
    my $sth = $self->{dbh}->prepare($query);
    $sth->execute($chore_id);
    return $sth->fetchrow_hashref();
}

# Reverses a completion by throwing it back to 'active' pool and stripping the claimant.
sub DB::reset_chore {
    my ($self, $chore_id) = @_;
    $self->ensure_connection();
    
    my $sth = $self->{dbh}->prepare(
        "UPDATE chores 
         SET status = 'active', completed_by = NULL, completed_at = NULL 
         WHERE id = ?"
    );
    $sth->execute($chore_id);
    return 1;
}

# Permanently deletes a chore.
sub DB::delete_chore {
    my ($self, $chore_id) = @_;
    $self->ensure_connection();
    my $sth = $self->{dbh}->prepare("DELETE FROM chores WHERE id = ?");
    $sth->execute($chore_id);
    return 1;
}

# Inserts a new voluntary chore submission record.
# Parameters:
#   $self        : DB instance
#   $user_id     : Submitting child's user ID
#   $description : Text description of the chore performed
# Returns:
#   Integer new row ID
sub DB::add_chore_submission {
    my ($self, $user_id, $description) = @_;
    $self->ensure_connection();
    my $sth = $self->{dbh}->prepare(
        "INSERT INTO chore_submissions (user_id, description) VALUES (?, ?)"
    );
    $sth->execute($user_id, $description);
    return $self->{dbh}->last_insert_id(undef, undef, 'chore_submissions', undef);
}

# Stores a single photo blob attached to a submission.
# Parameters:
#   $self              : DB instance
#   $submission_id     : Parent submission ID
#   $photo_type        : 'before' or 'after'
#   $filename          : SHA-derived safe filename
#   $original_filename : Original upload filename
#   $mime_type         : MIME type string
#   $file_size         : Integer byte count
#   $file_data         : Binary blob
# Returns:
#   Boolean (execute result)
sub DB::add_chore_submission_photo {
    my ($self, $submission_id, $photo_type, $filename, $original_filename, $mime_type, $file_size, $file_data) = @_;
    $self->ensure_connection();
    my $sth = $self->{dbh}->prepare(
        "INSERT INTO chore_submission_photos
         (submission_id, photo_type, filename, original_filename, mime_type, file_size, file_data)
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    $sth->bind_param(1, $submission_id);
    $sth->bind_param(2, $photo_type);
    $sth->bind_param(3, $filename);
    $sth->bind_param(4, $original_filename);
    $sth->bind_param(5, $mime_type);
    $sth->bind_param(6, $file_size);
    $sth->bind_param(7, $file_data, DBI::SQL_BLOB);
    return $sth->execute();
}

# Retrieves a single photo record including binary data for serving.
# Parameters:
#   $self : DB instance
#   $id   : chore_submission_photos row ID
# Returns:
#   HashRef or undef
sub DB::get_chore_submission_photo_by_id {
    my ($self, $id) = @_;
    $self->ensure_connection();
    my $sth = $self->{dbh}->prepare("SELECT * FROM chore_submission_photos WHERE id = ?");
    $sth->execute($id);
    return $sth->fetchrow_hashref();
}

# Retrieves all pending submissions for admin review, joined with username and photo IDs.
# Returns:
#   ArrayRef of hashrefs with id, user_id, username, description, submitted_at,
#   before_photo_id, after_photo_id
sub DB::get_pending_chore_submissions {
    my ($self) = @_;
    $self->ensure_connection();
    my $sth = $self->{dbh}->prepare(
        "SELECT cs.id, cs.user_id, cs.description, cs.submitted_at, u.username,
                (SELECT id FROM chore_submission_photos WHERE submission_id = cs.id AND photo_type = 'before' LIMIT 1) AS before_photo_id,
                (SELECT id FROM chore_submission_photos WHERE submission_id = cs.id AND photo_type = 'after'  LIMIT 1) AS after_photo_id
         FROM chore_submissions cs
         JOIN users u ON cs.user_id = u.id
         WHERE cs.status = 'pending'
         ORDER BY cs.submitted_at ASC"
    );
    $sth->execute();
    return $sth->fetchall_arrayref({});
}

# Retrieves a single submission record with its photo IDs (not blobs).
# Parameters:
#   $self : DB instance
#   $id   : chore_submissions row ID
# Returns:
#   HashRef with submission columns joined with username
sub DB::get_chore_submission_by_id {
    my ($self, $id) = @_;
    $self->ensure_connection();
    my $sth = $self->{dbh}->prepare(
        "SELECT cs.*, u.username FROM chore_submissions cs
         JOIN users u ON cs.user_id = u.id
         WHERE cs.id = ?"
    );
    $sth->execute($id);
    return $sth->fetchrow_hashref();
}

# Marks a submission as approved and records points awarded and review timestamp.
# Parameters:
#   $self           : DB instance
#   $submission_id  : Row ID
#   $points_awarded : Integer points
# Returns:
#   1
sub DB::approve_chore_submission {
    my ($self, $submission_id, $points_awarded) = @_;
    $self->ensure_connection();
    my $sth = $self->{dbh}->prepare(
        "UPDATE chore_submissions
         SET status = 'approved', points_awarded = ?, reviewed_at = NOW()
         WHERE id = ?"
    );
    $sth->execute($points_awarded, $submission_id);
    return 1;
}


# Removes all photo blob rows for a submission from chore_submission_photos.
# Parameters:
#   $self          : DB instance
#   $submission_id : Parent submission ID
# Returns:
#   1
sub DB::purge_chore_submission_photos {
    my ($self, $submission_id) = @_;
    $self->ensure_connection();
    my $sth = $self->{dbh}->prepare("DELETE FROM chore_submission_photos WHERE submission_id = ?");
    $sth->execute($submission_id);
    return 1;
}

# Reverses an approved submission back to rejected status and clears awarded points.
# Returns rows affected, so callers can avoid duplicate revocation side effects.
sub DB::revoke_chore_submission {
    my ($self, $submission_id) = @_;
    $self->ensure_connection();
    my $sth = $self->{dbh}->prepare(
        "UPDATE chore_submissions
         SET status = 'rejected', points_awarded = NULL, reviewed_at = NULL
         WHERE id = ? AND status = 'approved'"
    );
    $sth->execute($submission_id);
    return $sth->rows;
}

# Deletes a submission record entirely (called after rejection).
# Parameters:
#   $self          : DB instance
#   $submission_id : Row ID
# Returns:
#   1
sub DB::delete_chore_submission {
    my ($self, $submission_id) = @_;
    $self->ensure_connection();
    my $sth = $self->{dbh}->prepare("DELETE FROM chore_submissions WHERE id = ?");
    $sth->execute($submission_id);
    return 1;
}

# Retrieves a child's pending submissions and approved submissions from the last 30 days.
# Parameters:
#   $self    : DB instance
#   $user_id : Child's user ID
# Returns:
#   ArrayRef of hashrefs (id, description, status, points_awarded, submitted_at)
sub DB::get_my_chore_submissions {
    my ($self, $user_id) = @_;
    $self->ensure_connection();
    my $sth = $self->{dbh}->prepare(
        "SELECT id, description, status, points_awarded, submitted_at
         FROM chore_submissions
         WHERE user_id = ?
           AND (status = 'pending' OR (status = 'approved' AND submitted_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)))
         ORDER BY submitted_at DESC
         LIMIT 20"
    );
    $sth->execute($user_id);
    return $sth->fetchall_arrayref({});
}

# Identifies chores older than 1 hour without a recent reminder. 
# Touches last_reminded_at for standard Mojo idempotency.
sub DB::get_stale_chores_and_mark {
    my $self = shift;
    $self->ensure_connection();

    my $sth = $self->{dbh}->prepare(
        "SELECT c.id, c.title, c.points, c.assigned_to, u.username as target_user, u.emoji as target_emoji
         FROM chores c
         LEFT JOIN users u ON c.assigned_to = u.id
         WHERE c.status = 'active'
           AND c.created_at <= (NOW() - INTERVAL 1 HOUR)
           AND (c.last_reminded_at IS NULL OR c.last_reminded_at <= (NOW() - INTERVAL 1 HOUR))"
    );
    $sth->execute();
    
    my @stale_chores;
    my @ids;
    while (my $row = $sth->fetchrow_hashref()) {
        push @stale_chores, $row;
        push @ids, $row->{id};
    }

    if (@ids) {
        my $placeholders = join(',', ('?') x @ids);
        my $upd = $self->{dbh}->prepare("UPDATE chores SET last_reminded_at = NOW() WHERE id IN ($placeholders)");
        $upd->execute(@ids);
    }
    
    return \@stale_chores;
}

1;
