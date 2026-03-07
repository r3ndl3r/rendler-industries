# /lib/MyApp/Controller/Meals.pm

package MyApp::Controller::Meals;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for the Family Meal Planner.
# Features:
#   - 4-day rolling meal plan schedule with automated window generation.
#   - Collaborative meal suggestions with integrated vault autocomplete.
#   - Toggled per-day voting with strict "one vote per user" enforcement.
#   - Ownership-based suggestion management (Edit/Delete).
#   - Admin-level overrides for lock-ins, blackouts, and global vault management.
# Integration points:
#   - Restricted to authenticated family members via bridge logic.
#   - Depends on DB::Meals for state persistence and aggregated voter data.
#   - Coordinates with System::maintenance for 2PM auto-lock and Discord reminders.

# Renders the main meal planner dashboard interface.
# Route: GET /meals
# Parameters: None
# Returns: Rendered HTML template 'meals'.
sub index {
    my $c = shift;
    $c->stash(title => 'Meal Planner');
    $c->render('meals');
}

# Returns the current state for the module.
# Route: GET /meals/api/state
# Parameters: None
# Returns: JSON object { plan, vault, is_admin, current_user_id, success }
sub api_state {
    my $c     = shift;
    my $uid   = $c->current_user_id;
    
    my $state = {
        plan            => $c->db->get_active_plan($uid),
        vault           => $c->db->get_meal_vault,
        is_admin        => $c->is_admin ? 1 : 0,
        current_user_id => $uid,
        success         => 1
    };

    $c->render(json => $state);
}

# Submits a new meal suggestion for a specific plan day.
# Route: POST /meals/api/suggest
# Parameters:
#   plan_id   : Target day identifier
#   meal_name : Name of the proposed meal
# Returns: JSON object { success, message, error }
sub suggest {
    my $c         = shift;
    my $plan_id   = $c->param('plan_id');
    my $meal_name = trim($c->param('meal_name') // '');
    my $uid       = $c->current_user_id;

    unless ($plan_id && $meal_name) {
        return $c->render(json => { success => 0, error => 'Missing fields' });
    }

    my $result = $c->db->add_suggestion($plan_id, $meal_name, $uid);
    
    # Notifications: Dispatch Discord alerts to other eligible family members
    if ($result->{success}) {
        $result->{message} //= "Suggestion added!";
        my $user = $c->db->get_user_by_id($uid);
        my $username = $user ? $user->{username} : 'Someone';
        my $msg = "🍳 NEW MEAL SUGGESTION: $username suggested '$meal_name' for today!\n\nhttps://rendler.org/meals";
        
        my $all_users = $c->db->get_all_users();
        foreach my $u (@$all_users) {
            if ($u->{discord_id} && $u->{id} != $uid && ($u->{is_family} || $u->{is_admin})) {
                $c->send_discord_dm($u->{discord_id}, $msg);
            }
        }
    }

    $c->render(json => $result);
}

# Toggles a user's vote for a specific suggestion.
# Route: POST /meals/api/vote
# Parameters:
#   suggestion_id : Target suggestion identifier
# Returns: JSON object { success, voted, removed_meal_name, message }
sub vote {
    my $c             = shift;
    my $suggestion_id = $c->param('suggestion_id');
    my $uid           = $c->current_user_id;

    unless ($suggestion_id) {
        return $c->render(json => { success => 0, error => 'Missing suggestion ID' });
    }

    my $result = $c->db->cast_vote($suggestion_id, $uid);
    
    if ($result->{success}) {
        if ($result->{voted}) {
            $result->{message} = $result->{removed_meal_name} 
                ? "Vote moved to new meal!" 
                : "Vote cast!";
        } else {
            $result->{message} = "Vote removed";
        }
    }

    $c->render(json => $result);
}

# Updates the metadata for an existing suggestion.
# Route: POST /meals/api/edit_suggestion
# Parameters:
#   suggestion_id : Target identifier
#   meal_name     : Updated meal name
# Returns: JSON object { success, message, error }
sub edit_suggestion {
    my $c             = shift;
    my $suggestion_id = $c->param('suggestion_id');
    my $meal_name     = trim($c->param('meal_name') // '');
    my $uid           = $c->current_user_id;

    unless ($suggestion_id && $meal_name) {
        return $c->render(json => { success => 0, error => 'Missing fields' });
    }

    my $result = $c->db->update_suggestion($suggestion_id, $meal_name, $uid, $c->is_admin);
    if ($result->{success}) {
        $result->{message} //= "Suggestion updated";
    }
    $c->render(json => $result);
}

# Permanently removes a meal suggestion.
# Route: POST /meals/api/delete_suggestion
# Parameters:
#   suggestion_id : Target identifier
# Returns: JSON object { success, message, error }
sub delete_suggestion {
    my $c             = shift;
    my $suggestion_id = $c->param('suggestion_id');
    my $uid           = $c->current_user_id;

    unless ($suggestion_id) {
        return $c->render(json => { success => 0, error => 'Missing suggestion ID' });
    }

    my $result = $c->db->delete_suggestion($suggestion_id, $uid, $c->is_admin);
    if ($result->{success}) {
        $result->{message} //= "Suggestion removed";
    }
    $c->render(json => $result);
}

# Admin: Orchestrates lock-in or blackout events for specific days.
# Route: POST /meals/api/admin/lock
# Parameters:
#   plan_id       : Target day identifier
#   suggestion_id : Winner identifier (Optional)
#   blackout      : Reason text (Optional)
#   unlock        : Reset flag (Optional)
# Returns: JSON object { success, message, error }
sub admin_lock {
    my $c             = shift;
    return $c->render(json => { error => 'Forbidden' }, status => 403) unless $c->is_admin;

    my $plan_id       = $c->param('plan_id');
    my $suggestion_id = $c->param('suggestion_id');
    my $blackout      = trim($c->param('blackout') // '');
    my $unlock        = $c->param('unlock') // 0;

    my $msg = "Day updated";
    if ($unlock) {
        $c->db->unlock_day($plan_id);
        $msg = "Day unlocked";
    } elsif ($blackout) {
        $c->db->set_blackout($plan_id, $blackout);
        $msg = "Blackout set";
    } else {
        $c->db->lock_suggestion($plan_id, $suggestion_id);
        $msg = "Meal locked in";
    }

    $c->render(json => { success => 1, message => $msg });
}

# Admin API: Retrieves the high-density meal registry.
# Route: GET /meals/api/vault
# Parameters: None
# Returns: JSON object { meals }
sub get_vault_data {
    my $c = shift;
    return $c->render(json => { error => 'Forbidden' }, status => 403) unless $c->is_admin;
    
    my $meals = $c->db->get_full_meal_vault();
    $c->render(json => { meals => $meals });
}

# Admin API: Direct registration of a meal into the global vault.
# Route: POST /meals/api/vault/add
# Parameters:
#   name : Meal name
# Returns: JSON object { success, message, error }
sub add_meal_to_vault {
    my $c     = shift;
    return $c->render(json => { error => 'Forbidden' }, status => 403) unless $c->is_admin;

    my $name  = trim($c->param('name') // '');
    
    unless ($name) {
        return $c->render(json => { success => 0, error => 'Meal name is required' });
    }

    if ($c->db->add_meal_to_vault($name)) {
        $c->render(json => { success => 1, message => "Meal added." });
    } else {
        $c->render(json => { success => 0, error => "Failed to add meal." });
    }
}

# Admin API: Modification of vault entry metadata.
# Route: POST /meals/api/vault/update
# Parameters:
#   id   : Vault entry identifier
#   name : Updated meal name
# Returns: JSON object { success, message, error }
sub update_meal_in_vault {
    my $c     = shift;
    return $c->render(json => { error => 'Forbidden' }, status => 403) unless $c->is_admin;

    my $id    = $c->param('id');
    my $name  = trim($c->param('name') // '');
    
    if ($c->db->update_meal_in_vault($id, $name)) {
        $c->render(json => { success => 1, message => "Meal updated." });
    } else {
        $c->render(json => { success => 0, error => "Update failed." });
    }
}

# Admin API: Permanent removal of a meal from the global registry.
# Route: POST /meals/api/vault/delete
# Parameters:
#   id : Target identifier
# Returns: JSON object { success, message, error }
sub delete_meal_from_vault {
    my $c  = shift;
    return $c->render(json => { error => 'Forbidden' }, status => 403) unless $c->is_admin;

    my $id = $c->param('id');
    
    if ($c->db->delete_meal_from_vault($id)) {
        $c->render(json => { success => 1, message => "Meal removed." });
    } else {
        $c->render(json => { success => 0, error => "Delete failed." });
    }
}

1;
