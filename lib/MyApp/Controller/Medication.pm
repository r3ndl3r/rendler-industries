# /lib/MyApp/Controller/Medication.pm

package MyApp::Controller::Medication;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for AJAX-driven Medication Tracker.
# Manages medication logging, registry maintenance, and historical tracking.
#
# Features:
#   - 100% SPA architecture with state-driven rendering.
#   - Dynamic dose logging with real-time interval calculation.
#   - Registry management for quick selection and dosage standardization.
#   - Rapid "Reset to Now" functionality for quick repeat dosing.
#
# Integration Points:
#   - DB::Medication for all persistence and interval logic.
#   - MyApp::Plugin::Icons for semantic emoji representation.
#   - Default Layout for global glassmorphic theming.

# Renders the SPA skeleton.
# Route: GET /medication
sub index {
    shift->render('medication');
}

# Returns the consolidated state for the module.
# Route: GET /medication/api/state
# Returns: JSON object { logs, registry, members, is_admin, success }
sub api_state {
    my $c = shift;

    my $logs     = $c->db->get_medication_logs_by_user();
    my $registry = $c->db->get_registry_with_stats();
    my $members  = $c->db->get_medication_members();
    
    $c->render(json => {
        success  => 1,
        logs     => $logs,
        registry => $registry,
        members  => $members,
        is_admin => $c->is_admin ? 1 : 0
    });
}

# Logs a new medication administration.
# Route: POST /medication/api/add
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

# Updates an existing log entry.
# Route: POST /medication/api/edit/:id
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

# Updates a previous dose time and optionally schedules a reminder.
# Route: POST /medication/api/reset/:id
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
                    my $trigger_day  = $dt->day_of_week;

                    my @uids = split(',', $recipients);
                    my $creator_id = $c->current_user_id;

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

# Removes a log entry from history.
# Route: POST /medication/api/delete/:id
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

# Updates standardized medication defaults (Admin).
# Route: POST /medication/api/manage/update/:id
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

# Removes medication from registry if no logs exist (Admin).
# Route: POST /medication/api/manage/delete/:id
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
