# /lib/MyApp/Controller/Chores.pm

package MyApp::Controller::Chores;

use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);
use Digest::SHA qw(sha256_hex);

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
        child_balances => $c->db->get_child_balances(),
        success        => 1
    };

    # Inject extended datasets if the user is a reviewer
    if ($c->is_admin) {
        $state->{all_users}             = $c->db->get_all_users();
        $state->{history}               = $c->db->get_completed_chores_history();
        $state->{quick_add_chores}      = $c->db->get_recent_chore_templates();
        $state->{pending_submissions}   = $c->db->get_pending_chore_submissions();
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

        my $child_icon = $c->getUserIcon($child_name);
        
        my $admins = $c->db->get_admins();
        foreach my $adm (@$admins) {
            $c->notify_templated($adm->{id}, 'chore_complete', { 
                user   => $child_name, 
                icon   => $child_icon,
                task   => $title, 
                points => $pts_val 
            }, $c->current_user_id);
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

    if (defined $assigned_to && $assigned_to ne '') {
        return $c->render(json => { success => 0, error => 'Invalid child assignment' })
            unless $assigned_to =~ /^\d+$/;

        my $target = $c->db->get_user_by_id($assigned_to);
        return $c->render(json => { success => 0, error => 'Chores can only be assigned to approved children' })
            unless $target && $target->{is_child} && !$target->{is_admin} && $target->{status} eq 'approved';
    } else {
        $assigned_to = undef;
    }

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
        
        if ($assigned_to) {
            my $user = $c->db->get_user_by_id($assigned_to);
            my $icon = $user ? ($user->{emoji} // '👤') : '👤';
            my $name = $user ? ($user->{username} // 'Unknown') : 'Unknown';
            $c->notify_templated($assigned_to, 'chore_assigned', { 
                user   => $name,
                icon   => $icon,
                task   => $title, 
                points => $points 
            }, $c->current_user_id);
        }
 else {
            # Broadcast to all children for global pool chores
            my $kids = $c->db->get_child_users();
            foreach my $k (@$kids) {
                $c->notify_templated($k->{id}, 'chore_global_available', { 
                    task   => $title, 
                    points => $points 
                }, $c->current_user_id);
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

        # Notify the user whose work was revoked
        if ($chore->{completed_by}) {
            my $icon     = $chore->{completed_by_emoji} // '👤';
            my $title    = $chore->{title};
            my $points   = $chore->{points};
            
            $c->notify_templated($chore->{completed_by}, 'chore_revoked', { 
                icon   => $icon,
                task   => $title, 
                points => $points 
            }, $c->current_user_id);
        }
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

    # Notify the assigned user if a specific chore was removed
    if ($chore->{assigned_to}) {
        my $icon     = $chore->{assigned_emoji} // '👤';
        my $title    = $chore->{title};
        
        $c->notify_templated($chore->{assigned_to}, 'chore_removed', { 
            icon => $icon,
            task => $title 
        }, $c->current_user_id);
    }

    $c->app->log->info(sprintf("Chores: Admin %s deleted chore %d ('%s').", $c->session('user') // 'Unknown', $chore_id, $chore->{title}));
    
    $c->render(json => { success => 1 });
}


# Accepts a voluntary chore submission from a child with before/after photos.
#
# Route:      POST /chores/api/submit
# Parameters: description (string), before (file upload), after (file upload)
# Returns:    JSON { success, message|error }
sub api_submit {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_child;

    my $description = trim($c->param('description') || '');
    return $c->render(json => { success => 0, error => 'Description is required' }) unless $description;

    my $before = $c->req->upload('before');
    my $after  = $c->req->upload('after');
    return $c->render(json => { success => 0, error => 'Both before and after photos are required' })
        unless $before && $after;

    return $c->render(json => { success => 0, error => "The before photo is empty or invalid" }) unless $before->size;
    return $c->render(json => { success => 0, error => "The after photo is empty or invalid" }) unless $after->size;

    return $c->render(json => { success => 0, error => "The before photo is too large (max 50MB)" })
        if $before->size > 50 * 1024 * 1024;
    return $c->render(json => { success => 0, error => "The after photo is too large (max 50MB)" })
        if $after->size > 50 * 1024 * 1024;

    # Slurp both files early so we can validate magic bytes before touching the DB.
    my $before_data = $before->asset->slurp;
    my $after_data  = $after->asset->slurp;

    my $before_mime = $before->headers->content_type || 'application/octet-stream';
    my $after_mime  = $after->headers->content_type || 'application/octet-stream';

    return $c->render(json => { success => 0, error => "The before photo is not a valid image" })
        unless _looks_like_image($before_data, $before_mime);
    return $c->render(json => { success => 0, error => "The after photo is not a valid image" })
        unless _looks_like_image($after_data, $after_mime);

    my $user_id  = $c->current_user_id;
    my $username = $c->session('user');

    my $submission_id;
    eval {
        $submission_id = $c->db->add_chore_submission($user_id, $description);

        for my $pair (
            [$before, 'before', $before_data, $before_mime],
            [$after,  'after',  $after_data,  $after_mime],
        ) {
            my ($upload, $type, $data, $mime) = @$pair;
            my $original = $upload->filename;
            my $size     = $upload->size;

            my ($ext)    = $original =~ /(\.[^.]+)$/;
            my $safe     = sha256_hex($original . time . int(rand(1000))) . lc($ext || '');
            $c->db->add_chore_submission_photo($submission_id, $type, $safe, $original, $mime, $size, $data);
        }
    };
    if ($@) {
        $c->app->log->error("Chore submission failed: $@");
        if ($submission_id) {
            eval { $c->db->purge_chore_submission_photos($submission_id) };
            eval { $c->db->delete_chore_submission($submission_id) };
        }
        return $c->render(json => { success => 0, error => 'Submission failed' });
    }

    my $excerpt = length($description) > 60 ? substr($description, 0, 57) . '...' : $description;
    my $admins  = $c->db->get_admins();
    foreach my $admin (@$admins) {
        $c->notify_templated($admin->{id}, 'chore_submission_received', {
            user        => $username,
            description => $excerpt
        }, $c->current_user_id);
    }

    $c->render(json => { success => 1, message => 'Submitted for review!' });
}

# Serves a chore submission photo blob by chore_submission_photos.id.
#
# Route:      GET /chores/serve/:id
# Parameters: id (path param)
# Returns:    Binary image data or 404
sub serve {
    my $c = shift;
    return $c->render(text => 'Unauthorized', status => 403) unless $c->is_logged_in;

    my $id    = $c->stash('id');
    my $photo = $c->db->get_chore_submission_photo_by_id($id);
    return $c->render(text => 'Not found', status => 404) unless $photo;

    $c->res->headers->content_type($photo->{mime_type});
    $c->render(data => $photo->{file_data});
}

# Returns the current child's submission history (pending + recent approved).
#
# Route:      GET /chores/api/my_submissions
# Returns:    JSON { success, submissions[] }
sub api_my_submissions {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

    my $user_id = $c->current_user_id;
    my $subs    = $c->db->get_my_chore_submissions($user_id);
    $c->render(json => { success => 1, submissions => $subs });
}

# Approves a chore submission, records points awarded, and removes associated photo blobs.
#
# Route:      POST /chores/api/approve
# Parameters: id (submission ID), points (integer)
# Returns:    JSON { success, error }
sub api_approve {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $id     = $c->param('id');
    my $points = int($c->param('points') || 0);
    return $c->render(json => { success => 0, error => 'Points must be greater than 0' }) unless $points > 0;

    my $sub = $c->db->get_chore_submission_by_id($id);
    return $c->render(json => { success => 0, error => 'Not found' }) unless $sub;

    eval {
        $c->db->{dbh}->begin_work;
        $c->db->approve_chore_submission($id, $points);
        my $reason = "Chore Submission Approved: " . $sub->{description};
        $c->add_points($sub->{user_id}, $points, $reason);
        $c->db->purge_chore_submission_photos($id);
        $c->db->{dbh}->commit;
    };
    if ($@) {
        $c->db->{dbh}->rollback if $c->db->{dbh}->{Active};
        $c->app->log->error("Chore approve failed: $@");
        return $c->render(json => { success => 0, error => 'Approval failed' });
    }

    my $excerpt = length($sub->{description}) > 60 ? substr($sub->{description}, 0, 57) . '...' : $sub->{description};
    $c->notify_templated($sub->{user_id}, 'chore_submission_approved', {
        description => $excerpt,
        points      => $points
    }, $c->current_user_id);

    $c->render(json => { success => 1 });
}

# Marks a submission rejected and removes all associated photos and the submission record.
#
# Route:      POST /chores/api/reject
# Parameters: id (submission ID), comment (string)
# Returns:    JSON { success, error }
sub api_reject {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $id      = $c->param('id');
    my $comment = trim($c->param('comment') || '');
    return $c->render(json => { success => 0, error => 'A reason is required for rejection' }) unless $comment;

    my $sub = $c->db->get_chore_submission_by_id($id);
    return $c->render(json => { success => 0, error => 'Not found' }) unless $sub;

    eval {
        $c->db->{dbh}->begin_work;
        $c->db->purge_chore_submission_photos($id);
        $c->db->delete_chore_submission($id);
        $c->db->{dbh}->commit;
    };
    if ($@) {
        $c->db->{dbh}->rollback if $c->db->{dbh}->{Active};
        $c->app->log->error("Chore reject failed: $@");
        return $c->render(json => { success => 0, error => 'Rejection failed' });
    }

    my $excerpt = length($sub->{description}) > 60 ? substr($sub->{description}, 0, 57) . '...' : $sub->{description};
    $c->notify_templated($sub->{user_id}, 'chore_submission_rejected', {
        description => $excerpt,
        comment     => $comment
    }, $c->current_user_id);

    $c->render(json => { success => 1 });
}

# Checks common image signatures before storing user-provided binary data.
sub _looks_like_image {
    my ($data, $mime) = @_;
    return 0 unless defined $data && length($data) >= 8;
    return 1 if $data =~ /^\xFF\xD8\xFF/s;
    return 1 if $data =~ /^\x89PNG\r\n\x1A\n/s;
    return 1 if $data =~ /^GIF8[79]a/s;
    return 1 if $data =~ /^RIFF.{4}WEBP/s;
    return 1 if substr($data, 4, 8) =~ /^ftyp(heic|heix|hevc|hevx|mif1|msf1)/;
    return (($mime // '') =~ m{^image/}) ? 1 : 0;
}

sub register_routes {
    my ($class, $r) = @_;
    $r->{family}->get('/chores')->to('chores#index');
    $r->{family}->get('/chores/api/state')->to('chores#api_state');
    $r->{family}->post('/chores/api/complete')->to('chores#api_complete');
    $r->{family}->post('/chores/api/submit')->to('chores#api_submit');
    $r->{family}->get('/chores/serve/:id')->to('chores#serve');
    $r->{family}->get('/chores/api/my_submissions')->to('chores#api_my_submissions');
    $r->{admin}->post('/chores/api/add')->to('chores#api_add');
    $r->{admin}->post('/chores/api/revoke')->to('chores#api_revoke');
    $r->{admin}->post('/chores/api/delete')->to('chores#api_delete');
    $r->{admin}->post('/chores/api/approve')->to('chores#api_approve');
    $r->{admin}->post('/chores/api/reject')->to('chores#api_reject');
}

1;
