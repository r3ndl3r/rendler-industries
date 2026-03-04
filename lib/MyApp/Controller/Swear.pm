# /lib/MyApp/Controller/Swear.pm

package MyApp::Controller::Swear;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for the "Swear Jar" financial tracking feature.
# Features:
#   - Public dashboard with leaderboards and transaction history
#   - Transaction management (Issuing fines, recording payments, logging spending)
#   - Participant administration (Family member roster)
# Integration points:
#   - Depends on authentication context for write operations
#   - Uses DB::SwearJar helpers for ledger persistence

# Renders the main Swear Jar dashboard.
# Route: GET /swear
# Parameters: None
# Returns:
#   Rendered HTML template 'swear/swear' with:
#     - leaderboard: Aggregated debt stats
#     - jar_balance: Current cash in hand
#     - history: Recent transaction log
#     - members: Active participants
sub index {
    my $c = shift;
    
    # Retrieve aggregate data for dashboard visualization
    my $leaderboard = $c->db->get_swear_leaderboard();
    my $jar_balance = $c->db->get_jar_balance();
    my $history     = $c->db->get_swear_history();
    
    # Retrieve roster for form selection
    my $members     = $c->db->get_family_members(); 

    $c->stash(
        leaderboard  => $leaderboard,
        jar_balance  => $jar_balance,
        history      => $history,
        members      => $members,
        is_logged_in => $c->is_logged_in
    );
    
    $c->render('swear/swear');
}

# Records a new fine against a user.
# Route: POST /swear/add
# Parameters:
#   perpetrator : Name of the family member
#   amount      : Monetary value (Decimal, e.g., 1.50)
#   reason      : Context for the fine
# Returns:
#   JSON response
sub add_fine {
    my $c = shift;

    my $name   = trim($c->param('perpetrator') // '');
    my $amount = trim($c->param('amount') // '');
    my $reason = trim($c->param('reason') // '');

    unless ($name && $amount =~ /^\d+(\.\d{1,2})?$/) {
        return $c->render(json => { success => 0, error => 'Invalid Name or Amount' });
    }

    $c->db->add_swear($name, $amount, $reason);
    return $c->render(json => { success => 1, message => "Fine added for $name (\$$amount)" });
}

# Records a payment/deposit made by a user.
# Route: POST /swear/pay
# Parameters:
#   perpetrator : Name of the user clearing their debt
#   amount      : Amount deposited
# Returns:
#   JSON response
sub pay_debt {
    my $c = shift;
    
    my $name = trim($c->param('perpetrator') // '');
    my $amount = trim($c->param('amount') // '');
    my $current_user_name = $c->current_user->{username} // 'Unknown';

    # Logic: Prevent users from paying their own fines
    if ($name eq $current_user_name) {
        return $c->render(json => { success => 0, error => 'You cannot pay your own fines!' });
    }

    if ($name && $amount =~ /^\d+(\.\d{1,2})?$/) {
        $c->db->mark_user_paid($name, $amount, $current_user_name);
        return $c->render(json => { success => 1, message => "Payment recorded for $name (\$$amount)" });
    } else {
        return $c->render(json => { success => 0, error => 'Invalid payment details' });
    }
}

# Records a withdrawal from the jar balance.
# Route: POST /swear/spend
# Parameters:
#   amount : Monetary value to withdraw
#   reason : Description of expenditure
# Returns:
#   JSON response
sub spend {
    my $c = shift;
    
    my $amount = trim($c->param('amount') // '');
    my $reason = trim($c->param('reason') // '');

    if ($amount =~ /^\d+(\.\d{1,2})?$/) {
        $c->db->withdraw_from_jar($amount, $reason);
        return $c->render(json => { success => 1, message => "Spent \$$amount from jar" });
    } else {
        return $c->render(json => { success => 0, error => 'Invalid amount' });
    }
}

# Registers a new family member to the roster.
# Route: POST /swear/member/add
# Parameters:
#   name         : Display name
#   default_fine : Default fine amount (defaults to 2.00)
# Returns:
#   JSON response
sub add_member {
    my $c = shift;
    
    my $name = trim($c->param('name') // '');
    my $def  = trim($c->param('default_fine') // '2.00');
    
    if ($name && $def =~ /^\d+(\.\d{1,2})?$/) {
        eval { 
            $c->db->add_family_member($name, $def);
        };
        if ($@) {
            return $c->render(json => { success => 0, error => "Failed to add member" });
        }
        return $c->render(json => { success => 1, message => "Member '$name' added successfully" });
    } else {
        return $c->render(json => { success => 0, error => "Invalid member details" });
    }
}

# Removes a family member from the roster.
# Route: POST /swear/member/delete
# Parameters:
#   id : Unique Member ID
# Returns:
#   JSON response
sub delete_member {
    my $c = shift;
    
    my $id = $c->param('id');
    
    $c->db->remove_family_member($id);
    return $c->render(json => { success => 1, message => "Member removed successfully" });
}

1;