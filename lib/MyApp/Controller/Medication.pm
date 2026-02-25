# /lib/MyApp/Controller/Medication.pm

package MyApp::Controller::Medication;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for family-wide medication logging and history tracking.
# Features:
#   - Ledger view of recently taken medications
#   - Multi-member logging (Any family member can log for any member)
#   - Autocomplete from shared medication registry
# Integration points:
#   - Scoped by 'family' bridge for restricted access
#   - Uses DB::Medication for all persistence and retrieval

# Renders the medication dashboard.
sub index {
    my $c = shift;
    
    # Grouped logs for user tiles
    my $grouped_logs = $c->db->get_medication_logs_by_user();
    my $registry     = $c->db->get_medication_registry();
    my $members      = $c->db->get_medication_members();
    
    $c->stash(
        logs     => $grouped_logs,
        registry => $registry,
        members  => $members,
        title    => 'Medication Tracker'
    );
    
    $c->render('medication');
}

# Processes a new medication dose entry.
sub add {
    my $c = shift;
    my $logged_by_id = $c->current_user_id;
    
    my $medication_name  = trim($c->param('medication_name') // '');
    my $family_member_id = $c->param('family_member_id');
    my $dosage           = trim($c->param('dosage') // 0);
    my $taken_at         = trim($c->param('taken_at') // '');
    
    # Normalize taken_at for MySQL format
    $taken_at =~ s/T/ / if $taken_at;

    unless ($medication_name && $family_member_id && $dosage > 0) {
        $c->flash(error => "Please provide medication name, member, and valid dosage.");
        return $c->redirect_to('/medication');
    }
    
    eval {
        $c->db->log_medication_dose(
            $medication_name,
            $family_member_id,
            $logged_by_id,
            $dosage,
            $taken_at || undef
        );
        $c->flash(message => "Logged $dosage mg of $medication_name.");
    };
    
    if ($@) {
        $c->app->log->error("Failed to log medication: $@");
        $c->flash(error => "Database failure recording dose.");
    }
    
    $c->redirect_to('/medication');
}

# Updates an existing medication log entry.
sub edit {
    my $c = shift;
    my $id = $c->param('id');
    
    my $medication_name  = trim($c->param('medication_name') // '');
    my $family_member_id = $c->param('family_member_id');
    my $dosage           = trim($c->param('dosage') // 0);
    my $taken_at         = trim($c->param('taken_at') // '');
    
    $taken_at =~ s/T/ / if $taken_at;

    eval {
        $c->db->update_medication_log(
            $id,
            $medication_name,
            $family_member_id,
            $dosage,
            $taken_at
        );
        $c->flash(message => "Medication log updated.");
    };
    
    if ($@) {
        $c->app->log->error("Failed to update medication log: $@");
        $c->flash(error => "Database failure updating log.");
    }
    
    $c->redirect_to('/medication');
}


# Permanently removes a medication log entry.
# Route: POST /medication/delete/:id
# Parameters:
#   id : Unique log entry identifier
# Returns:
#   Redirects to index on success
sub delete {
    my $c = shift;
    my $id = $c->param('id');
    
    eval {
        if ($c->db->delete_medication_log($id)) {
            $c->flash(message => "Log entry deleted.");
        } else {
            $c->flash(error => "Entry not found.");
        }
    };
    
    if ($@) {
        $c->app->log->error("Failed to delete medication log: $@");
        $c->flash(error => "Database failure deleting entry.");
    }
    
    $c->redirect_to('/medication');
}

# Renders the registry management interface.
sub manage {
    my $c = shift;
    my $registry = $c->db->get_registry_with_stats();
    $c->render('medication/manage', registry => $registry, title => 'Manage Medications');
}

# Updates a registry item.
sub update_registry {
    my $c = shift;
    my $id = $c->param('id');
    my $name = trim($c->param('name'));
    my $dosage = $c->param('default_dosage');

    if ($c->db->update_registry_item($id, $name, $dosage)) {
        $c->flash(message => "Updated $name.");
    } else {
        $c->flash(error => "Failed to update registry.");
    }
    $c->redirect_to('/medication/manage');
}

# Deletes a registry item.
sub delete_registry {
    my $c = shift;
    my $id = $c->param('id');
    
    my ($success, $error) = $c->db->delete_registry_item($id);
    if ($success) {
        $c->flash(message => "Medication removed from registry.");
    } else {
        $c->flash(error => $error || "Failed to delete.");
    }
    $c->redirect_to('/medication/manage');
}

1;
