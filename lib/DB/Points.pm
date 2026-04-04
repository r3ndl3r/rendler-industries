# /lib/DB/Points.pm

package DB::Points;

use strict;
use warnings;

# Points Ledger Management Model
# Features:
#   - Atomic point deposits and withdrawals.
#   - User-specific balance aggregation.
#   - Administrative global transaction auditing.
# Integration Points:
#   - Relies on the 'point_ledger' table for transaction persistence.
#   - Interfaces with Users.pm for child balance calculations.

# Retrieves the net point balance for a specified user.
# Parameters:
#   $self    : DB Instance
#   $user_id : Target User ID
# Returns:
#   Integer representing net balance (0 if no transactions).
sub DB::get_user_points {
    my ($self, $user_id) = @_;
    $self->ensure_connection();

    # SQL-level filtering for the specific user context
    my $sth = $self->{dbh}->prepare("SELECT SUM(amount) AS total FROM point_ledger WHERE user_id = ?");
    $sth->execute($user_id);
    my $row = $sth->fetchrow_hashref();
    return $row->{total} || 0;
}

# Deposits or withdraws points from a user's ledger.
# Parameters:
#   $self    : DB Instance
#   $user_id : Target User ID
#   $amount  : Integer value (positive for addition, negative for deduction)
#   $reason  : String describing the transaction
# Returns:
#   Boolean success state.
sub DB::add_user_points {
    my ($self, $user_id, $amount, $reason) = @_;
    $self->ensure_connection();

    my $sth = $self->{dbh}->prepare("INSERT INTO point_ledger (user_id, amount, reason) VALUES (?, ?, ?)");
    return $sth->execute($user_id, $amount, $reason);
}

# Retrieves the transaction history for a user.
# Parameters:
#   $self    : DB Instance
#   $user_id : Target User ID
# Returns:
#   ArrayRef of transaction hashes.
sub DB::get_point_history {
    my ($self, $user_id) = @_;
    $self->ensure_connection();

    # SQL-level filtering for the specific user context
    my $sth = $self->{dbh}->prepare(
        "SELECT id, amount, reason, created_at 
         FROM point_ledger 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT 50"
    );
    $sth->execute($user_id);
    my @history;
    while (my $row = $sth->fetchrow_hashref()) {
        push @history, $row;
    }
    return \@history;
}

# Retrieves all child balances in a single query (Admin use).
# Returns:
#   ArrayRef of hashes {id, username, current_points}
sub DB::get_child_balances {
    my ($self) = @_;
    $self->ensure_connection();

    my $sth = $self->{dbh}->prepare(
        "SELECT u.id, u.username, IFNULL(SUM(pl.amount), 0) AS current_points 
         FROM users u 
         LEFT JOIN point_ledger pl ON u.id = pl.user_id 
         WHERE u.is_child = 1 AND u.is_admin = 0 
         GROUP BY u.id, u.username"
    );
    $sth->execute();
    
    my @balances;
    while (my $row = $sth->fetchrow_hashref()) {
        push @balances, $row;
    }
    return \@balances;
}

# Retrieves the transaction history for all children (Admin use).
# Returns:
#   ArrayRef of transaction hashes including the username.
sub DB::get_global_point_history {
    my ($self) = @_;
    $self->ensure_connection();

    my $sth = $self->{dbh}->prepare(
        "SELECT pl.id, pl.user_id, u.username, pl.amount, pl.reason, pl.created_at 
         FROM point_ledger pl
         JOIN users u ON pl.user_id = u.id
         WHERE u.is_child = 1 AND u.is_admin = 0
         ORDER BY pl.created_at DESC 
         LIMIT 30"
    );
    $sth->execute();
    
    my @history;
    while (my $row = $sth->fetchrow_hashref()) {
        push @history, $row;
    }
    return \@history;
}

1;
