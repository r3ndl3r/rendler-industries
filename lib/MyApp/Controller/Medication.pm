# /lib/MyApp/Controller/Medication.pm

package MyApp::Controller::Medication;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for AJAX-driven Medication Tracker.
# All actions return JSON success/error statuses.

# Initial page load
sub index {
    my $c = shift;
    
    my $logs     = $c->db->get_medication_logs_by_user();
    my $registry = $c->db->get_registry_with_stats();
    my $members  = $c->db->get_medication_members();
    
    $c->stash(
        logs     => $logs,
        registry => $registry,
        members  => $members,
        title    => 'Medication Tracker'
    );
    
    $c->render('medication');
}

# API: Get current state (Logs + Registry)
sub get_data {
    my $c = shift;
    my $logs     = $c->db->get_medication_logs_by_user();
    my $registry = $c->db->get_registry_with_stats();
    my $members  = $c->db->get_medication_members();
    
    $c->render(json => {
        logs     => $logs,
        registry => $registry,
        members  => $members
    });
}

# API: Add Dose
sub add {
    my $c = shift;
    my $logged_by_id = $c->current_user_id;
    
    my $medication_name  = trim($c->param('medication_name') // '');
    my $family_member_id = $c->param('family_member_id');
    my $dosage           = trim($c->param('dosage') // 0);
    my $taken_at         = trim($c->param('taken_at') // '');
    
    $taken_at =~ s/T/ / if $taken_at;

    unless ($medication_name && $family_member_id && $dosage > 0) {
        return $c->render(json => { success => 0, error => "Missing required fields." });
    }
    
    eval {
        $c->db->log_medication_dose($medication_name, $family_member_id, $logged_by_id, $dosage, $taken_at || undef);
        $c->render(json => { success => 1, message => "Logged $medication_name." });
    };
    if ($@) {
        $c->render(json => { success => 0, error => "Database error." });
    }
}

# API: Edit Dose
sub edit {
    my $c = shift;
    my $id = $c->param('id');
    my $medication_name  = trim($c->param('medication_name') // '');
    my $family_member_id = $c->param('family_member_id');
    my $dosage           = trim($c->param('dosage') // 0);
    my $taken_at         = trim($c->param('taken_at') // '');
    
    $taken_at =~ s/T/ / if $taken_at;

    eval {
        $c->db->update_medication_log($id, $medication_name, $family_member_id, $dosage, $taken_at);
        $c->render(json => { success => 1, message => "Log updated." });
    };
    if ($@) {
        $c->render(json => { success => 0, error => "Database error." });
    }
}

# API: Delete Dose
sub delete {
    my $c = shift;
    my $id = $c->param('id');
    
    eval {
        if ($c->db->delete_medication_log($id)) {
            $c->render(json => { success => 1, message => "Entry deleted." });
        } else {
            $c->render(json => { success => 0, error => "Entry not found." });
        }
    };
    if ($@) {
        $c->render(json => { success => 0, error => "Database error." });
    }
}

# API: Update Registry
sub update_registry {
    my $c = shift;
    my $id = $c->param('id');
    my $name = trim($c->param('name'));
    my $dosage = $c->param('default_dosage');

    if ($c->db->update_registry_item($id, $name, $dosage)) {
        $c->render(json => { success => 1, message => "Registry updated." });
    } else {
        $c->render(json => { success => 0, error => "Update failed." });
    }
}

# API: Delete Registry Item
sub delete_registry {
    my $c = shift;
    my $id = $c->param('id');
    
    my ($success, $error) = $c->db->delete_registry_item($id);
    if ($success) {
        $c->render(json => { success => 1, message => "Medication removed." });
    } else {
        $c->render(json => { success => 0, error => $error || "Delete failed." });
    }
}

1;
