# /lib/DB/Meals.pm

package DB::Meals;

use strict;
use warnings;

# Database Library for the Family Meal Planner.
#
# Features:
#   - Meal vault management (unique meal names for autocomplete).
#   - 4-day rolling meal plan schedule with automated window generation.
#   - Collaborative suggestion and vote tracking with toggled state.
#   - Admin lock-in and blackout day management.
#   - Privacy Mandate: Family-level resource; plans and suggestions are shared across authorized members.
#
# Integration Points:
#   - Extends the core DB package via package injection.
#   - Acts as the primary data source for the Meals controller.
#   - Provides data payloads for SPA state-driven synchronization.
#   - Coordinates with System controller for maintenance-driven automation.

# Ensures the meal plan entries exist for today and the next 3 days.
# Parameters: None
# Returns: Void
sub DB::ensure_meal_plan_window {
    my $self = shift;
    $self->ensure_connection;

    for (0..3) {
        my $sql = "INSERT IGNORE INTO meal_plan (plan_date) VALUES (DATE_ADD(CURDATE(), INTERVAL ? DAY))";
        $self->{dbh}->do($sql, undef, $_);
    }
}

# Retrieves the 4-day meal plan with aggregated suggestions and vote counts.
# Parameters: 
#   - user_id: ID of the current user (for voted state tracking).
# Returns:
#   ArrayRef of HashRefs containing schedule and nested suggestion data.
sub DB::get_active_plan {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    $self->ensure_meal_plan_window();

    my $sql = q{
        SELECT
            p.id, p.plan_date, p.status, p.final_suggestion_id, p.blackout_reason,
            DATE_FORMAT(p.plan_date, '%W, %b %D') as formatted_date
        FROM meal_plan p
        WHERE p.plan_date >= CURDATE()
        ORDER BY p.plan_date ASC
        LIMIT 4
    };

    my $plan = $self->{dbh}->selectall_arrayref($sql, { Slice => {} });

    foreach my $day (@$plan) {
        $day->{suggestions} = $self->get_suggestions_for_day($day->{id}, $user_id);
        $day->{user_has_suggested} = (grep { $_->{suggested_by_id} == $user_id } @{$day->{suggestions}}) ? 1 : 0;
    }

    return $plan;
}

# Retrieves all suggestions and their vote metadata for a specific plan day.
# Parameters:
#   - plan_id: ID of the target day.
#   - user_id: ID of the current user.
# Returns:
#   ArrayRef of HashRefs with meal details, vote counts, and voter names.
sub DB::get_suggestions_for_day {
    my ($self, $plan_id, $user_id) = @_;

    my $sql = q{
        SELECT
            s.id, s.meal_id, s.suggested_by as suggested_by_id, m.name as meal_name, u.username as suggested_by_name,
            (SELECT COUNT(*) FROM meal_votes v WHERE v.suggestion_id = s.id) as vote_count,
            (SELECT COUNT(*) FROM meal_votes v WHERE v.suggestion_id = s.id AND v.user_id = ?) as user_voted,
            (SELECT GROUP_CONCAT(u2.username ORDER BY u2.username SEPARATOR ',')
             FROM meal_votes v2
             JOIN users u2 ON v2.user_id = u2.id
             WHERE v2.suggestion_id = s.id) as voter_names
        FROM meal_suggestions s
        JOIN meals m ON s.meal_id = m.id
        JOIN users u ON s.suggested_by = u.id
        WHERE s.plan_id = ?
        ORDER BY vote_count DESC, s.suggested_at ASC
    };

    my $rows = $self->{dbh}->selectall_arrayref($sql, { Slice => {} }, $user_id, $plan_id);

    for my $row (@$rows) {
        $row->{voters} = $row->{voter_names} ? [ split /,/, $row->{voter_names} ] : [];
    }

    return $rows;
}

# Toggles a user's vote for a suggestion (adds if missing, removes if present).
# Rule: Replaces any previous vote by the same user for the same plan day.
# Parameters:
#   - suggestion_id: Target suggestion.
#   - user_id: Voting user.
# Returns: HashRef { success, voted (boolean state), removed_meal_name (optional) }.
sub DB::cast_vote {
    my ($self, $suggestion_id, $user_id) = @_;
    $self->ensure_connection;

    my ($plan_id) = $self->{dbh}->selectrow_array(
        "SELECT plan_id FROM meal_suggestions WHERE id = ?", undef, $suggestion_id
    );
    return undef unless $plan_id;

    my ($status) = $self->{dbh}->selectrow_array(
        "SELECT status FROM meal_plan WHERE id = ?", undef, $plan_id
    );
    return { error => "Day is locked" } if $status eq 'locked';

    # Start Transaction for atomicity
    $self->{dbh}->begin_work;

    my $result;
    eval {
        my ($already_voted) = $self->{dbh}->selectrow_array(
            "SELECT COUNT(*) FROM meal_votes WHERE suggestion_id = ? AND user_id = ?",
            undef, $suggestion_id, $user_id
        );

        if ($already_voted) {
            $self->{dbh}->do(
                "DELETE FROM meal_votes WHERE suggestion_id = ? AND user_id = ?",
                undef, $suggestion_id, $user_id
            );
            $result = { success => 1, voted => 0 };
        } else {
            # Find previous vote for this day to return its name
            my ($prev_meal_name) = $self->{dbh}->selectrow_array(
                q{SELECT m.name FROM meal_votes v 
                  JOIN meal_suggestions s ON v.suggestion_id = s.id 
                  JOIN meals m ON s.meal_id = m.id 
                  WHERE s.plan_id = ? AND v.user_id = ?},
                undef, $plan_id, $user_id
            );

            my $delete_sql = q{
                DELETE v FROM meal_votes v
                JOIN meal_suggestions s ON v.suggestion_id = s.id
                WHERE s.plan_id = ? AND v.user_id = ?
            };
            $self->{dbh}->do($delete_sql, undef, $plan_id, $user_id);

            # INSERT IGNORE to handle race condition/button mash gracefully
            $self->{dbh}->do(
                "INSERT IGNORE INTO meal_votes (suggestion_id, user_id) VALUES (?, ?)",
                undef, $suggestion_id, $user_id
            );

            $result = { 
                success => 1, 
                voted => 1, 
                removed_meal_name => $prev_meal_name 
            };
        }
        $self->{dbh}->commit;
    };

    if ($@) {
        $self->{dbh}->rollback;
        die "Vote transaction failed: $@";
    }

    return $result;
}

# Adds a meal suggestion for a plan day, upserting the meal into the vault.
# Parameters:
#   - plan_id: Target day ID.
#   - meal_name: Name of the meal.
#   - user_id: Suggester ID.
# Returns: HashRef { success } or { error }.
sub DB::add_suggestion {
    my ($self, $plan_id, $meal_name, $user_id) = @_;
    $self->ensure_connection;
    
    # Enforce Title Case
    $meal_name = join ' ', map { ucfirst lc } split /\s+/, $meal_name;

    my ($status) = $self->{dbh}->selectrow_array(
        "SELECT status FROM meal_plan WHERE id = ?", undef, $plan_id
    );
    return { error => 'Day is locked' } if $status eq 'locked';

    $self->{dbh}->do("INSERT IGNORE INTO meals (name) VALUES (?)", undef, $meal_name);
    my ($meal_id) = $self->{dbh}->selectrow_array(
        "SELECT id FROM meals WHERE name = ?", undef, $meal_name
    );

    eval {
        $self->{dbh}->do(
            "INSERT INTO meal_suggestions (plan_id, meal_id, suggested_by) VALUES (?, ?, ?)",
            undef, $plan_id, $meal_id, $user_id
        );
        
        my ($new_suggestion_id) = $self->{dbh}->selectrow_array(
            "SELECT id FROM meal_suggestions WHERE plan_id = ? AND meal_id = ? AND suggested_by = ?",
            undef, $plan_id, $meal_id, $user_id
        );
        $self->cast_vote($new_suggestion_id, $user_id) if $new_suggestion_id;
    };

    if ($@) {
        return { error => "Meal already suggested for this day" };
    }

    return { success => 1 };
}

# Admin: Locks in a specific suggestion as the final choice for a plan day.
# Parameters:
#   - plan_id: Target day ID.
#   - suggestion_id: Winning suggestion.
# Returns: Boolean result of DBI execution.
sub DB::lock_suggestion {
    my ($self, $plan_id, $suggestion_id) = @_;
    $self->ensure_connection;

    my $sql = "UPDATE meal_plan SET status = 'locked', final_suggestion_id = ?, locked_at = NOW() WHERE id = ?";
    return $self->{dbh}->do($sql, undef, $suggestion_id, $plan_id);
}

# Admin: Sets a blackout reason for a plan day (disables suggestions).
# Parameters:
#   - plan_id: Target day ID.
#   - reason: Reason text (e.g. Eating Out).
# Returns: Boolean result of DBI execution.
sub DB::set_blackout {
    my ($self, $plan_id, $reason) = @_;
    $self->ensure_connection;

    my $sql = "UPDATE meal_plan SET status = 'locked', blackout_reason = ?, final_suggestion_id = NULL, locked_at = NOW() WHERE id = ?";
    return $self->{dbh}->do($sql, undef, $reason, $plan_id);
}

# Admin: Resets a plan day to 'open' status and clears selections/blackouts.
# Parameters:
#   - plan_id: Target day ID.
# Returns: Boolean DBI execution result.
sub DB::unlock_day {
    my ($self, $plan_id) = @_;
    $self->ensure_connection;

    my $sql = "UPDATE meal_plan SET status = 'open', final_suggestion_id = NULL, blackout_reason = NULL, locked_at = NULL WHERE id = ?";
    return $self->{dbh}->do($sql, undef, $plan_id);
}

# Retrieves metadata for a specific plan day, typically for notifications.
# Parameters:
#   - plan_id: Target day ID.
# Returns: HashRef { diff (days from today), formatted_date }.
sub DB::get_plan_day_metadata {
    my ($self, $plan_id) = @_;
    $self->ensure_connection;

    return $self->{dbh}->selectrow_hashref(
        "SELECT DATEDIFF(plan_date, CURDATE()) as diff, DATE_FORMAT(plan_date, '%W, %b %D') as formatted_date FROM meal_plan WHERE id = ?",
        undef, $plan_id
    );
}

# Updates the meal name on an existing suggestion. Verified for ownership or admin.
# Parameters:
#   - suggestion_id: Suggestion to update.
#   - meal_name: New meal name.
#   - user_id: ID of the user requesting update.
#   - is_admin: Admin bypass flag.
# Returns: HashRef { success } or { error }.
sub DB::update_suggestion {
    my ($self, $suggestion_id, $meal_name, $user_id, $is_admin) = @_;
    $self->ensure_connection;
    
    # Enforce Title Case
    $meal_name = join ' ', map { ucfirst lc } split /\s+/, $meal_name;

    my ($plan_id, $suggester_id) = $self->{dbh}->selectrow_array(
        "SELECT plan_id, suggested_by FROM meal_suggestions WHERE id = ?",
        undef, $suggestion_id
    );
    return { error => 'Not found' } unless $plan_id;

    my ($status) = $self->{dbh}->selectrow_array(
        "SELECT status FROM meal_plan WHERE id = ?", undef, $plan_id
    );
    return { error => 'Day is locked' } if $status eq 'locked';

    unless ($is_admin || $suggester_id == $user_id) {
        return { error => 'Forbidden' };
    }

    $self->{dbh}->do("INSERT IGNORE INTO meals (name) VALUES (?)", undef, $meal_name);
    my ($meal_id) = $self->{dbh}->selectrow_array(
        "SELECT id FROM meals WHERE name = ?", undef, $meal_name
    );

    $self->{dbh}->do(
        "UPDATE meal_suggestions SET meal_id = ? WHERE id = ?",
        undef, $meal_id, $suggestion_id
    );

    return { success => 1 };
}

# Removes a meal suggestion. Verified for ownership or admin.
# Parameters:
#   - suggestion_id: Target suggestion ID.
#   - user_id: Requesting user.
#   - is_admin: Admin bypass flag.
# Returns: HashRef { success } or { error }.
sub DB::delete_suggestion {
    my ($self, $suggestion_id, $user_id, $is_admin) = @_;
    $self->ensure_connection;

    my ($plan_id, $suggester_id) = $self->{dbh}->selectrow_array(
        "SELECT plan_id, suggested_by FROM meal_suggestions WHERE id = ?",
        undef, $suggestion_id
    );
    return { error => 'Not found' } unless $plan_id;

    my ($status) = $self->{dbh}->selectrow_array(
        "SELECT status FROM meal_plan WHERE id = ?", undef, $plan_id
    );
    return { error => 'Day is locked' } if $status eq 'locked';

    unless ($is_admin || $suggester_id == $user_id) {
        return { error => 'Forbidden' };
    }

    $self->{dbh}->do("DELETE FROM meal_suggestions WHERE id = ?", undef, $suggestion_id);
    return { success => 1 };
}

# Retrieves all historical meal names for autocomplete.
# Parameters: None
# Returns: ArrayRef of name strings.
sub DB::get_meal_vault {
    my $self = shift;
    $self->ensure_connection;
    return $self->{dbh}->selectcol_arrayref("SELECT name FROM meals ORDER BY name ASC");
}

# Retrieves all meal vault records for the management interface.
# Parameters: None
# Returns: ArrayRef of HashRefs { id, name, is_used }.
sub DB::get_full_meal_vault {
    my $self = shift;
    $self->ensure_connection;
    
    my $sql = q{
        SELECT m.id, m.name,
               (SELECT COUNT(*) FROM meal_suggestions s WHERE s.meal_id = m.id) as is_used
        FROM meals m 
        ORDER BY m.name ASC
    };
    
    return $self->{dbh}->selectall_arrayref($sql, { Slice => {} });
}

# Admin: Directly inserts a new meal into the global vault.
# Parameters:
#   - name: Unique meal name.
# Returns: Boolean DBI execution result.
sub DB::add_meal_to_vault {
    my ($self, $name) = @_;
    $self->ensure_connection;
    # Enforce Title Case
    $name = join ' ', map { ucfirst lc } split /\s+/, $name;
    my $sql = "INSERT INTO meals (name) VALUES (?)";
    return $self->{dbh}->do($sql, undef, $name);
}

# Admin: Updates a meal's name in the vault.
# Parameters:
#   - id: Vault entry ID.
#   - name: New name.
# Returns: Boolean DBI execution result.
sub DB::update_meal_in_vault {
    my ($self, $id, $name) = @_;
    $self->ensure_connection;
    # Enforce Title Case
    $name = join ' ', map { ucfirst lc } split /\s+/, $name;
    my $sql = "UPDATE meals SET name = ? WHERE id = ?";
    return $self->{dbh}->do($sql, undef, $name, $id);
}

# Admin: Permanently removes a meal from the vault.
# Parameters:
#   - id: Vault entry ID.
# Returns: Boolean DBI execution result.
sub DB::delete_meal_from_vault {
    my ($self, $id) = @_;
    $self->ensure_connection;

    # Check if meal is currently used in any suggestions
    my ($count) = $self->{dbh}->selectrow_array(
        "SELECT COUNT(*) FROM meal_suggestions WHERE meal_id = ?",
        undef, $id
    );
    
    return { success => 0, error => "Cannot delete: This meal is currently part of a meal plan." }
        if $count > 0;

    my $sql = "DELETE FROM meals WHERE id = ?";
    my $success = $self->{dbh}->do($sql, undef, $id);
    return { success => $success ? 1 : 0 };
}

# Retrieves lists of user IDs who have suggested or voted for a specific plan day.
# Parameters:
#   - plan_id: Target day ID.
# Returns: HashRef { suggested_ids => [], voted_ids => [] }.
sub DB::get_plan_participation {
    my ($self, $plan_id) = @_;
    $self->ensure_connection;

    my $suggested = $self->{dbh}->selectcol_arrayref(
        "SELECT DISTINCT suggested_by FROM meal_suggestions WHERE plan_id = ?",
        undef, $plan_id
    ) // [];

    my $voted = $self->{dbh}->selectcol_arrayref(
        "SELECT DISTINCT v.user_id FROM meal_votes v 
         JOIN meal_suggestions s ON v.suggestion_id = s.id 
         WHERE s.plan_id = ?",
        undef, $plan_id
    ) // [];

    return {
        suggested_ids => $suggested,
        voted_ids     => $voted
    };
}

1;
