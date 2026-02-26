# /lib/DB/Swear.pm

package DB::Swear;

use strict;
use warnings;

# Database helper for the "Swear Jar" financial tracking feature.
#
# Features:
#   - Participant administration (Family member roster).
#   - Transaction management (Fines, Payments, Expenditures).
#   - Real-time ledger calculations (Individual debts and Jar balance).
#   - Leaderboard aggregation for family accountability.
#
# Integration Points:
#   - Extends DB package via package injection.
#   - Used by Swear controller for dashboard visualization and ledger updates.
#   - Integrated with Family Pulse AI for financial context analysis.

# Retrieves list of active family members participating in the jar.
# Parameters: None
# Returns:
#   ArrayRef of HashRefs: [ {id, name, default_fine}, ... ]
sub DB::get_family_members {
    my ($self) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Fetch active members (status=1) ordered by name
    my $sth = $self->{dbh}->prepare("SELECT id, name, amount as default_fine FROM swear_ledger WHERE type='member' AND status=1 ORDER BY name ASC");
    $sth->execute();
    
    return $sth->fetchall_arrayref({});
}

# Registers a new family member.
# Parameters:
#   name         : Display name of the member.
#   default_fine : Default fine amount for this user (e.g., 0.50).
# Returns:
#   Result of execute().
sub DB::add_family_member {
    my ($self, $name, $default_fine) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Insert new member record with active status
    my $sth = $self->{dbh}->prepare("INSERT INTO swear_ledger (type, name, amount, status) VALUES ('member', ?, ?, 1)");
    return $sth->execute($name, $default_fine);
}

# Removes a family member from the active list.
# Parameters:
#   id : Unique ID of the member.
# Returns:
#   Result of execute().
sub DB::remove_family_member {
    my ($self, $id) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Soft delete member
    my $sth = $self->{dbh}->prepare("UPDATE swear_ledger SET status=0 WHERE id = ? AND type='member'");
    return $sth->execute($id);
}

# Calculates the "Shame" leaderboard (Unpaid fines).
# Parameters: None
# Returns:
#   ArrayRef of HashRefs: [{ perpetrator => 'Name', total => 10.50 }, ...]
sub DB::get_swear_leaderboard {
    my ($self) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Aggregate unpaid fines
    my $sth = $self->{dbh}->prepare("SELECT name as perpetrator, SUM(amount) as total FROM swear_ledger WHERE type='fine' AND status=0 GROUP BY name ORDER BY total DESC");
    $sth->execute();
    
    return $sth->fetchall_arrayref({});
}

# Logs a new fine for a user.
# Parameters:
#   name   : Name of the perpetrator.
#   amount : Cost of the fine.
#   reason : Context/Reason for the fine.
# Returns:
#   Result of execute().
sub DB::add_swear {
    my ($self, $name, $amount, $reason) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Insert fine record
    my $sth = $self->{dbh}->prepare("INSERT INTO swear_ledger (type, name, amount, reason, status) VALUES ('fine', ?, ?, ?, 0)");
    return $sth->execute($name, $amount, $reason);
}

# Records a payment made by a user (Partial, Full, or Extra/Credit).
# Parameters:
#   name   : Name of the user paying.
#   amount : The monetary value deposited.
# Returns: Void.
sub DB::mark_user_paid {
    my ($self, $name, $amount) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # 1. Record the physical payment entry for the jar history and balance
    my $sth_pay = $self->{dbh}->prepare("INSERT INTO swear_ledger (type, name, amount, reason, status, paid_at) VALUES ('payment', ?, ?, 'Jar Deposit', 1, NOW())");
    $sth_pay->execute($name, $amount);

    # 2. Reconcile the user's unpaid fines
    my $remaining = $amount;
    my $fines = $self->{dbh}->selectall_arrayref(
        "SELECT id, amount FROM swear_ledger WHERE type='fine' AND name=? AND status=0 ORDER BY created_at ASC",
        { Slice => {} }, $name
    );

    foreach my $fine (@$fines) {
        last if $remaining <= 0;
        
        if ($remaining >= $fine->{amount}) {
            $self->{dbh}->do("UPDATE swear_ledger SET status=1, paid_at=NOW() WHERE id=?", undef, $fine->{id});
            $remaining -= $fine->{amount};
        } else {
            last;
        }
    }
}

# Records money taken out of the jar.
# Parameters:
#   amount : Amount removed.
#   reason : Description of expenditure (e.g., "Pizza").
# Returns: Void.
sub DB::withdraw_from_jar {
    my ($self, $amount, $reason) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Log expenditure (status=1 indicates confirmed transaction)
    my $sth = $self->{dbh}->prepare("INSERT INTO swear_ledger (type, name, amount, reason, status) VALUES ('spend', 'JAR', ?, ?, 1)");
    $sth->execute($amount, $reason);
}

# Calculates the current physical balance of the jar.
# Parameters: None
# Returns:
#   Float : (Total Payments - Total Spent).
sub DB::get_jar_balance {
    my ($self) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Calculate Total Revenue (Actual cash deposited)
    my $sth_in = $self->{dbh}->prepare("SELECT SUM(amount) FROM swear_ledger WHERE type='payment'");
    $sth_in->execute();
    my ($total_in) = $sth_in->fetchrow_array();
    $total_in //= 0;
    
    # Calculate Total Expenses (Withdrawals)
    my $sth_out = $self->{dbh}->prepare("SELECT SUM(amount) FROM swear_ledger WHERE type='spend'");
    $sth_out->execute();
    my ($total_out) = $sth_out->fetchrow_array();
    $total_out //= 0;
    
    return $total_in - $total_out;
}

# Retrieves recent ledger activity (Fines, Spends, Payments).
# Parameters: None
# Returns:
#   ArrayRef of HashRefs containing last 20 transactions.
sub DB::get_swear_history {
    my ($self) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Fetch recent history including payments, excluding migration markers
    my $sth = $self->{dbh}->prepare("SELECT id, type, name as perpetrator, amount, reason, created_at FROM swear_ledger WHERE type IN ('fine', 'spend', 'payment') AND reason NOT IN ('Legacy Payment Conversion', 'Legacy Fine Payment') ORDER BY created_at DESC LIMIT 20");
    $sth->execute();
    
    return $sth->fetchall_arrayref({});
}

1;
