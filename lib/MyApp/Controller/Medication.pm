# /lib/MyApp/Controller/Medication.pm

package MyApp::Controller::Medication;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for AJAX-driven Medication Tracker.
# Manages medication logging, registry maintenance, and historical tracking.
#
# Features:
#   - Single Page Application (SPA) architecture via AJAX data loading.
#   - Dynamic dose logging with real-time interval calculation.
#   - Registry management for quick selection and dosage standardization.
#   - Rapid "Reset to Now" functionality for quick repeat dosing.
#
# Integration Points:
#   - DB::Medication for all persistence and interval logic.
#   - MyApp::Plugin::Icons for semantic emoji representation.
#   - Default Layout for global glassmorphic theming and navigation.

# Initial page load - Renders the SPA container.
# Route: GET /medication
# Parameters: None
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

# API: Get current state (Logs + Registry).
# Route: GET /medication/api/data
# Returns: JSON object { logs, registry, members }
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

# API: Add Dose - Logs a new medication administration.
# Route: POST /medication/add
# Parameters:
#   - medication_name: Name of the drug.
#   - family_member_id: ID of the recipient.
#   - dosage: Numeric value in mg.
#   - taken_at: (Optional) YYYY-MM-DD HH:MM timestamp.
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

# API: Edit Dose - Updates an existing log entry.
# Route: POST /medication/edit/:id
# Parameters:
#   - id: Unique entry ID.
#   - medication_name, family_member_id, dosage, taken_at (as above).
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

# API: Reset Dose Time to Now or Custom - Updates a previous dose time.
# Route: POST /medication/reset/:id
# Parameters:
#   - id: Unique entry ID.
#   - taken_at: (Optional) Full YYYY-MM-DD HH:MM timestamp.
#   - create_reminder: (Optional) Boolean to create a follow-up reminder.
#   - reminder_delay: (Optional) Hours to wait before reminder (1-24).
#   - reminder_recipients: (Optional) Comma-separated list of User IDs.
#   - reminder_title: (Optional) Text for the reminder title.
#   - reminder_desc: (Optional) Text for the reminder description.
sub reset {
    my $c = shift;
    my $id = $c->param('id');
    my $taken_at = trim($c->param('taken_at') // '');
    
    $taken_at =~ s/T/ / if $taken_at;

    eval {
        if ($c->db->reset_medication_log($id, $taken_at || undef)) {
            
            # Handle optional follow-up reminder creation
            if ($c->param('create_reminder')) {
                my $delay      = $c->param('reminder_delay') || 4;
                my $recipients = $c->param('reminder_recipients') // '';
                my $title      = $c->param('reminder_title') // 'Medication Reminder';
                my $desc       = $c->param('reminder_desc')  // 'Follow-up dose reminder.';

                if ($recipients) {
                    require DateTime;
                    
                    my $dt;
                    if ($taken_at && $taken_at =~ /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/) {
                        $dt = DateTime->new(
                            year => $1, month => $2, day => $3, 
                            hour => $4, minute => $5, 
                            time_zone => 'Australia/Melbourne'
                        );
                    } else {
                        $dt = DateTime->now(time_zone => 'Australia/Melbourne');
                    }
                    
                    $dt->add(hours => $delay);

                    my $trigger_time = $dt->strftime('%H:%M:%S');
                    my $trigger_day  = $dt->day_of_week; # 1=Mon, 7=Sun

                    my @uids = split(',', $recipients);
                    my $creator_id = $c->current_user_id;

                    # Create a one-off reminder rule
                    $c->db->create_reminder($title, $desc, $trigger_day, $trigger_time, $creator_id, \@uids, 1);
                }
            }

            my $msg = "Dose time updated.";
            $msg .= " Follow-up reminder scheduled." if $c->param('create_reminder');

            $c->render(json => { success => 1, message => $msg });
        } else {
            $c->render(json => { success => 0, error => "Entry not found." });
        }
    };
    if ($@) {
        $c->app->log->error("Reset Medication Error: $@");
        $c->render(json => { success => 0, error => "Database error." });
    }
}

# API: Delete Dose - Removes a log entry from history.
# Route: POST /medication/delete/:id
# Parameters:
#   - id: Unique entry ID.
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

# API: Update Registry - Updates standardized medication defaults.
# Route: POST /medication/manage/update/:id
# Parameters:
#   - id: Registry ID.
#   - name: New display name.
#   - default_dosage: Default mg value.
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

# API: Delete Registry Item - Removes medication from registry if no logs exist.
# Route: POST /medication/manage/delete/:id
# Parameters:
#   - id: Registry ID.
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
