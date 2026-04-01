# /lib/MyApp/Controller/Chores.pm

package MyApp::Controller::Chores;

use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller mapping the Bounty Board / Chores gamification workflow.
# Features:
#   - Atomic claim transactions for "first come, first serve" bounties.
#   - Global ledger point injection.
#   - Admin quick-assignment mapping.

# Entry point displaying the main chores interface.
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family;
    $c->render('chores');
}

# The single-source-of-truth state generator for UI synchronicity.
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

    my $user_id = $c->current_user_id;
    
    # Base state available for children
    my $state = {
        is_admin       => $c->is_admin ? 1 : 0,
        is_child       => $c->is_child ? 1 : 0,
        current_points => $c->get_points($user_id),
        active_chores  => $c->db->get_active_chores($user_id, $c->is_admin),
        success        => 1
    };

    # Inject extended datasets if the user is a reviewer
    if ($c->is_admin) {
        $state->{all_users}         = $c->db->get_all_users();
        $state->{history}           = $c->db->get_completed_chores_history();
        $state->{quick_add_chores}  = $c->db->get_recent_chore_templates();
        $state->{child_balances}    = $c->db->get_child_balances();
    }

    $c->render(json => $state);
}

# Processes a child actively clicking the `Claim/Done` button for a chore bounty.
# Verifies atomic locking to ensure two children can't pop the same chore at once.
sub api_complete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_child;

    my $chore_id = $c->param('id');
    my $user_id  = $c->current_user_id;

    # Fetch to assert existence and values before mutating database
    my $chore = $c->db->get_chore_by_id($chore_id);
    return $c->render(json => { success => 0, error => 'Chore unavailable' }) unless $chore && $chore->{status} eq 'active';

    # Attempt to atomically lock the row for ourselves
    my $now_str = $c->now->strftime('%Y-%m-%d %H:%M:%S');
    my $claimed = $c->db->claim_chore($chore_id, $user_id, $now_str);
    if ($claimed) {
        # Only dispense points if explicitly mapped > 0
        if ($chore->{points} > 0) {
            my $reason = "Completed Chore: " . $chore->{title};
            $c->add_points($user_id, $chore->{points}, $reason);
            $c->app->log->info("Chores: $user_id scored $chore->{points} points for '$chore->{title}'.");
        }

        my $child_name = $c->session('user') // 'Unknown';
        my $title      = $chore->{title};
        my $pts_val    = $chore->{points};
        my $base_url   = "https://rendler.org/chores";

        my $admin_msg = "✨ **Chore Completed** ✨\n\n$child_name finished: $title (+$pts_val pts)\n\n$base_url";
        
        my $admins = $c->db->get_admins();
        foreach my $adm (@$admins) {
            $c->notify_user($adm->{id}, $admin_msg, "Chore Completed by $child_name");
        }

        $c->render(json => { success => 1, message => 'Job well done!' });
    } else {
        # If rows_affected == 0, someone beat them to it via race condition.
        $c->render(json => { success => 0, error => 'Whoops! Someone else claimed this first!' });
    }
}

# Administrative hook parsing new incoming chores.
sub api_add {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $title       = trim($c->param('title') || '');
    my $points      = int($c->param('points') || 0);
    my $assigned_to = $c->param('assigned_to');

    return $c->render(json => { success => 0, error => 'Title is required' }) unless $title;

    my $new_id;
    eval {
        $new_id = $c->db->add_chore($title, $points, $assigned_to);
    };
    if ($@) {
        $c->app->log->error("Failed chore creation: $@");
        return $c->render(json => { success => 0, error => 'Database Error' });
    }

    # Notify targets about the new bounty
    if ($new_id) {
        my $base_url = "https://rendler.org/chores"; # Deep link for quick access
        
        if ($assigned_to) {
            my $msg = "✨ **New Chore** ✨\n\n👤 **YOUR CHORE** 👤\n\n$title (+$points pts)\n\n$base_url";
            $c->notify_user($assigned_to, $msg, "New Chore Assigned");
        } else {
            my $msg = "✨ **New Chore** ✨\n\n🌍 **GLOBAL CHORE** 🌍\n\n$title (+$points pts)\n\n*First to finish and mark as done gets the points!*\n\n$base_url";
            # Broadcast to all children for global pool chores
            my $all_users = $c->db->get_all_users();
            foreach my $u (@$all_users) {
                if ($u->{is_child} && !$u->{is_admin}) {
                    $c->notify_user($u->{id}, $msg, "New Global Chore Available");
                }
            }
        }
    }

    $c->render(json => { success => 1 });
}

# Administrative hook revoking a completion status, docking any rewarded points.
sub api_revoke {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $chore_id = $c->param('id');
    my $chore = $c->db->get_chore_by_id($chore_id);
    
    return $c->render(json => { success => 0, error => 'Not found' }) unless $chore;

    if ($chore->{status} eq 'completed') {
        # Remove the previously rewarded points
        if ($chore->{points} > 0 && $chore->{completed_by}) {
            my $reason = "Revoked Chore: " . $chore->{title};
            # Subtract points (apply negative)
            $c->add_points($chore->{completed_by}, -$chore->{points}, $reason);
            $c->app->log->info("Chores: Deducted $chore->{points} points from $chore->{completed_by} (Revocation).");
        }
        # Throw back into active pool
        $c->db->reset_chore($chore_id);
    }
    
    $c->render(json => { success => 1 });
}

# Administrative hook permanently deleting a chore from the active pool.
sub api_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $chore_id = $c->param('id');
    my $chore = $c->db->get_chore_by_id($chore_id);
    
    return $c->render(json => { success => 0, error => 'Not found' }) unless $chore;

    $c->db->delete_chore($chore_id);
    $c->app->log->info(sprintf("Chores: Admin %s deleted chore %d ('%s').", $c->session('user') // 'Unknown', $chore_id, $chore->{title}));
    
    $c->render(json => { success => 1 });
}

1;
