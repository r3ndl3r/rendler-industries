# /lib/DB/Medication.pm

package DB::Medication;

use strict;
use warnings;

# Medication Management Database Library.
#
# Features:
#   - Common medication registry (Standardized drug names and dosages).
#   - Multi-user dosage logging with real-time interval calculation.
#   - Family member participation tracking.
#   - Historical record management with "Reset to Now" functionality.
#   - Automatic dosage logs cleanup (older than 30 days) during maintenance.
#
# Integration Points:
#   - Extends the core DB package via package injection.
#   - Relies on persistent DBI handles from the parent context.
#   - Coordinates with Family Pulse AI for health context snapshots.
#   - Supports MVC separation by isolating SQL logic from controller actions.

# Retrieves all medication log entries grouped by family member.
# Parameters: None
# Returns:
#   HashRef: { 'Username' => [ {id, medication_name, family_member, logged_by, dosage, taken_at, taken_at_unix}, ... ], ... }
sub DB::get_medication_logs_by_user {
    my ($self) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        SELECT 
            ml.id, 
            ml.medication_id,
            mr.name as medication_name, 
            u1.id as family_member_id,
            u1.username as family_member, 
            u2.username as logged_by, 
            ml.dosage, 
            ml.taken_at,
            UNIX_TIMESTAMP(ml.taken_at) as taken_at_unix
        FROM medication_logs ml
        JOIN medication_registry mr ON ml.medication_id = mr.id
        JOIN users u1 ON ml.family_member_id = u1.id
        JOIN users u2 ON ml.logged_by_id = u2.id
        WHERE ml.deleted_at IS NULL
        ORDER BY u1.username ASC, ml.taken_at DESC
    ");
    $sth->execute();
    
    my %grouped;
    while (my $row = $sth->fetchrow_hashref()) {
        push @{$grouped{$row->{family_member}}}, $row;
    }
    return \%grouped;
}

# Retrieves the most recent confirmed medication doses across the family.
# Reminder confirmations are the history source for scheduled doses; standalone
# manual logs are included only when they are not a reminder source row.
sub DB::get_recent_medications_taken {
    my ($self, $limit) = @_;
    $self->ensure_connection;

    $limit = 10 unless defined $limit && $limit =~ /^\d+$/ && $limit > 0;
    $limit = 50 if $limit > 50;

    my $sth = $self->{dbh}->prepare("
        SELECT id, medication_id, medication_name, family_member_id,
               family_member, logged_by, dosage, taken_at,
               UNIX_TIMESTAMP(taken_at) as taken_at_unix
        FROM (
            SELECT e.id, r.medication_id, reg.name as medication_name,
                   r.family_member_id, u.username as family_member,
                   COALESCE(confirmer.username, '') as logged_by,
                   r.dosage, e.confirmed_at as taken_at
            FROM medication_reminder_events e
            JOIN medication_reminders r ON e.reminder_id = r.id
            JOIN medication_registry reg ON r.medication_id = reg.id
            JOIN users u ON r.family_member_id = u.id
            LEFT JOIN users confirmer ON e.confirmed_by = confirmer.id
            WHERE e.confirmed_at IS NOT NULL

            UNION ALL

            SELECT ml.id, ml.medication_id, reg.name as medication_name,
                   ml.family_member_id, u.username as family_member,
                   logger.username as logged_by,
                   ml.dosage, ml.taken_at
            FROM medication_logs ml
            JOIN medication_registry reg ON ml.medication_id = reg.id
            JOIN users u ON ml.family_member_id = u.id
            JOIN users logger ON ml.logged_by_id = logger.id
            WHERE ml.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM medication_reminders r
                JOIN medication_reminder_events e ON e.reminder_id = r.id
                WHERE r.source_log_id = ml.id
                  AND e.confirmed_at IS NOT NULL
            )
        ) taken
        ORDER BY taken_at DESC, id DESC
        LIMIT $limit
    ");
    $sth->execute();
    return $sth->fetchall_arrayref({});
}

# Logs a new medication dose with an optional custom timestamp.
# Parameters:
#   medication_name  : String (e.g. "Ibuprofen")
#   family_member_id : Integer ID of the recipient
#   logged_by_id     : Integer ID of the person recording the entry
#   dosage           : Numeric value in mg
#   taken_at         : (Optional) YYYY-MM-DD HH:MM:SS string
# Returns:
#   Integer : ID of the newly created log entry
sub DB::log_medication_dose {
    my ($self, $medication_name, $family_member_id, $logged_by_id, $dosage, $taken_at) = @_;
    $self->ensure_connection;
    
    # 1. Ensure medication exists in registry
    my $sth_reg = $self->{dbh}->prepare("INSERT IGNORE INTO medication_registry (name, default_dosage) VALUES (?, ?)");
    $sth_reg->execute($medication_name, $dosage);
    
    # 2. Retrieve registry ID
    my $sth_id = $self->{dbh}->prepare("SELECT id FROM medication_registry WHERE name = ?");
    $sth_id->execute($medication_name);
    my ($med_id) = $sth_id->fetchrow_array();

    my ($event_date, $logged_time);
    if ($taken_at && $taken_at =~ /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?)/) {
        $event_date = $1;
        $logged_time = $2;
        $logged_time .= ':00' if $logged_time =~ /^\d{2}:\d{2}$/;
    } else {
        ($event_date, $logged_time) = $self->{dbh}->selectrow_array(
            "SELECT CURDATE(), TIME_FORMAT(CURTIME(), '%H:%i:%s')"
        );
    }

    my $event_sth = $self->{dbh}->prepare("
        SELECT e.id, r.source_log_id
        FROM medication_reminder_events e
        JOIN medication_reminders r ON e.reminder_id = r.id
        WHERE r.medication_id = ?
          AND r.family_member_id = ?
          AND r.deleted_at IS NULL
          AND e.scheduled_date = ?
          AND e.confirmed_at IS NULL
        ORDER BY
          CASE WHEN e.scheduled_time <= ? THEN 0 ELSE 1 END ASC,
          ABS(TIME_TO_SEC(TIMEDIFF(e.scheduled_time, ?))) ASC,
          e.id ASC
        LIMIT 1
    ");
    $event_sth->execute($med_id, $family_member_id, $event_date, $logged_time, $logged_time);
    my $event = $event_sth->fetchrow_hashref();

    if ($event && $event->{source_log_id}) {
        $self->{dbh}->begin_work;
        eval {
            my $taken_expr = $taken_at ? '?' : 'NOW()';
            my $update_sth = $self->{dbh}->prepare("
                UPDATE medication_logs
                SET taken_at = $taken_expr, logged_by_id = ?, dosage = ?
                WHERE id = ?
                  AND medication_id = ?
                  AND family_member_id = ?
                  AND deleted_at IS NULL
            ");
            my @update_params;
            push @update_params, $taken_at if $taken_at;
            push @update_params, $logged_by_id, $dosage, $event->{source_log_id}, $med_id, $family_member_id;
            $update_sth->execute(@update_params);
            if ($update_sth->rows <= 0) {
                my ($exists) = $self->{dbh}->selectrow_array(
                    "SELECT 1 FROM medication_logs WHERE id = ? AND medication_id = ? AND family_member_id = ? AND deleted_at IS NULL",
                    undef,
                    $event->{source_log_id}, $med_id, $family_member_id
                );
                die "source medication log not found for reminder event $event->{id}" unless $exists;
            }

            my $confirm_sth = $self->{dbh}->prepare("
                UPDATE medication_reminder_events
                SET confirmed_at = NOW(), confirmed_by = ?
                WHERE id = ?
                  AND confirmed_at IS NULL
            ");
            $confirm_sth->execute($logged_by_id, $event->{id});

            $self->{dbh}->commit;
        };
        if ($@) {
            $self->{dbh}->rollback;
            die $@;
        }
        return $event->{source_log_id};
    }
    
    # 3. Insert the log
    my $sql = "INSERT INTO medication_logs (medication_id, family_member_id, logged_by_id, dosage" . ($taken_at ? ", taken_at" : "") . ") VALUES (?, ?, ?, ?" . ($taken_at ? ", ?" : "") . ")";
    my $sth_log = $self->{dbh}->prepare($sql);
    
    my @params = ($med_id, $family_member_id, $logged_by_id, $dosage);
    push @params, $taken_at if $taken_at;
    
    $sth_log->execute(@params);
    return $self->{dbh}->last_insert_id();
}

# Updates an existing medication log entry.
# Parameters:
#   id               : Unique ID of the log entry
#   medication_name  : String name
#   family_member_id : Integer ID
#   dosage           : Numeric mg
#   taken_at         : YYYY-MM-DD HH:MM:SS string
# Returns:
#   Boolean : Success status
sub DB::update_medication_log {
    my ($self, $id, $medication_name, $family_member_id, $dosage, $taken_at) = @_;
    $self->ensure_connection;

    # 1. Registry update/insert
    my $sth_reg = $self->{dbh}->prepare("INSERT IGNORE INTO medication_registry (name, default_dosage) VALUES (?, ?)");
    $sth_reg->execute($medication_name, $dosage);
    
    my $sth_id = $self->{dbh}->prepare("SELECT id FROM medication_registry WHERE name = ?");
    $sth_id->execute($medication_name);
    my ($med_id) = $sth_id->fetchrow_array();

    # 2. Log update
    my $sql = "UPDATE medication_logs SET medication_id = ?, family_member_id = ?, dosage = ?" . (defined $taken_at ? ", taken_at = ?" : "") . " WHERE id = ? AND deleted_at IS NULL";
    my $sth = $self->{dbh}->prepare($sql);

    my @params = ($med_id, $family_member_id, $dosage);
    push @params, $taken_at if defined $taken_at;
    push @params, $id;

    $sth->execute(@params);
    return 1 if $sth->rows > 0;

    # MySQL/MariaDB reports changed rows by default, so a no-op save on an
    # existing record returns 0. Treat that as success and reserve false only
    # for genuinely missing IDs.
    my ($exists) = $self->{dbh}->selectrow_array(
        "SELECT 1 FROM medication_logs WHERE id = ? AND deleted_at IS NULL",
        undef,
        $id
    );
    return $exists ? 1 : 0;
}

# Resets a medication log entry's timestamp to NOW() or a custom value.
# Parameters:
#   id       : Unique ID of the log entry
#   taken_at : (Optional) YYYY-MM-DD HH:MM:SS string
# Returns:
#   Boolean : Success status
sub DB::reset_medication_log {
    my ($self, $id, $taken_at) = @_;
    $self->ensure_connection;
    
    my $sql = "UPDATE medication_logs SET taken_at = " . ($taken_at ? "?" : "NOW()") . " WHERE id = ? AND deleted_at IS NULL";
    my $sth = $self->{dbh}->prepare($sql);
    
    my @params;
    push @params, $taken_at if $taken_at;
    push @params, $id;

    return $sth->execute(@params) > 0;
}

# Removes a medication log entry.
# Parameters:
#   id : Unique ID of the log entry
# Returns:
#   Boolean : Success status
sub DB::delete_medication_log {
    my ($self, $id) = @_;
    $self->ensure_connection;

    $self->{dbh}->begin_work;
    my $deleted = eval {
        my $sth_retire = $self->{dbh}->prepare("
            UPDATE medication_reminders
            SET is_active = 0, deleted_at = COALESCE(deleted_at, NOW())
            WHERE source_log_id = ?
              AND deleted_at IS NULL
        ");
        $sth_retire->execute($id);

        my $sth = $self->{dbh}->prepare("
            UPDATE medication_logs
            SET deleted_at = COALESCE(deleted_at, NOW())
            WHERE id = ?
              AND deleted_at IS NULL
        ");
        $sth->execute($id);
        my $rows = $sth->rows > 0 ? 1 : 0;
        $self->{dbh}->commit;
        return $rows;
    };
    if ($@) {
        $self->{dbh}->rollback;
        die $@;
    }
    return $deleted;
}

# Retrieves the registry with usage counts.
# Parameters: None
# Returns:
#   ArrayRef of HashRefs: [ {id, name, default_dosage, usage_count}, ... ]
sub DB::get_registry_with_stats {
    my ($self) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        SELECT mr.*, (COUNT(DISTINCT ml.id) + COUNT(DISTINCT mrem.id)) as usage_count
        FROM medication_registry mr
        LEFT JOIN medication_logs ml ON mr.id = ml.medication_id
        LEFT JOIN medication_reminders mrem ON mr.id = mrem.medication_id
        GROUP BY mr.id
        ORDER BY mr.name ASC
    ");
    $sth->execute();
    return $sth->fetchall_arrayref({});
}

# Updates a registry item.
# Parameters:
#   id     : Registry ID
#   name   : New display name
#   dosage : Default dosage mg
# Returns:
#   Boolean : Success status
sub DB::update_registry_item {
    my ($self, $id, $name, $dosage) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("UPDATE medication_registry SET name = ?, default_dosage = ? WHERE id = ?");
    return $sth->execute($name, $dosage, $id);
}

# Deletes a registry item only if not in use.
# Parameters:
#   id : Registry ID
# Returns:
#   (Boolean, String) : (Success status, Error message if failed)
sub DB::delete_registry_item {
    my ($self, $id) = @_;
    $self->ensure_connection;
    
    # Check if used in logs or reminder schedules.
    my $sth_check = $self->{dbh}->prepare("
        SELECT
            (SELECT COUNT(*) FROM medication_logs WHERE medication_id = ?) +
            (SELECT COUNT(*) FROM medication_reminders WHERE medication_id = ?)
    ");
    $sth_check->execute($id, $id);
    my ($count) = $sth_check->fetchrow_array();
    
    return (0, "Cannot delete: Medication has historical logs or reminders.") if $count > 0;
    
    my $sth = $self->{dbh}->prepare("DELETE FROM medication_registry WHERE id = ?");
    return ($sth->execute($id), "");
}

# Retrieves list of family members (all approved users).
# Parameters: None
# Returns:
#   ArrayRef of HashRefs: [ {id, username}, ... ]
sub DB::get_medication_members {
    my ($self) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT id, username FROM users WHERE is_family = 1 ORDER BY username ASC");
    $sth->execute();
    
    return $sth->fetchall_arrayref({});
}

###############################################################################
# MEDICATION REMINDERS
###############################################################################

# Retrieves all medication reminder schedules with related registry names.
# Parameters: None
# Returns: ArrayRef of HashRefs
sub DB::get_medication_reminders {
    my ($self) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("
        SELECT mr.id, mr.medication_id, mr.family_member_id, mr.dosage,
               mr.reminder_time, mr.days_of_week, mr.is_active, mr.source_log_id,
               mr.created_by, mr.created_at, mr.deleted_at,
               reg.name as medication_name,
               u.username as family_member_name
        FROM medication_reminders mr
        JOIN medication_registry reg ON mr.medication_id = reg.id
        JOIN users u ON mr.family_member_id = u.id
        WHERE mr.deleted_at IS NULL
        ORDER BY u.username ASC, mr.reminder_time ASC
    ");
    $sth->execute();
    return $sth->fetchall_arrayref({});
}

# Retrieves reminder schedules for a specific family member.
# Parameters: $member_id - Integer user ID
# Returns: ArrayRef of HashRefs
sub DB::get_medication_reminders_for_member {
    my ($self, $member_id) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("
        SELECT mr.id, mr.medication_id, mr.dosage, mr.reminder_time,
               mr.days_of_week, mr.is_active, mr.source_log_id,
               reg.name as medication_name
        FROM medication_reminders mr
        JOIN medication_registry reg ON mr.medication_id = reg.id
        WHERE mr.family_member_id = ?
          AND mr.deleted_at IS NULL
        ORDER BY mr.reminder_time ASC
    ");
    $sth->execute($member_id);
    return $sth->fetchall_arrayref({});
}

# Saves the set of reminder times for a medication + family member combo.
# Reconciles schedules in place so historical confirmation events remain intact.
# Parameters:
#   medication_id    : Integer
#   family_member_id : Integer user ID
#   dosage           : Integer mg
#   times            : ArrayRef of time strings ("HH:MM" or "HH:MM:SS")
#   days_of_week     : Integer bitmask (1=Mon, 2=Tue, 4=Wed, 8=Thu, 16=Fri, 32=Sat, 64=Sun)
#   created_by       : Integer user ID
#   source_log_id    : Required medication_logs.id to update on confirm
# Returns: Integer count of reminders created
sub DB::save_medication_reminders {
    my ($self, $medication_id, $family_member_id, $dosage, $times, $days_of_week, $created_by, $source_log_id) = @_;
    $self->ensure_connection;

    die "Invalid medication reminder details"
        unless defined $medication_id && $medication_id =~ /^\d+$/
            && defined $family_member_id && $family_member_id =~ /^\d+$/
            && defined $source_log_id && $source_log_id =~ /^\d+$/
            && defined $dosage && $dosage =~ /^\d+$/ && $dosage > 0;

    $days_of_week //= 127;
    die "Invalid reminder day mask" unless $days_of_week =~ /^\d+$/ && $days_of_week > 0 && $days_of_week <= 127;
    my $times_ref = ref($times) eq 'ARRAY' ? $times : [$times];
    my @time_strings;
    my %seen_time;
    for my $t (@$times_ref) {
        next unless $t && $t =~ /\A(\d{1,2}):(\d{2})(?::(\d{2}))?/;
        next if $1 > 23 || $2 > 59 || (defined $3 && $3 > 59);
        my $time_str = sprintf('%02d:%02d:%02d', $1, $2, $3 // 0);
        next if $seen_time{$time_str}++;
        push @time_strings, $time_str;
    }

    my ($source_ok) = $self->{dbh}->selectrow_array(
        "SELECT 1 FROM medication_logs WHERE id = ? AND medication_id = ? AND family_member_id = ? AND deleted_at IS NULL",
        undef,
        $source_log_id, $medication_id, $family_member_id
    );
    die "Invalid medication reminder source log" unless $source_ok;

    $self->{dbh}->begin_work;
    my $result = eval {
        die "No valid reminder times" unless @time_strings;

        my $placeholders = join(',', ('?') x @time_strings);
        my $sth_retire = $self->{dbh}->prepare("
            UPDATE medication_reminders
            SET is_active = 0, deleted_at = COALESCE(deleted_at, NOW())
            WHERE medication_id = ?
              AND family_member_id = ?
              AND deleted_at IS NULL
              AND TIME_FORMAT(reminder_time, '%H:%i:%s') NOT IN ($placeholders)
        ");
        $sth_retire->execute($medication_id, $family_member_id, @time_strings);

        my $sth_ins = $self->{dbh}->prepare("INSERT INTO medication_reminders (medication_id, family_member_id, dosage, reminder_time, days_of_week, source_log_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)");
        my $sth_find = $self->{dbh}->prepare("
            SELECT id
            FROM medication_reminders
            WHERE medication_id = ?
              AND family_member_id = ?
              AND TIME_FORMAT(reminder_time, '%H:%i:%s') = ?
              AND deleted_at IS NULL
            ORDER BY id ASC
            LIMIT 1
        ");
        my $sth_has_history = $self->{dbh}->prepare("
            SELECT 1
            FROM medication_reminder_events
            WHERE reminder_id = ?
              AND confirmed_at IS NOT NULL
            LIMIT 1
        ");
        my $sth_update = $self->{dbh}->prepare("
            UPDATE medication_reminders
            SET dosage = ?, days_of_week = ?, source_log_id = ?, created_by = ?,
                is_active = 1, deleted_at = NULL
            WHERE id = ?
        ");
        my $sth_dedupe = $self->{dbh}->prepare("
            UPDATE medication_reminders
            SET is_active = 0, deleted_at = COALESCE(deleted_at, NOW())
            WHERE medication_id = ?
              AND family_member_id = ?
              AND TIME_FORMAT(reminder_time, '%H:%i:%s') = ?
              AND id <> ?
        ");
        my $count = 0;
        foreach my $time_str (@time_strings) {
            $sth_find->execute($medication_id, $family_member_id, $time_str);
            my ($existing_id) = $sth_find->fetchrow_array();
            if ($existing_id) {
                my $existing = $self->{dbh}->selectrow_hashref(
                    "SELECT dosage, source_log_id FROM medication_reminders WHERE id = ?",
                    undef,
                    $existing_id
                );
                $sth_has_history->execute($existing_id);
                my ($has_history) = $sth_has_history->fetchrow_array();
                if ($has_history && ($existing->{dosage} != $dosage || $existing->{source_log_id} != $source_log_id)) {
                    my $sth_soft_del = $self->{dbh}->prepare("
                        UPDATE medication_reminders
                        SET is_active = 0, deleted_at = COALESCE(deleted_at, NOW())
                        WHERE id = ?
                    ");
                    $sth_soft_del->execute($existing_id);
                    $sth_ins->execute($medication_id, $family_member_id, $dosage, $time_str, $days_of_week, $source_log_id, $created_by);
                    my $new_id = $self->{dbh}->last_insert_id();
                    $sth_dedupe->execute($medication_id, $family_member_id, $time_str, $new_id);
                } else {
                    $sth_update->execute($dosage, $days_of_week, $source_log_id, $created_by, $existing_id);
                    $sth_dedupe->execute($medication_id, $family_member_id, $time_str, $existing_id);
                }
            } else {
                $sth_ins->execute($medication_id, $family_member_id, $dosage, $time_str, $days_of_week, $source_log_id, $created_by);
            }
            $count++;
        }
        $self->{dbh}->commit;
        return $count;
    };
    if ($@) {
        $self->{dbh}->rollback;
        die "save_medication_reminders failed: $@";
    }
    return $result;
}

sub DB::get_medication_reminder_member_id {
    my ($self, $id) = @_;
    $self->ensure_connection;

    my ($member_id) = $self->{dbh}->selectrow_array(
        "SELECT family_member_id FROM medication_reminders WHERE id = ? AND deleted_at IS NULL",
        undef,
        $id
    );
    return $member_id;
}

sub DB::medication_log_matches_reminder_source {
    my ($self, $source_log_id, $medication_id, $family_member_id) = @_;
    $self->ensure_connection;

    my ($exists) = $self->{dbh}->selectrow_array(
        "SELECT 1 FROM medication_logs WHERE id = ? AND medication_id = ? AND family_member_id = ? AND deleted_at IS NULL",
        undef,
        $source_log_id, $medication_id, $family_member_id
    );
    return $exists ? 1 : 0;
}

# Toggles the is_active flag on a reminder schedule.
# Parameters:
#   id     : Integer reminder ID
#   active : Boolean
# Returns: Boolean success
sub DB::toggle_medication_reminder {
    my ($self, $id, $active) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("UPDATE medication_reminders SET is_active = ? WHERE id = ? AND deleted_at IS NULL");
    return $sth->execute($active ? 1 : 0, $id);
}

# Deletes a single reminder schedule without removing historical events.
# Parameters:
#   id : Integer reminder ID
# Returns: Boolean success
sub DB::delete_medication_reminder {
    my ($self, $id) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("UPDATE medication_reminders SET is_active = 0, deleted_at = COALESCE(deleted_at, NOW()) WHERE id = ? AND deleted_at IS NULL");
    return $sth->execute($id) > 0;
}

# Retrieves due medication reminders for the current minute that do NOT already
# have a confirmation event for today and match the current day of week.
# Parameters:
#   current_date : String in YYYY-MM-DD format (today)
#   current_time : String in HH:MM format (current minute)
#   day_number   : Integer 1=Mon..7=Sun
# Returns: ArrayRef of HashRefs with reminder details + registry name
sub DB::get_due_medication_reminders {
    my ($self, $current_date, $current_time, $day_number) = @_;
    $self->ensure_connection;

    my $sql = "
        SELECT r.id, r.medication_id, r.family_member_id, r.dosage,
               r.reminder_time, r.days_of_week,
               reg.name as medication_name,
               u.username as family_member_name
        FROM medication_reminders r
        JOIN medication_registry reg ON r.medication_id = reg.id
        JOIN users u ON r.family_member_id = u.id
        WHERE r.is_active = 1
          AND r.deleted_at IS NULL
          AND r.reminder_time LIKE ?
          AND (r.days_of_week >> (? - 1)) & 1
          AND NOT EXISTS (
              SELECT 1 FROM medication_reminder_events e
              WHERE e.reminder_id = r.id
                AND e.scheduled_date = ?
          )
    ";

    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute("$current_time%", $day_number, $current_date);
    return $sth->fetchall_arrayref({});
}

# Creates a new medication_reminder_events row for a due reminder, or updates
# last_fired_at if the row already exists (handles concurrent maintenance runs).
# This marks that the reminder has been "fired" for today.
# Parameters:
#   reminder_id     : Integer
#   scheduled_date  : String YYYY-MM-DD
#   scheduled_time  : String HH:MM:SS
# Returns: Integer event ID (or existing ID if upsert)
sub DB::create_medication_reminder_event {
    my ($self, $reminder_id, $scheduled_date, $scheduled_time) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("
        INSERT INTO medication_reminder_events (reminder_id, scheduled_date, scheduled_time, last_fired_at)
        VALUES (?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE last_fired_at = NOW()
    ");
    $sth->execute($reminder_id, $scheduled_date, $scheduled_time);

    # Fetch the event ID (existing or newly inserted)
    my $fetch = $self->{dbh}->prepare("SELECT id FROM medication_reminder_events WHERE reminder_id = ? AND scheduled_date = ?");
    $fetch->execute($reminder_id, $scheduled_date);
    my ($eid) = $fetch->fetchrow_array();
    return $eid;
}

# Updates the last_fired_at timestamp on an event (used for re-alert tracking).
# Parameters:
#   event_id : Integer event ID
# Returns: Boolean success
sub DB::touch_medication_reminder_event {
    my ($self, $event_id) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("UPDATE medication_reminder_events SET last_fired_at = NOW() WHERE id = ?");
    return $sth->execute($event_id) > 0;
}

# Retrieves overdue (unconfirmed) reminder events where last_fired_at is older
# than 30 minutes. These need a re-alert notification.
# Parameters:
#   current_date : String YYYY-MM-DD (today)
# Returns: ArrayRef of HashRefs with event + reminder + registry data
sub DB::get_overdue_medication_confirmations {
    my ($self, $current_date) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("
        SELECT e.id as event_id, e.reminder_id, e.scheduled_date,
               e.scheduled_time, e.last_fired_at,
               r.medication_id, r.family_member_id, r.dosage,
               reg.name as medication_name,
               u.username as family_member_name
        FROM medication_reminder_events e
        JOIN medication_reminders r ON e.reminder_id = r.id
        JOIN medication_registry reg ON r.medication_id = reg.id
        JOIN users u ON r.family_member_id = u.id
        WHERE e.confirmed_at IS NULL
          AND e.scheduled_date = ?
          AND r.is_active = 1
          AND r.deleted_at IS NULL
          AND (e.last_fired_at IS NULL OR e.last_fired_at < NOW() - INTERVAL 30 MINUTE)
    ");
    $sth->execute($current_date);
    return $sth->fetchall_arrayref({});
}

# Confirms a pending reminder event as taken and updates its source dose log.
# Parameters:
#   event_id       : Integer event ID
#   confirmed_by   : Integer user ID who confirmed
# Returns: HashRef { success => 1, log_id => Integer|null }
sub DB::confirm_medication_reminder {
    my ($self, $event_id, $confirmed_by) = @_;
    $self->ensure_connection;

    $self->{dbh}->begin_work;
    my $result = eval {
        # Only the family member attached to the reminder can confirm it.
        my $sth = $self->{dbh}->prepare("
            UPDATE medication_reminder_events e
            JOIN medication_reminders r ON e.reminder_id = r.id
            SET e.confirmed_at = NOW(), e.confirmed_by = ?
            WHERE e.id = ? AND e.confirmed_at IS NULL
              AND r.family_member_id = ?
              AND r.deleted_at IS NULL
        ");
        $sth->execute($confirmed_by, $event_id, $confirmed_by);
        unless ($sth->rows > 0) {
            $self->{dbh}->rollback;
            return { success => 0 };
        }

        my $sth_r = $self->{dbh}->prepare("
            SELECT r.medication_id, r.family_member_id, r.dosage, r.source_log_id
            FROM medication_reminder_events e
            JOIN medication_reminders r ON e.reminder_id = r.id
            WHERE e.id = ?
        ");
        $sth_r->execute($event_id);
        my $reminder = $sth_r->fetchrow_hashref();
        unless ($reminder && $reminder->{source_log_id}) {
            $self->{dbh}->rollback;
            return { success => 0 };
        }

        my $log_sth = $self->{dbh}->prepare("
            UPDATE medication_logs
            SET taken_at = NOW(), logged_by_id = ?, dosage = ?
            WHERE id = ?
              AND medication_id = ?
              AND family_member_id = ?
              AND deleted_at IS NULL
        ");
        $log_sth->execute(
            $confirmed_by,
            $reminder->{dosage},
            $reminder->{source_log_id},
            $reminder->{medication_id},
            $reminder->{family_member_id}
        );
        my $log_updated = $log_sth->rows > 0;
        unless ($log_updated) {
            my ($exists) = $self->{dbh}->selectrow_array(
                "SELECT 1 FROM medication_logs WHERE id = ? AND medication_id = ? AND family_member_id = ? AND deleted_at IS NULL",
                undef,
                $reminder->{source_log_id}, $reminder->{medication_id}, $reminder->{family_member_id}
            );
            $log_updated = 1 if $exists;
        }
        unless ($log_updated) {
            $self->{dbh}->rollback;
            return { success => 0 };
        }

        $self->{dbh}->commit;
        return { success => 1, log_id => $reminder->{source_log_id} };
    };
    if ($@) {
        $self->{dbh}->rollback;
        die $@;
    }
    return $result;
}

# Retrieves today's pending (unconfirmed) reminder events for a family member.
# Parameters:
#   member_id : Integer user ID
#   date      : String YYYY-MM-DD (today)
# Returns: ArrayRef of HashRefs
sub DB::get_pending_medication_reminders {
    my ($self, $member_id, $date) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("
        SELECT e.id as event_id, e.reminder_id, e.scheduled_time, e.last_fired_at,
               UNIX_TIMESTAMP(e.last_fired_at) as last_fired_at_unix,
               r.dosage, reg.name as medication_name
        FROM medication_reminder_events e
        JOIN medication_reminders r ON e.reminder_id = r.id
        JOIN medication_registry reg ON r.medication_id = reg.id
        WHERE e.confirmed_at IS NULL
          AND r.family_member_id = ?
          AND e.scheduled_date = ?
          AND r.deleted_at IS NULL
        ORDER BY e.scheduled_time ASC
    ");
    $sth->execute($member_id, $date);
    return $sth->fetchall_arrayref({});
}

1;
