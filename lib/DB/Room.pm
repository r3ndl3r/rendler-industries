# /lib/DB/Room.pm

package DB::Room;

use strict;
use warnings;
use DBI qw(:sql_types);

# Database library for Room Cleaning Tracker.
#
# Features:
#   - Participating family member configuration and alert timing.
#   - Daily submission tracking with independent binary photo storage.
#   - Blackout date management for family holidays/absences.
#   - Status tracking (Pending, Passed, Failed) with admin feedback.
#
# Integration Points:
#   - Extends the core DB package via package injection.
#   - Provides data for the Room controller and Maintenance background tasks.

# --- Configuration & Settings ---

# Retrieves the room tracker configuration for all or a specific user.
sub DB::get_room_configs {
    my ($self, $user_id) = @_;
    $self->ensure_connection;
    
    my $sql = "SELECT rc.*, u.username FROM room_config rc JOIN users u ON rc.user_id = u.id WHERE u.is_admin = 0";
    my @params;
    
    if ($user_id) {
        $sql .= " AND rc.user_id = ?";
        push @params, $user_id;
    }
    
    $sql .= " ORDER BY u.username ASC";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(@params);
    return $user_id ? $sth->fetchrow_hashref() : $sth->fetchall_arrayref({});
}

# Saves or updates room tracker configuration for a user.
sub DB::save_room_config {
    my ($self, $user_id, $alert_time, $is_active) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare(
        "INSERT INTO room_config (user_id, alert_start_time, is_active) 
         VALUES (?, ?, ?) 
         ON DUPLICATE KEY UPDATE alert_start_time = VALUES(alert_start_time), is_active = VALUES(is_active)"
    );
    $sth->execute($user_id, $alert_time, $is_active);
}

# --- Submissions ---

# Retrieves the submission status for a user on a specific date.
sub DB::get_room_status_for_date {
    my ($self, $user_id, $date) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare(
        "SELECT id, user_id, filename, original_filename, submission_date, status, admin_comment, created_at
         FROM room_submissions 
         WHERE user_id = ? AND submission_date = ?"
    );
    $sth->execute($user_id, $date);
    return $sth->fetchall_arrayref({});
}

# Processes a room photo submission with binary storage.
sub DB::submit_room_photo {
    my ($self, $user_id, $filename, $original_filename, $mime_type, $file_size, $file_data, $date) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare(
        "INSERT INTO room_submissions (user_id, filename, original_filename, mime_type, file_size, file_data, submission_date, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')"
    );
    $sth->bind_param(1, $user_id);
    $sth->bind_param(2, $filename);
    $sth->bind_param(3, $original_filename);
    $sth->bind_param(4, $mime_type);
    $sth->bind_param(5, $file_size);
    $sth->bind_param(6, $file_data, SQL_BLOB);
    $sth->bind_param(7, $date);
    $sth->execute();
}

# Retrieves all pending or failed submissions for admin review.
sub DB::get_pending_room_submissions {
    my ($self) = @_;
    $self->ensure_connection;
    
    my $sql = "SELECT rs.id, rs.user_id, rs.filename, rs.original_filename, rs.submission_date, rs.status, rs.admin_comment, u.username 
               FROM room_submissions rs 
               JOIN users u ON rs.user_id = u.id 
               WHERE rs.status IN ('pending', 'failed') 
               ORDER BY rs.submission_date DESC, rs.user_id ASC";
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute();
    return $sth->fetchall_arrayref({});
}

# Permanently removes a room submission record.
sub DB::delete_room_submission {
    my ($self, $id) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("DELETE FROM room_submissions WHERE id = ?");
    $sth->execute($id);
}

# Retrieves specific photo record including binary data.
sub DB::get_room_photo_by_id {
    my ($self, $id) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT * FROM room_submissions WHERE id = ?");
    $sth->execute($id);
    return $sth->fetchrow_hashref();
}

# Updates a specific photo's status and comment.
sub DB::update_room_photo_status {
    my ($self, $submission_id, $status, $comment) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare(
        "UPDATE room_submissions SET status = ?, admin_comment = ? WHERE id = ?"
    );
    $sth->execute($status, $comment, $submission_id);
}

# --- Blackouts ---

# Checks if a date is marked as a blackout.
sub DB::is_room_blackout {
    my ($self, $date) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT 1 FROM room_blackouts WHERE blackout_date = ?");
    $sth->execute($date);
    my @row = $sth->fetchrow_array();
    return scalar(@row) ? 1 : 0;
}

# Retrieves all future blackout dates (and recent past for context).
sub DB::get_room_blackouts {
    my ($self) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT * FROM room_blackouts WHERE blackout_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) ORDER BY blackout_date ASC");
    $sth->execute();
    return $sth->fetchall_arrayref({});
}

# Adds a new blackout date.
sub DB::add_room_blackout {
    my ($self, $date, $reason) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("INSERT IGNORE INTO room_blackouts (blackout_date, reason) VALUES (?, ?)");
    $sth->execute($date, $reason);
}

# Removes a blackout date.
sub DB::delete_room_blackout {
    my ($self, $id) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("DELETE FROM room_blackouts WHERE id = ?");
    $sth->execute($id);
}

# --- Automation Helpers ---

# Identifies users who haven't finished their room check for a specific date.
sub DB::get_users_needing_room_reminders {
    my ($self, $date) = @_;
    $self->ensure_connection;
    
    # Fallback to today if no date provided
    $date //= DateTime->now(time_zone => $self->{timezone})->ymd;
    
    # Logic:
    # 1. User is active in room_config.
    # 2. Current time is past alert_start_time.
    # 3. Not ALL submissions are 'passed' for today.
    # 4. Today is not a blackout date.
    # 5. Last reminder was > 55 minutes ago (hourly).
    
    my $sql = <<'SQL';
        SELECT rc.*, u.username, u.discord_id 
        FROM room_config rc
        JOIN users u ON rc.user_id = u.id
        WHERE rc.is_active = 1
        AND CURRENT_TIME() >= rc.alert_start_time
        AND (
            -- No submissions yet
            NOT EXISTS (
                SELECT 1 FROM room_submissions rs 
                WHERE rs.user_id = rc.user_id AND rs.submission_date = ?
            )
            OR
            (
                -- Has submissions, but NONE are pending (user is done for now)
                NOT EXISTS (
                    SELECT 1 FROM room_submissions rs 
                    WHERE rs.user_id = rc.user_id 
                    AND rs.submission_date = ?
                    AND rs.status = 'pending'
                )
                AND
                -- And at least one is failed (needs more work)
                EXISTS (
                    SELECT 1 FROM room_submissions rs 
                    WHERE rs.user_id = rc.user_id 
                    AND rs.submission_date = ?
                    AND rs.status = 'failed'
                )
                AND
                -- And not ALL are passed yet
                EXISTS (
                    SELECT 1 FROM room_submissions rs 
                    WHERE rs.user_id = rc.user_id 
                    AND rs.submission_date = ?
                    AND rs.status != 'passed'
                )
            )
        )
        AND NOT EXISTS (
            SELECT 1 FROM room_blackouts rb 
            WHERE rb.blackout_date = ?
        )
        AND (rc.last_reminder_sent_at IS NULL OR rc.last_reminder_sent_at <= DATE_SUB(NOW(), INTERVAL 55 MINUTE))
SQL
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($date, $date, $date, $date, $date);
    return $sth->fetchall_arrayref({});
}

# Retrieves specific feedback comments for failed photos on a specific date.
sub DB::get_room_failed_comments {
    my ($self, $user_id, $date) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare(
        "SELECT admin_comment FROM room_submissions 
         WHERE user_id = ? AND submission_date = ? AND status = 'failed' AND admin_comment IS NOT NULL AND admin_comment != ''"
    );
    $sth->execute($user_id, $date);
    return [ map { $_->[0] } @{$sth->fetchall_arrayref()} ];
}

# Retrieves storage usage statistics for the Room module.
sub DB::get_room_storage_stats {
    my ($self) = @_;
    $self->ensure_connection;
    
    # Calculate total photos, total size, and potential savings (older than 30 days)
    my $sql = <<'SQL';
        SELECT 
            COUNT(*) as total_count,
            COALESCE(SUM(file_size), 0) as total_size,
            (SELECT COUNT(*) FROM room_submissions WHERE submission_date < DATE_SUB(CURDATE(), INTERVAL 30 DAY)) as old_count,
            (SELECT COALESCE(SUM(file_size), 0) FROM room_submissions WHERE submission_date < DATE_SUB(CURDATE(), INTERVAL 30 DAY)) as old_size
        FROM room_submissions
SQL
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute();
    return $sth->fetchrow_hashref();
}

# Deletes room submissions older than 30 days.
sub DB::trim_room_data {
    my ($self) = @_;
    $self->ensure_connection;
    
    my $sql = "DELETE FROM room_submissions WHERE submission_date < DATE_SUB(CURDATE(), INTERVAL 30 DAY)";
    return $self->{dbh}->do($sql);
}

# Retrieves a summary of progress for all tracked users on a specific date.
sub DB::get_room_daily_summary {
    my ($self, $date) = @_;
    $self->ensure_connection;
    
    # Fallback to today if no date provided
    $date //= DateTime->now(time_zone => $self->{timezone})->ymd;
    
    my $sql = <<'SQL';
        SELECT 
            u.id, 
            u.username, 
            rc.is_active,
            rc.alert_start_time,
            (SELECT COUNT(*) FROM room_submissions rs WHERE rs.user_id = u.id AND rs.submission_date = ?) as total_photos,
            (SELECT COUNT(*) FROM room_submissions rs WHERE rs.user_id = u.id AND rs.submission_date = ? AND rs.status = 'passed') as passed_photos,
            (SELECT COUNT(*) FROM room_submissions rs WHERE rs.user_id = u.id AND rs.submission_date = ? AND rs.status = 'failed') as failed_photos,
            (SELECT COUNT(*) FROM room_submissions rs WHERE rs.user_id = u.id AND rs.submission_date = ? AND rs.status = 'pending') as pending_photos
        FROM users u
        JOIN room_config rc ON u.id = rc.user_id
        WHERE rc.is_active = 1 AND u.is_admin = 0
        ORDER BY u.username ASC
SQL
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($date, $date, $date, $date);
    return $sth->fetchall_arrayref({});
}

# Marks a reminder as sent.
sub DB::update_room_reminder_sent {
    my ($self, $user_id) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("UPDATE room_config SET last_reminder_sent_at = NOW() WHERE user_id = ?");
    $sth->execute($user_id);
}

1;
