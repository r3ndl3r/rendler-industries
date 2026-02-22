# /lib/DB/SwearJar.pm

package DB::SwearJar;

use strict;
use warnings;

# Database helper for the "Swear Jar" financial tracking feature.
# Features:
#   - Manage participants (Family members)
#   - Track fines (Debts) and Payments (Revenue)
#   - Track withdrawals/expenditures (Expenses)
#   - Calculate real-time jar balance and leaderboards
# Integration points:
#   - Extends DB package via package injection
#   - Uses a single polymorphic table 'swear_ledger' for members, fines, and spending

# Inject methods into the main DB package

# Retrieves list of active family members participating in the jar.
# Parameters: None
# Returns:
#   ArrayRef of HashRefs containing member details (id, name, default_fine)
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
#   name         : Display name of the member
#   default_fine : Default fine amount for this user (e.g., 0.50)
# Returns:
#   Result of execute() (true on success)
sub DB::add_family_member {
    my ($self, $name, $default_fine) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Insert new member record with active status
    my $sth = $self->{dbh}->prepare("INSERT INTO swear_ledger (type, name, amount, status) VALUES ('member', ?, ?, 1)");
    $sth->execute($name, $default_fine);
}

# Removes a family member from the active list.
# Parameters:
#   id : Unique ID of the member
# Returns:
#   Result of execute() (true on success)
# Behavior:
#   - Performs a "Soft Delete" by setting status to 0
#   - Preserves historical fine data associated with the name
sub DB::remove_family_member {
    my ($self, $id) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Soft delete member
    my $sth = $self->{dbh}->prepare("UPDATE swear_ledger SET status=0 WHERE id = ? AND type='member'");
    $sth->execute($id);
}

# Calculates the "Shame" leaderboard (Unpaid fines).
# Parameters: None
# Returns:
#   ArrayRef of HashRefs: [{ perpetrator => 'Name', total => 10.50 }, ...]
# Behavior:
#   - Aggregates all unpaid fines (status=0) grouped by user
#   - Sorts by highest debt first
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
#   name   : Name of the perpetrator
#   amount : Cost of the fine
#   reason : Context/Reason for the fine
# Returns:
#   Result of execute() (true on success)
# Note: Fines default to status=0 (Unpaid) for historical consistency
sub DB::add_swear {
    my ($self, $name, $amount, $reason) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Insert fine record
    my $sth = $self->{dbh}->prepare("INSERT INTO swear_ledger (type, name, amount, reason, status) VALUES ('fine', ?, ?, ?, 0)");
    $sth->execute($name, $amount, $reason);
}

# Records a payment made by a user (Partial, Full, or Extra/Credit).
# Parameters:
#   name   : Name of the user paying
#   amount : The monetary value deposited
# Returns:
#   Result of execute() (true on success)
sub DB::mark_user_paid {
    my ($self, $name, $amount) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # 1. Record the physical payment entry for the jar history and balance
    my $sth_pay = $self->{dbh}->prepare("INSERT INTO swear_ledger (type, name, amount, reason, status, paid_at) VALUES ('payment', ?, ?, 'Jar Deposit', 1, NOW())");
    $sth_pay->execute($name, $amount);

    # 2. Reconcile the user's unpaid fines
    # We iterate through their unpaid fines and mark them as paid (status=1) 
    # until the payment amount is exhausted.
    my $remaining = $amount;
    my $fines = $self->{dbh}->selectall_arrayref(
        "SELECT id, amount FROM swear_ledger WHERE type='fine' AND name=? AND status=0 ORDER BY created_at ASC",
        { Slice => {} }, $name
    );

    foreach my $fine (@$fines) {
        last if $remaining <= 0;
        
        if ($remaining >= $fine->{amount}) {
            # Full payment for this fine
            $self->{dbh}->do("UPDATE swear_ledger SET status=1, paid_at=NOW() WHERE id=?", undef, $fine->{id});
            $remaining -= $fine->{amount};
        } else {
            # Partial payment for this fine: 
            # In our current schema, we can't "split" a fine easily without creating new rows.
            # For simplicity, if they paid most of it, we mark it paid, or just leave it unpaid 
            # if they paid very little.
            # BETTER: We only mark a fine paid if it's fully covered by this or prior payments.
            # Since our leaderboard uses SUM(status=0), we can just stop here.
            last;
        }
    }
}

# Records money taken out of the jar.
# Parameters:
#   amount : Amount removed
#   reason : Description of expenditure (e.g., "Pizza")
# Returns:
#   Result of execute() (true on success)
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
#   Float (Total Payments - Total Spent)
# Logic:
#   - Balance = (Sum of Payments) - (Sum of Withdrawals)
sub DB::get_jar_balance {
    my ($self) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Calculate Total Revenue (Actual cash deposited)
    # We include all payments here, as they represent physical cash in the jar.
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
#   ArrayRef of HashRefs containing last 20 transactions
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