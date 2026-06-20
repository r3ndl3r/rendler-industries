# /lib/DB/Reminders.pm

package DB::Reminders;

use strict;
use warnings;

# Database Library for Recurring Reminders and Notifications.
#
# Features:
#   - Rule-based management of weekly recurring reminders.
#   - Dynamic multi-user recipient mapping for targeted alerts.
#   - One-off vs Recurring reminder lifecycle logic.
#   - Privacy Mandate: Family-level resource; reminders are shared across authorized recipients.
#
# Integration Points:
#   - Extends the core DB package via package injection.
#   - Acts as the primary data source for the Reminders controller.
#   - Coordinates with global maintenance API for automated dispatch triggers.

# Returns the created_by user ID for a single reminder.
# Parameters:
#   id : Reminder ID.
# Returns:
#   Integer user ID, or undef if not found.
sub DB::get_reminder_owner {
    my ($self, $id) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("SELECT created_by FROM reminders WHERE id = ?");
    $sth->execute($id);
    my ($owner_id) = $sth->fetchrow_array();
    return $owner_id;
}

# Retrieves all reminders with their associated recipient data.
# Returns: ArrayRef of HashRefs containing reminder rules and metadata.
sub DB::get_all_reminders {
    my ($self) = @_;
    $self->ensure_connection;
    
    my $sql = q{
        SELECT r.*, 
               GROUP_CONCAT(rr.user_id) as recipient_ids,
               GROUP_CONCAT(u_rec.username) as recipient_names,
               u_creator.username as creator_name
        FROM reminders r
        LEFT JOIN reminder_recipients rr ON r.id = rr.reminder_id
        LEFT JOIN users u_rec ON rr.user_id = u_rec.id
        LEFT JOIN users u_creator ON r.created_by = u_creator.id
        GROUP BY r.id
        ORDER BY r.reminder_time ASC
    };
    
    return $self->{dbh}->selectall_arrayref($sql, { Slice => {} });
}

# Registers a new recurring reminder.
# Parameters:
#   title        : Reminder heading
#   desc         : Detailed notes
#   days         : Integer bitmask of active days (1=Mon, 2=Tue, 4=Wed, 8=Thu, 16=Fri, 32=Sat, 64=Sun)
#   time         : HH:MM:SS trigger time
#   user_id      : Creator ID
#   recipient_ids: ArrayRef of user IDs to notify
#   is_one_off   : Boolean flag
#   chore_points : Points awarded for completing this chore (optional)
# Returns:
#   Integer ID of the new reminder
sub DB::create_reminder {
    my ($self, $title, $desc, $days, $time, $user_id, $recipient_ids, $is_one_off, $chore_points) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("INSERT INTO reminders (title, description, days_of_week, reminder_time, created_by, is_one_off, chore_points) VALUES (?, ?, ?, ?, ?, ?, ?)");
    $sth->execute($title, $desc, $days // 0, $time, $user_id, $is_one_off // 0, $chore_points);
    my $reminder_id = $self->{dbh}->last_insert_id();
    
    # 2. Map recipients
    if ($recipient_ids && ref($recipient_ids) eq 'ARRAY') {
        my $sth_rec = $self->{dbh}->prepare("INSERT INTO reminder_recipients (reminder_id, user_id) VALUES (?, ?)");
        foreach my $uid (@$recipient_ids) {
            # Ensure we have a scalar ID (handles accidental double-nesting)
            my $clean_uid = ref($uid) eq 'ARRAY' ? $uid->[0] : $uid;
            next unless $clean_uid && $clean_uid =~ /^\d+$/;
            $sth_rec->execute($reminder_id, $clean_uid);
        }
    }
    
    return $reminder_id;
}

# Updates an existing reminder and its recipient list.
# Parameters:
#   id, title, desc, days, time, recipient_ids, is_one_off, chore_points : Attributes.
# Returns:
#   Integer: 1 on success.
sub DB::update_reminder {
    my ($self, $id, $title, $desc, $days, $time, $recipient_ids, $is_one_off, $chore_points) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("UPDATE reminders SET title = ?, description = ?, days_of_week = ?, reminder_time = ?, is_one_off = ?, chore_points = ? WHERE id = ?");
    $sth->execute($title, $desc, $days // 0, $time, $is_one_off // 0, $chore_points, $id);
    
    # 2. Refresh recipients (Delete and Re-insert)
    $self->{dbh}->do("DELETE FROM reminder_recipients WHERE reminder_id = ?", undef, $id);
    
    if ($recipient_ids && ref($recipient_ids) eq 'ARRAY') {
        my $sth_rec = $self->{dbh}->prepare("INSERT INTO reminder_recipients (reminder_id, user_id) VALUES (?, ?)");
        foreach my $uid (@$recipient_ids) {
            # Ensure we have a scalar ID
            my $clean_uid = ref($uid) eq 'ARRAY' ? $uid->[0] : $uid;
            next unless $clean_uid && $clean_uid =~ /^\d+$/;
            $sth_rec->execute($id, $clean_uid);
        }
    }
    
    return 1;
}

# Permanently deletes a reminder.
# Parameters:
#   id : Reminder ID.
# Returns:
#   Boolean : Success status.
sub DB::delete_reminder {
    my ($self, $id) = @_;
    $self->ensure_connection;
    
    # FK cascades will handle reminder_recipients cleanup
    return $self->{dbh}->do("DELETE FROM reminders WHERE id = ?", undef, $id);
}

# Toggles the active status of a reminder.
# Parameters:
#   id, active : Reminder ID and status flag.
# Returns:
#   Boolean : Success status.
sub DB::toggle_reminder_status {
    my ($self, $id, $active) = @_;
    $self->ensure_connection;
    
    return $self->{dbh}->do("UPDATE reminders SET is_active = ? WHERE id = ?", undef, $active, $id);
}

# Toggles a specific day within the days_of_week bitmask.
# Uses an atomic bitwise UPDATE — no read-modify-write race.
# Parameters:
#   id, day, active : Reminder ID, Day number (1-7), and status flag.
# Returns:
#   Boolean : Success status.
sub DB::toggle_reminder_day {
    my ($self, $id, $day, $active) = @_;
    $self->ensure_connection;

    my $sql = $active
        ? "UPDATE reminders SET days_of_week = days_of_week | (1 << (? - 1)) WHERE id = ?"
        : "UPDATE reminders SET days_of_week = days_of_week & ~(1 << (? - 1)) WHERE id = ?";
    return $self->{dbh}->do($sql, undef, $day, $id) ? 1 : 0;
}

# Retrieves reminders that are due to fire in the current minute.
# Parameters:
#   day_num : Integer (1=Mon, 7=Sun)
#   current_time : HH:MM
# Returns:
#   ArrayRef of HashRefs containing due reminder details and recipient metadata.
sub DB::get_due_reminders {
    my ($self, $day_num, $current_time) = @_;
    $self->ensure_connection;
    
    # Logic: 
    # - Must be active
    # - Current day must be set in days_of_week bitmask
    # - reminder_time must match current minute
    # - last_run_at must NOT be today (prevents duplicate triggers if maintenance runs twice)
    my $sql = q{
        SELECT r.*, u.id as user_id, u.username, u.email, u.discord_id, u.is_child
        FROM reminders r
        JOIN reminder_recipients rr ON r.id = rr.reminder_id
        JOIN users u ON rr.user_id = u.id
        WHERE r.is_active = 1
          AND u.status = 'approved'
          AND u.is_family = 1
          AND (r.days_of_week >> (? - 1)) & 1
          AND r.reminder_time LIKE ?
          AND (r.last_run_at IS NULL OR r.last_run_at < DATE_SUB(NOW(), INTERVAL 12 HOUR))
    };
    
    return $self->{dbh}->selectall_arrayref($sql, { Slice => {} }, $day_num, "$current_time%");
}

# Marks a reminder as having fired today.
# Parameters:
#   id          : Unique reminder ID.
#   target_time : (Optional) The intended trigger time string (YYYY-MM-DD HH:MM:00)
# Returns:
#   Boolean : Success status.
sub DB::mark_reminder_sent {
    my ($self, $id, $target_time) = @_;
    $self->ensure_connection;
    
    my $sql = "UPDATE reminders SET last_run_at = " . ($target_time ? "?" : "NOW()") . " WHERE id = ?";
    my $sth = $self->{dbh}->prepare($sql);
    
    my @params;
    push @params, $target_time if $target_time;
    push @params, $id;

    return $sth->execute(@params) > 0;
}

1;
