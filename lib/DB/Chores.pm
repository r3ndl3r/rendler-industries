# /lib/DB/Chores.pm

package DB::Chores;

use strict;
use warnings;

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

    my $query = "SELECT c.id, c.title, c.points, c.assigned_to, u.username as assigned_username, c.created_at
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

# Processes an atomic claim on a chore to prevent double-dipping.
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
         WHERE id = ? AND status = 'active'"
    );
    my $rows_affected = $sth->execute($user_id, $completed_at, $chore_id);
    
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
        "SELECT c.title, c.points, c.assigned_to, u.username as assigned_username
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
        "SELECT c.id, c.title, c.points, c.completed_at, c.completed_by, u.username as completed_by_name
         FROM chores c
         LEFT JOIN users u ON c.completed_by = u.id
         WHERE c.status = 'completed'
         ORDER BY c.completed_at DESC 
         LIMIT 50"
    );
    $sth->execute();
    
    my @history;
    while (my $row = $sth->fetchrow_hashref()) {
        push @history, $row;
    }
    return \@history;
}

# Finds a specific chore by ID.
sub DB::get_chore_by_id {
    my ($self, $chore_id) = @_;
    $self->ensure_connection();
    my $sth = $self->{dbh}->prepare("SELECT * FROM chores WHERE id = ?");
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

# Identifies chores older than 1 hour without a recent reminder. 
# Touches last_reminded_at for standard Mojo idempotency.
sub DB::get_stale_chores_and_mark {
    my $self = shift;
    $self->ensure_connection();

    my $sth = $self->{dbh}->prepare(
        "SELECT c.id, c.title, c.points, c.assigned_to, u.username as target_user
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
