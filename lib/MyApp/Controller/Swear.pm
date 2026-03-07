# /lib/MyApp/Controller/Swear.pm

package MyApp::Controller::Swear;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for managing the Swear Jar financial tracking module.
#
# Features:
#   - Real-time offense reporting and fine tracking.
#   - Individual debt management and jar balance reconciliation.
#   - Administrative roster management (Add/Remove members).
#   - Synchronized state-driven interface architecture.
#
# Integration Points:
#   - Depends on DB::Swear for all financial persistence and roster data.

# Renders the main Swear Jar interface skeleton.
# Route: GET /swear
sub index {
    shift->render('swear');
}

# API Endpoint: Returns the full synchronized state for the module.
# Route: GET /api/swear/state
# Returns: JSON object { success, leaderboard, balance, history, members, is_admin, current_user }
sub api_state {
    my $c = shift;
    
    my $leaderboard = $c->db->get_swear_leaderboard();
    my $balance     = $c->db->get_jar_balance();
    my $history     = $c->db->get_swear_history();
    my $members     = $c->db->get_family_members();

    $c->render(json => {
        success      => 1,
        leaderboard  => $leaderboard,
        balance      => $balance // 0,
        history      => $history,
        members      => $members,
        is_admin     => $c->is_admin ? 1 : 0,
        current_user => $c->session('user') || 'Guest'
    });
}

# API Endpoint: Records a new fine against a user.
# Route: POST /api/swear/add
sub add_fine {
    my $c = shift;

    my $name   = trim($c->param('perpetrator') // '');
    my $amount = trim($c->param('amount') // '');
    my $reason = trim($c->param('reason') // '');

    unless ($name && $amount =~ /^\d+(\.\d{1,2})?$/) {
        return $c->render(json => { success => 0, error => 'Invalid name or amount' });
    }

    eval {
        $c->db->add_swear($name, $amount, $reason);
    };
    
    if ($@) {
        return $c->render(json => { success => 0, error => 'Database failure' });
    }

    return $c->render(json => { success => 1, message => "Fine added for $name (\$$amount)" });
}

# API Endpoint: Records a payment or deposit made by a user.
# Route: POST /api/swear/pay
sub pay_debt {
    my $c = shift;
    
    my $name = trim($c->param('perpetrator') // '');
    my $amount = trim($c->param('amount') // '');
    my $current_user_name = $c->session('user') // 'Guest';

    # Logic: Prevent users from paying their own fines (Self-governance rule)
    if (lc($name) eq lc($current_user_name)) {
        return $c->render(json => { success => 0, error => 'You cannot pay your own fines!' });
    }

    unless ($name && $amount =~ /^\d+(\.\d{1,2})?$/) {
        return $c->render(json => { success => 0, error => 'Invalid payment details' });
    }

    eval {
        $c->db->mark_user_paid($name, $amount, $current_user_name);
    };

    if ($@) {
        return $c->render(json => { success => 0, error => 'Payment failed' });
    }

    return $c->render(json => { success => 1, message => "Payment recorded for $name (\$$amount)" });
}

# API Endpoint: Records a withdrawal from the jar.
# Route: POST /api/swear/spend
sub spend {
    my $c = shift;
    
    my $amount = trim($c->param('amount') // '');
    my $reason = trim($c->param('reason') // '');

    unless ($amount =~ /^\d+(\.\d{1,2})?$/) {
        return $c->render(json => { success => 0, error => 'Invalid amount' });
    }

    eval {
        $c->db->withdraw_from_jar($amount, $reason);
    };

    if ($@) {
        return $c->render(json => { success => 0, error => 'Expenditure failed' });
    }

    return $c->render(json => { success => 1, message => "Spent \$$amount from jar" });
}

# API Endpoint: Registers a new family member to the roster.
# Route: POST /api/swear/member/add
sub add_member {
    my $c = shift;
    
    my $name = trim($c->param('name') // '');
    my $def  = trim($c->param('default_fine') // '2.00');
    
    unless ($name && $def =~ /^\d+(\.\d{1,2})?$/) {
        return $c->render(json => { success => 0, error => "Invalid member details" });
    }
    
    eval { 
        $c->db->add_family_member($name, $def);
    };
    
    if ($@) {
        return $c->render(json => { success => 0, error => "Failed to add member" });
    }

    return $c->render(json => { success => 1, message => "Member '$name' added successfully" });
}

# API Endpoint: Removes a family member from the roster.
# Route: POST /api/swear/member/delete
sub delete_member {
    my $c = shift;
    
    my $id = $c->param('id');
    
    eval {
        $c->db->remove_family_member($id);
    };

    if ($@) {
        return $c->render(json => { success => 0, error => "Removal failed" });
    }

    return $c->render(json => { success => 1, message => "Member removed successfully" });
}

1;
