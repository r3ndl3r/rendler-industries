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
#
# Integration points:
#   - Restricted to authenticated family members via bridge logic.
#   - Depends on DB::Meals for state persistence and aggregated voter data.
#   - Coordinates with System::maintenance for 2PM auto-lock and Discord reminders.

# Renders the main meal planner dashboard or returns JSON data for SPA syncing.
# Route: GET /meals
# Parameters: None
# Returns:
#   - HTML: Rendered 'meals' template.
#   - JSON: { plan, vault } for XMLHttpRequest.
sub index {
    my $c     = shift;
    my $uid   = $c->current_user_id;
    my $plan  = $c->db->get_active_plan($uid);
    my $vault = $c->db->get_meal_vault;

    unless ($plan && scalar @$plan) {
        return $c->render(text => 'Plan is empty. DB error?', status => 500);
    }

    if ($c->req->headers->header('X-Requested-With') && $c->req->headers->header('X-Requested-With') eq 'XMLHttpRequest') {
        return $c->render(json => { plan => $plan, vault => $vault });
    }

    $c->render('meals', plan => $plan, vault => $vault);
}

# Submits a new meal suggestion for a specific plan day.
# Route: POST /meals/suggest
# Parameters:
#   - plan_id: Target day ID.
#   - meal_name: Name of the proposed meal.
# Returns: JSON status object.
sub suggest {
    my $c         = shift;
    my $plan_id   = $c->param('plan_id');
    my $meal_name = trim($c->param('meal_name') // '');
    my $uid       = $c->current_user_id;

    unless ($plan_id && $meal_name) {
        return $c->render(json => { success => 0, error => 'Missing fields' });
    }

    my $result = $c->db->add_suggestion($plan_id, $meal_name, $uid);
    $c->render(json => $result);
}

# Toggles a user's vote for a specific suggestion.
# Route: POST /meals/vote
# Parameters:
#   - suggestion_id: Target suggestion.
# Returns: JSON { success, voted (boolean) }.
sub vote {
    my $c             = shift;
    my $suggestion_id = $c->param('suggestion_id');
    my $uid           = $c->current_user_id;

    unless ($suggestion_id) {
        return $c->render(json => { success => 0, error => 'Missing suggestion ID' });
    }

    my $result = $c->db->cast_vote($suggestion_id, $uid);
    $c->render(json => $result);
}

# Updates the meal name on an existing suggestion. Verified for ownership or admin.
# Route: POST /meals/edit_suggestion
# Parameters:
#   - suggestion_id: ID of the suggestion.
#   - meal_name: New meal name.
# Returns: JSON status object.
sub edit_suggestion {
    my $c             = shift;
    my $suggestion_id = $c->param('suggestion_id');
    my $meal_name     = trim($c->param('meal_name') // '');
    my $uid           = $c->current_user_id;

    unless ($suggestion_id && $meal_name) {
        return $c->render(json => { success => 0, error => 'Missing fields' });
    }

    my $result = $c->db->update_suggestion($suggestion_id, $meal_name, $uid, $c->is_admin);
    $c->render(json => $result);
}

# Deletes a meal suggestion. Verified for ownership or admin.
# Route: POST /meals/delete_suggestion
# Parameters:
#   - suggestion_id: ID of target suggestion.
# Returns: JSON status object.
sub delete_suggestion {
    my $c             = shift;
    my $suggestion_id = $c->param('suggestion_id');
    my $uid           = $c->current_user_id;

    unless ($suggestion_id) {
        return $c->render(json => { success => 0, error => 'Missing suggestion ID' });
    }

    my $result = $c->db->delete_suggestion($suggestion_id, $uid, $c->is_admin);
    $c->render(json => $result);
}

# Admin: Manually locks in a suggestion or sets a blackout for the day.
# Route: POST /meals/admin/lock
# Parameters:
#   - plan_id: Target day ID.
#   - suggestion_id: Winner ID (optional if blackout).
#   - blackout: Reason text (optional if locking).
# Returns: JSON status object.
sub admin_lock {
    my $c             = shift;
    return $c->render(json => { error => 'Forbidden' }, status => 403) unless $c->is_admin;

    my $plan_id       = $c->param('plan_id');
    my $suggestion_id = $c->param('suggestion_id');
    my $blackout      = trim($c->param('blackout') // '');

    if ($blackout) {
        $c->db->set_blackout($plan_id, $blackout);
    } else {
        $c->db->lock_suggestion($plan_id, $suggestion_id);
    }

    $c->render(json => { success => 1 });
}

# Admin API: Retrieves the full meal vault for the management table.
# Route: GET /meals/api/vault
# Parameters: None
# Returns: JSON object { meals }.
sub get_vault_data {
    my $c = shift;
    return $c->render(json => { error => 'Forbidden' }, status => 403) unless $c->is_admin;
    
    my $meals = $c->db->get_full_meal_vault();
    $c->render(json => { meals => $meals });
}

# Admin API: Adds a new meal directly to the global vault.
# Route: POST /meals/api/vault/add
# Parameters:
#   - name: Meal name.
# Returns: JSON status object.
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

# Admin API: Updates a meal name in the vault.
# Route: POST /meals/api/vault/update
# Parameters:
#   - id: Vault entry ID.
#   - name: New meal name.
# Returns: JSON status object.
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

# Admin API: Permanently removes a meal from the vault.
# Route: POST /meals/api/vault/delete
# Parameters:
#   - id: Vault entry ID.
# Returns: JSON status object.
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
