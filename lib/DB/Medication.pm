# /lib/DB/Medication.pm

package DB::Medication;

use strict;
use warnings;

# Database helper for medication tracking and management.
# Features:
#   - Common medication registry (Autocomplete source)
#   - Dosage logging (taken_at, dosage_mg)
#   - Family member tracking (who took it, who logged it)
#   - Historical record retrieval with interval calculations

# Retrieves all medication log entries grouped by family member.
# Returns:
#   HashRef: { 'Username' => [ {log1}, {log2} ], ... }
sub DB::get_medication_logs_by_user {
    my ($self) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        SELECT 
            ml.id, 
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
        ORDER BY u1.username ASC, ml.taken_at DESC
    ");
    $sth->execute();
    
    my %grouped;
    while (my $row = $sth->fetchrow_hashref()) {
        push @{$grouped{$row->{family_member}}}, $row;
    }
    return \%grouped;
}

# Logs a new medication dose with an optional custom timestamp.
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
    
    # 3. Insert the log
    my $sql = "INSERT INTO medication_logs (medication_id, family_member_id, logged_by_id, dosage" . ($taken_at ? ", taken_at" : "") . ") VALUES (?, ?, ?, ?" . ($taken_at ? ", ?" : "") . ")";
    my $sth_log = $self->{dbh}->prepare($sql);
    
    my @params = ($med_id, $family_member_id, $logged_by_id, $dosage);
    push @params, $taken_at if $taken_at;
    
    $sth_log->execute(@params);
    return $self->{dbh}->last_insert_id();
}

# Updates an existing medication log entry.
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
    my $sth = $self->{dbh}->prepare("
        UPDATE medication_logs 
        SET medication_id = ?, family_member_id = ?, dosage = ?, taken_at = ? 
        WHERE id = ?
    ");
    return $sth->execute($med_id, $family_member_id, $dosage, $taken_at, $id);
}

# Removes a medication log entry.
# Parameters:
#   id : Unique ID of the log entry
# Returns:
#   Boolean : Success status
sub DB::delete_medication_log {
    my ($self, $id) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("DELETE FROM medication_logs WHERE id = ?");
    return $sth->execute($id) > 0;
}

# Retrieves the registry with usage counts.
sub DB::get_registry_with_stats {
    my ($self) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        SELECT mr.*, COUNT(ml.id) as usage_count 
        FROM medication_registry mr
        LEFT JOIN medication_logs ml ON mr.id = ml.medication_id
        GROUP BY mr.id
        ORDER BY mr.name ASC
    ");
    $sth->execute();
    return $sth->fetchall_arrayref({});
}

# Updates a registry item.
sub DB::update_registry_item {
    my ($self, $id, $name, $dosage) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("UPDATE medication_registry SET name = ?, default_dosage = ? WHERE id = ?");
    return $sth->execute($name, $dosage, $id);
}

# Deletes a registry item only if not in use.
sub DB::delete_registry_item {
    my ($self, $id) = @_;
    $self->ensure_connection;
    
    # Check if used in logs
    my $sth_check = $self->{dbh}->prepare("SELECT COUNT(*) FROM medication_logs WHERE medication_id = ?");
    $sth_check->execute($id);
    my ($count) = $sth_check->fetchrow_array();
    
    return (0, "Cannot delete: Medication has historical logs.") if $count > 0;
    
    my $sth = $self->{dbh}->prepare("DELETE FROM medication_registry WHERE id = ?");
    return ($sth->execute($id), "");
}

# Retrieves unique medications from the registry for autocomplete.
# Returns:
#   ArrayRef of HashRefs (id, name, default_dosage)
sub DB::get_medication_registry {
    my ($self) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT id, name, default_dosage FROM medication_registry ORDER BY name ASC");
    $sth->execute();
    
    return $sth->fetchall_arrayref({});
}

# Retrieves list of family members (all approved users).
# Returns:
#   ArrayRef of HashRefs (id, username)
sub DB::get_medication_members {
    my ($self) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT id, username FROM users WHERE is_family = 1 ORDER BY username ASC");
    $sth->execute();
    
    return $sth->fetchall_arrayref({});
}

1;
