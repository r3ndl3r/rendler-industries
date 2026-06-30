# /lib/MyApp/Controller/Medication.pm

package MyApp::Controller::Medication;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::JSON qw(decode_json);
use Mojo::Util qw(trim);
use DateTime;

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
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family;

    $c->render('medication');
}


# Returns the consolidated state for the module.
# Route: GET /medication/api/state
# Returns: JSON object { logs, registry, members, recent_taken, current_user_id, is_admin, is_parent, success }
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

    my $logs     = $c->db->get_medication_logs_by_user();
    my $registry = $c->db->get_registry_with_stats();
    my $members  = $c->db->get_medication_members();
    my $recent_taken = $c->is_parent ? $c->db->get_recent_medications_taken(10) : [];
    
    my $reminders      = $c->db->get_medication_reminders();
    my $current_date   = $c->now->strftime('%Y-%m-%d');
    my $current_user   = $c->current_user_id;
    my $pending_events = $c->db->get_pending_medication_reminders($current_user, $current_date);

    $c->render(json => {
        success  => 1,
        logs     => $logs,
        registry => $registry,
        members  => $members,
        recent_taken => $recent_taken,
        current_user_id => $current_user,
        is_admin      => $c->is_admin ? 1 : 0,
        is_parent     => $c->is_parent ? 1 : 0,
        reminders     => $reminders,
        pending_events => $pending_events
    });
}

# Logs a new medication administration.
# Route: POST /medication/api/add
sub add {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

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
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

    my $id = $c->param('id');
    my $medication_name  = trim($c->param('medication_name') // '');
    my $family_member_id = $c->param('family_member_id');
    my $dosage           = trim($c->param('dosage') // 0);
    my $taken_at         = trim($c->param('taken_at') // '');
    
    $taken_at =~ s/T/ / if $taken_at;

    unless ($id && $medication_name && $family_member_id && $dosage > 0) {
        return $c->render(json => { success => 0, error => "Missing required fields." });
    }

    eval {
        if ($c->db->update_medication_log($id, $medication_name, $family_member_id, $dosage, $taken_at || undef)) {
            $c->render(json => { success => 1, message => "Log updated." });
        } else {
            $c->render(json => { success => 0, error => "Entry not found." });
        }
    };
    if ($@) {
        $c->render(json => { success => 0, error => "Database error." });
    }
}

# Updates a previous dose time and optionally schedules a reminder.
# Route: POST /medication/api/reset/:id
sub reset {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

    my $id = $c->param('id');
    my $taken_at = trim($c->param('taken_at') // '');
    
    $taken_at =~ s/T/ / if $taken_at;

    eval {
        my $reminder_scheduled = 0;
        if ($c->db->reset_medication_log($id, $taken_at || undef)) {
            
            # Handle optional follow-up reminder creation
            if ($c->param('create_reminder')) {
                my $delay      = $c->param('reminder_delay') || 4;
                my $recipients = $c->param('reminder_recipients') // '';
                my $title      = $c->param('reminder_title') // 'Medication Reminder';
                my $desc       = $c->param('reminder_desc')  // 'Follow-up dose reminder.';

                return $c->render(json => { success => 0, error => "Invalid reminder delay." })
                    unless $delay =~ /\A(?:[1-9]|1[0-9]|2[0-4])\z/;

                if ($recipients) {
                    my $dt;
                    if ($taken_at && $taken_at =~ /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/) {
                        $dt = DateTime->new(
                            year => $1, month => $2, day => $3, 
                            hour => $4, minute => $5, 
                            time_zone => $c->app->config->{timezone} || 'UTC'
                        );
                    } else {
                        $dt = $c->now;
                    }
                    
                    $dt->add(hours => $delay);

                    my $trigger_time = $dt->strftime('%H:%M:%S');
                    my $trigger_day  = $dt->day_of_week;

                    my @uids = split(',', $recipients);
                    my $creator_id = $c->current_user_id;
                    my %family_user = map { $_->{id} => 1 } @{$c->db->get_family_users()};
                    @uids = grep { defined $_ && /\A\d+\z/ && $family_user{$_} } @uids;
                    return $c->render(json => { success => 0, error => "Invalid reminder recipients." })
                        unless @uids;

                    $c->db->create_reminder($title, $desc, 1 << ($trigger_day - 1), $trigger_time, $creator_id, \@uids, 1);
                    $reminder_scheduled = 1;
                }
            }

            my $msg = "Dose time updated.";
            $msg .= " Follow-up reminder scheduled." if $reminder_scheduled;

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
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

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
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

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
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $id = $c->param('id');
    
    my ($success, $error) = $c->db->delete_registry_item($id);
    if ($success) {
        $c->render(json => { success => 1, message => "Medication removed." });
    } else {
        $c->render(json => { success => 0, error => $error || "Delete failed." });
    }
}

###############################################################################
# MEDICATION REMINDER ENDPOINTS
###############################################################################

# Returns reminder schedules and pending events.
# Route: GET /medication/api/reminders
sub api_reminders {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

    my $reminders = $c->db->get_medication_reminders();
    my $current_date = $c->now->strftime('%Y-%m-%d');
    my $pending_events = $c->db->get_pending_medication_reminders($c->current_user_id, $current_date);

    $c->render(json => {
        success  => 1,
        reminders     => $reminders,
        pending_events => $pending_events
    });
}

# Creates or replaces reminder times for a medication + family member.
# Parameters: medication_id, family_member_id, dosage, source_log_id (required medication_logs.id), times (JSON array of time strings),
#             days_of_week (JSON array of day numbers 1-7, default all)
# Route: POST /medication/api/reminders/save
sub save_reminders {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

    my $medication_id    = $c->param('medication_id');
    my $family_member_id = $c->param('family_member_id');
    my $dosage           = trim($c->param('dosage') // 0);
    my $source_log_id    = $c->param('source_log_id');
    my $times_json       = $c->param('times');
    my $days_json        = $c->param('days_of_week');

    unless ($medication_id && $family_member_id && $dosage && $source_log_id && $times_json) {
        return $c->render(json => { success => 0, error => 'Missing required fields.' });
    }
    unless ($medication_id =~ /^\d+$/ && $family_member_id =~ /^\d+$/ && $source_log_id =~ /^\d+$/ && $dosage =~ /^\d+$/ && $dosage > 0) {
        return $c->render(json => { success => 0, error => 'Invalid reminder details.' });
    }

    my $times = eval { decode_json($times_json) };
    if ($@ || ref($times) ne 'ARRAY' || @$times < 1 || @$times > 4) {
        return $c->render(json => { success => 0, error => 'times must be a JSON array of 1-4 time strings.' });
    }
    for my $t (@$times) {
        unless (defined $t && $t =~ /\A(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\z/) {
            return $c->render(json => { success => 0, error => 'Each reminder time must be HH:MM.' });
        }
    }

    my $days_of_week = 127;
    if ($days_json) {
        my $days_arr = eval { decode_json($days_json) };
        if ($@ || ref($days_arr) ne 'ARRAY' || @$days_arr < 1) {
            return $c->render(json => { success => 0, error => 'days_of_week must be a JSON array of day numbers (1-7).' });
        }
        $days_of_week = 0;
        for my $d (@$days_arr) {
            if ($d !~ /\A[1-7]\z/) {
                return $c->render(json => { success => 0, error => 'Each day value must be 1-7.' });
            }
            $days_of_week |= (1 << ($d - 1));
        }
    }

    unless ($c->is_parent || $family_member_id == $c->current_user_id) {
        return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403);
    }
    unless ($c->db->medication_log_matches_reminder_source($source_log_id, $medication_id, $family_member_id)) {
        return $c->render(json => { success => 0, error => 'Reminder source log does not match this medication.' });
    }

    eval {
        $c->db->save_medication_reminders($medication_id, $family_member_id, $dosage, $times, $days_of_week, $c->current_user_id, $source_log_id);
        $c->render(json => { success => 1, message => 'Reminder saved.' });
    };
    if ($@) {
        $c->app->log->error("Save medication reminder error: $@");
        $c->render(json => { success => 0, error => 'Database error.' });
    }
}

# Toggles a reminder schedule's is_active flag.
# Route: POST /medication/api/reminders/toggle/:id
sub toggle_reminder {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

    my $id     = $c->param('id');
    my $active = $c->param('active') // 0;
    return $c->render(json => { success => 0, error => 'Reminder not found.' }) unless defined $id && $id =~ /^\d+$/;
    $active = $active && $active eq '1' ? 1 : 0;
    my $member_id = $c->db->get_medication_reminder_member_id($id);
    return $c->render(json => { success => 0, error => 'Reminder not found.' }) unless $member_id;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_parent || $member_id == $c->current_user_id;

    eval {
        $c->db->toggle_medication_reminder($id, $active);
        $c->render(json => { success => 1, message => 'Reminder updated.' });
    };
    if ($@) {
        $c->render(json => { success => 0, error => 'Database error.' });
    }
}

# Deletes a reminder schedule.
# Route: POST /medication/api/reminders/delete/:id
sub delete_reminder_schedule {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

    my $id = $c->param('id');
    return $c->render(json => { success => 0, error => 'Reminder not found.' }) unless defined $id && $id =~ /^\d+$/;
    my $member_id = $c->db->get_medication_reminder_member_id($id);
    return $c->render(json => { success => 0, error => 'Reminder not found.' }) unless $member_id;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_parent || $member_id == $c->current_user_id;

    eval {
        if ($c->db->delete_medication_reminder($id)) {
            $c->render(json => { success => 1, message => 'Reminder deleted.' });
        } else {
            $c->render(json => { success => 0, error => 'Reminder not found.' });
        }
    };
    if ($@) {
        $c->render(json => { success => 0, error => 'Database error.' });
    }
}

# Confirms a pending reminder event as taken and logs the dose unless it was
# already recorded near the scheduled reminder time.
# Route: POST /medication/api/reminders/confirm/:id
sub confirm_reminder_event {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

    my $event_id = $c->param('id');

    eval {
        my $result = $c->db->confirm_medication_reminder($event_id, $c->current_user_id);
        if ($result->{success}) {
            my $msg = 'Dose confirmed.';
            $msg .= ' Source dose log updated.' if $result->{log_id};
            $c->render(json => { success => 1, message => $msg, log_id => $result->{log_id} });
        } else {
            $c->render(json => { success => 0, error => 'Already confirmed or not found.' });
        }
    };
    if ($@) {
        $c->app->log->error("Confirm medication reminder error: $@");
        $c->render(json => { success => 0, error => 'Database error.' });
    }
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{family}->get('/medication')->to('medication#index');
    $r->{family}->get('/medication/api/state')->to('medication#api_state');
    $r->{family}->post('/medication/api/add')->to('medication#add');
    $r->{family}->post('/medication/api/edit/:id')->to('medication#edit');
    $r->{family}->post('/medication/api/reset/:id')->to('medication#reset');
    $r->{family}->post('/medication/api/delete/:id')->to('medication#delete');
    $r->{admin}->post('/medication/api/manage/update/:id')->to('medication#update_registry');
    $r->{admin}->post('/medication/api/manage/delete/:id')->to('medication#delete_registry');
    $r->{family}->get('/medication/api/reminders')->to('medication#api_reminders');
    $r->{family}->post('/medication/api/reminders/save')->to('medication#save_reminders');
    $r->{family}->post('/medication/api/reminders/toggle/:id')->to('medication#toggle_reminder');
    $r->{family}->post('/medication/api/reminders/delete/:id')->to('medication#delete_reminder_schedule');
    $r->{family}->post('/medication/api/reminders/confirm/:id')->to('medication#confirm_reminder_event');
}

1;
