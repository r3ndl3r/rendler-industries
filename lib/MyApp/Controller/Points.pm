# /lib/MyApp/Controller/Points.pm

package MyApp::Controller::Points;

use Mojo::Base 'Mojolicious::Controller';
use strict;
use warnings;

# Points Management Controller
# Features:
#   - Administrative dashboard for child point aggregation.
#   - Transaction processing for rewards and deductions.
#   - Multi-channel notification dispatch for ledger updates.

# Returns the standard dashboard view for points administration.
# Route: GET /points
sub index {
    my $c = shift;
    
    # Security: Redirect unauthenticated users
    return $c->redirect_to('/login') unless $c->is_logged_in;
    
    $c->render(template => 'points');
}

# Consolidates point balances and transaction logs for the administrative state.
# Route: GET /points/api/state
# Returns: JSON object { balances, history }
sub api_state {
    my $c = shift;

    # Security Check: Explicit family verification
    unless ($c->is_family) {
        return $c->render(json => { error => 'Unauthorized' }, status => 403);
    }

    my $balances = $c->db->get_child_balances();
    my $history = $c->db->get_global_point_history();

    $c->render(json => {
        balances  => $balances,
        history   => $history,
        is_parent => $c->is_parent ? 1 : 0
    });
}

# Processes point adjustments and dispatches child notifications.
# Route: POST /points/api/add
# Parameters:
#   user_id : Target child identifier
#   amount  : Integer delta
#   reason  : Justification string
sub api_add {
    my $c = shift;

    # Security Check: Explicit parent verification for mutations
    unless ($c->is_parent) {
        return $c->render(json => { error => 'Unauthorized' }, status => 403);
    }

    my $user_id = $c->param('user_id');
    my $amount = int($c->param('amount') // 0);
    my $reason = $c->param('reason');

    if (!$user_id || !$reason || $amount == 0) {
        return $c->render(json => { error => 'Missing required fields or zero amount' }, status => 400);
    }

    # Verify target context: must be a child
    my $target_user = $c->db->get_user_by_id($user_id);
    if (!$target_user || !$target_user->{is_child}) {
        return $c->render(json => { error => 'Invalid target user' }, status => 400);
    }

    # Execute atomic ledger mutation
    if ($c->add_points($user_id, $amount, $reason)) {
        
        # Notify the child using the approved semantic format
        my $formatted_amount = ($amount > 0 ? "+" : "") . $amount;
        my $header = $amount > 0 ? "✨ **Points Reward** ✨" : "⚠️ **Points Deduction** ⚠️";
        
        # Audit Integrity: Include current_user_id for event attribution
        $c->notify_templated($user_id, 'points_adjustment', { 
            header   => $header, 
            amount   => $formatted_amount, 
            reason   => $reason,
            adjuster => $c->session('user') // 'System'
        }, $c->current_user_id);

        # Refresh administrative state for UI synchronization
        my $balances = $c->db->get_child_balances();
        my $history = $c->db->get_global_point_history();

        $c->render(json => {
            success  => 1,
            balances => $balances,
            history  => $history
        });
    } else {
        $c->render(json => { error => 'Database error' }, status => 500);
    }
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{family}->get('/points')->to('points#index');
    $r->{family}->get('/points/api/state')->to('points#api_state');
    $r->{family}->post('/points/api/add')->to('points#api_add');
}

1;
