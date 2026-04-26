# /lib/MyApp/Controller/Room.pm

package MyApp::Controller::Room;

use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);
use Digest::SHA qw(sha256_hex);
use DateTime;

# Controller for the Room Cleaning Tracker.
#
# Features:
#   - Teen view for daily photo uploads.
#   - Admin view for review, feedback, and settings.
#   - Multi-photo upload pipeline with internal binary storage.
#   - Integration with Discord for review feedback and alerts.
#
# Integration Points:
#   - Restricted to family members via family bridge.
#   - Leverages DB::Room for storage and state.

# Renders the main room tracker interface (Teen/Reviewer context).
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family;
    $c->render('room', is_admin => $c->is_admin, is_family => $c->is_family);
}

# Returns the consolidated state for the module.
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

    my $user_id = $c->current_user_id;
    my $today = $c->now->strftime('%Y-%m-%d');
    my $config = $c->db->get_room_configs($user_id);
    
    my $state = {
        is_admin     => $c->is_admin ? 1 : 0,
        is_child     => $c->is_child ? 1 : 0,
        is_tracked   => ($config && $config->{is_active}) ? 1 : 0,
        today_status => $c->db->get_room_status_for_date($user_id, $today),
        is_blackout  => $c->db->is_room_blackout($today),
        success      => 1
    };
    
    # Admins get extra metadata for management
    if ($c->is_admin) {
        my $today_iso = $c->now->strftime('%Y-%m-%d');
        $state->{pending_submissions} = $c->db->get_pending_room_submissions();
        $state->{daily_summary}       = $c->db->get_room_daily_summary($today_iso);
        $state->{storage_stats}       = $c->db->get_room_storage_stats();
        $state->{room_configs}        = $c->db->get_room_configs();
        $state->{blackout_dates}      = $c->db->get_room_blackouts();
        $state->{all_users}           = $c->db->get_all_users();
    }

    $c->render(json => $state);
}

# Processes daily photo uploads from children.
sub api_upload {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_child;

    my $uploads = $c->every_param('files[]');
    return $c->render(json => { success => 0, error => 'No files uploaded' }) unless @$uploads;

    my $user_id = $c->current_user_id;
    my $username = $c->session('user');
    my $today = $c->now->strftime('%Y-%m-%d');
    my $written = 0;

    eval {
        foreach my $upload (@$uploads) {
            next unless $upload->size;

            my $original_filename = $upload->filename;
            my $mime_type = $upload->headers->content_type || 'application/octet-stream';
            my $file_data = $upload->asset->slurp;
            my $file_size = $upload->size;

            my ($ext) = $original_filename =~ /(\.[^.]+)$/;
            my $safe_filename = sha256_hex($original_filename . time . int(rand(1000))) . lc($ext || '');

            $c->db->submit_room_photo($user_id, $safe_filename, $original_filename, $mime_type, $file_size, $file_data, $today);
            $written++;
        }

        if ($written) {
            my $admins = $c->db->get_admins();
            foreach my $admin (@$admins) {
                $c->notify_templated($admin->{id}, 'room_review_needed', {
                    user => $username
                }, $c->current_user_id);
            }
        }
    };
    if ($@) {
        $c->app->log->error("Room upload failed: $@");
        return $c->render(json => { success => 0, error => 'Database error during upload' });
    }

    return $c->render(json => { success => 0, error => 'No valid photos received' }) unless $written;
    $c->render(json => { success => 1, message => 'Photos submitted for review' });
}

# Serves raw binary binary content for rendering.
sub serve {
    my $c = shift;
    return $c->render(text => 'Unauthorized', status => 403) unless $c->is_logged_in;
    
    my $id = $c->stash('id');
    my $photo = $c->db->get_room_photo_by_id($id);
    return $c->render(text => 'Not found', status => 404) unless $photo;
    
    $c->res->headers->content_type($photo->{mime_type});
    $c->render(data => $photo->{file_data});
}

# Admin: Updates status of a photo and auto-sends feedback if all items are handled.
sub api_update_status {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $id      = $c->param('id');
    my $status  = $c->param('status'); # passed / failed
    my $comment = trim($c->param('comment') || '');

    eval {
        $c->db->update_room_photo_status($id, $status, $comment);
        
        # Check if this user has any other PENDING photos for the submission's date
        my $sub = $c->db->get_room_photo_by_id($id);
        my $all_on_date = $c->db->get_room_status_for_date($sub->{user_id}, $sub->{submission_date});
        
        my $pending_count = grep { $_->{status} eq 'pending' } @$all_on_date;
        
        if ($pending_count == 0) {
            # All items reviewed! Auto-dispatch the consolidated report.
            $c->app->log->info("All room items reviewed for user $sub->{user_id} for date $sub->{submission_date}. Auto-sending feedback.");
            
            # Dispatch feedback asynchronously using the submission's specific date
            Mojo::IOLoop->next_tick(sub {
                $c->_dispatch_consolidated_feedback($sub->{user_id}, $sub->{submission_date});
            });
        }
    };
    if ($@) {
        $c->app->log->error("Room status update failure: $@");
        return $c->render(json => { success => 0, error => 'Update failed' });
    }

    $c->render(json => { success => 1 });
}

# Internal helper to format and send the Discord feedback report.
sub _dispatch_consolidated_feedback {
    my ($c, $target_user_id, $date) = @_;
    
    # Fallback to today if no date provided
    $date //= $c->now->ymd;
    
    # Format for display: DD-MM-YYYY
    my $display_date = $date;
    if ($date =~ /^(\d{4})-(\d{2})-(\d{2})$/) {
        $display_date = "$3-$2-$1";
    }

    my $submissions = $c->db->get_room_status_for_date($target_user_id, $date);
    return unless @$submissions;

    my $msg = "";
    my $has_failures = 0;
    
    foreach my $sub (@$submissions) {
        my $icon = ($sub->{status} eq 'passed') ? "✅" : "❌";
        $msg .= "$icon **$sub->{original_filename}**: " . ucfirst($sub->{status}) . "\n";
        if ($sub->{status} eq 'failed') {
            $has_failures = 1;
            $msg .= "> Feedback: " . ($sub->{admin_comment} || "Please correct and re-upload.") . "\n";
        }
        $msg .= "\n";
    }

    if ($has_failures) {
        $msg .= "⚠️ Some items failed check. Please correct and re-upload photos!";
    } else {
        $msg .= "🎉 Everything looks great! Clean streak continued!";
    }

    $c->notify_templated($target_user_id, 'room_feedback', { 
        date     => $display_date, 
        feedback => $msg 
    }, $c->current_user_id);

    # Reset the reminder cooldown so the recurring reminder does not fire
    # immediately after feedback — the user has just been notified.
    $c->db->update_room_reminder_sent($target_user_id);
}

# Admin: Saves room config (start time, active status).
sub api_save_config {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $user_id    = $c->param('user_id');
    my $start_time = $c->param('alert_start_time') || '17:00:00';
    my $is_active  = $c->param('is_active') ? 1 : 0;

    $c->db->save_room_config($user_id, $start_time, $is_active);
    $c->render(json => { success => 1 });
}

# Admin: Manages blackout dates.
sub api_add_blackout {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $date   = $c->param('date');
    my $reason = trim($c->param('reason') || '');

    $c->db->add_room_blackout($date, $reason);
    $c->render(json => { success => 1 });
}

sub api_delete_blackout {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $id = $c->param('id');
    $c->db->delete_room_blackout($id);
    $c->render(json => { success => 1 });
}

# Admin: Deletes submissions older than 30 days.
sub api_trim {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $deleted = $c->db->trim_room_data();
    $c->render(json => { success => 1, deleted => $deleted });
}

# Permanently removes a room submission (Admin only).
sub api_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $id = $c->stash('id');
    my $sub = $c->db->get_room_photo_by_id($id);
    return $c->render(json => { success => 0, error => 'Not found' }) unless $sub;

    $c->db->delete_room_submission($id);
    $c->render(json => { success => 1 });
}

1;
