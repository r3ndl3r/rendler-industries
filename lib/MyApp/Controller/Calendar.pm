# /lib/MyApp/Controller/Calendar.pm

package MyApp::Controller::Calendar;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);
use utf8;

# Controller for the Family Calendar.
#
# Features:
#   - Multi-view calendar interface (Month, Week, Day).
#   - Administrative event management with upcoming/past filtering.
#   - Automated email notifications for new/public events.
#   - Attendee tracking and category color-coding.
#   - Strict Privacy Mandate: Events only visible to owner/admin.
#
# Integration Points:
#   - DB::Calendar for all persistence and category management.
#   - MyApp::Plugin::Email for automated notification delivery.
#   - FullCalendar-style data architecture via JSON state-driven handshakes.

# Renders the main calendar interface.
# Route: GET /calendar
sub index {
    my $c = shift;
    return $c->redirect_to('/auth') unless $c->is_logged_in;
    
    $c->stash(view => $c->param('view') || 'month', date => $c->param('date') || '');
    $c->render('calendar/calendar');
}

# API Endpoint: Retrieves structural metadata for UI bootstrapping.
# Route: GET /calendar/api/state
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;
    
    my $categories = $c->db->get_calendar_categories();
    my $all_users = $c->db->get_all_users();
    my $users = [ grep { $c->db->is_family($_->{username}) } @$all_users ];
    
    $c->render(json => {
        success    => 1,
        categories => $categories,
        users      => $users,
        is_admin   => $c->is_admin ? 1 : 0,
        current_user_id => $c->current_user_id
    });
}

# API Endpoint: Retrieves events for the interface with STRICT PRIVACY.
# Route: GET /calendar/api/events
sub api_events {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;
    
    my $start = $c->param('start');
    my $end   = $c->param('end');
    
    # Pass user context to DB for SQL-level strict filtering
    my $events = $c->db->get_calendar_events(
        $c->current_user_id, 
        $c->is_admin ? 1 : 0, 
        $start, 
        $end
    );
    
    $c->render(json => {
        success => 1,
        events  => $events
    });
}

# Renders the administrative management interface.
# Route: GET /calendar/manage
sub manage {
    my $c = shift;
    return $c->redirect_to('/auth') unless $c->is_logged_in;
    $c->render('calendar/manage');
}

# API Endpoint: Validates and creates a new calendar event.
# Route: POST /calendar/api/add
sub api_add {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;
    
    my $title = trim($c->param('title') // '');
    my $description = trim($c->param('description') // '');
    my $start_date = $c->param('start_date');
    my $end_date = $c->param('end_date');
    my $all_day = $c->param('all_day') ? 1 : 0;
    my $is_private = $c->param('is_private') ? 1 : 0;
    my $send_notifications = $c->param('send_notifications');
    
    $send_notifications = (defined($send_notifications) && $send_notifications eq '0') ? 0 : 1;
    
    my $category = trim($c->param('category') // '');
    my $color = trim($c->param('color') // '#3788d8');
    
    my $attendee_ids = $c->every_param('attendees[]');
    my $attendees = ($attendee_ids && @$attendee_ids) ? join(',', @$attendee_ids) : '';
    
    return $c->render(json => { success => 0, error => 'Title is required' }) unless $title;
    return $c->render(json => { success => 0, error => 'Start date is required' }) unless $start_date;
    return $c->render(json => { success => 0, error => 'End date is required' }) unless $end_date;

    if ($end_date lt $start_date) {
        return $c->render(json => { success => 0, error => 'End date cannot be before start date' });
    }
    
    my $user_id = $c->current_user_id;
    my $creator_name = $c->session('user') || 'Unknown';
    
    eval {
        my $event_id = $c->db->add_calendar_event(
            $title, $description, $start_date, $end_date,
            $all_day, $category, $color, $attendees, $user_id, $is_private
        );
        
        # Only notify others if the event is NOT private
        if ($send_notifications && !$is_private) {
            my $all_users = $c->db->get_all_users();
            my @family_emails = grep { $_->{email} && $c->db->is_family($_->{username}) } @$all_users;
            
            if (@family_emails) {
                my $subject = "New Calendar Event: $title";
                my $body = "A new event has been added to the calendar by $creator_name\n\nTitle: $title\nStart: $start_date\nEnd: $end_date";
                $c->send_email_via_gmail([ map { $_->{email} } @family_emails ], $subject, $body);
            }
        }
        
        $c->render(json => { success => 1, id => $event_id, message => "Event '$title' created" });
    };
    
    if ($@) {
        $c->app->log->error("Failed to add calendar event: $@");
        $c->render(json => { success => 0, error => "Database error occurred" });
    }
}

# API Endpoint: Updates an existing calendar event.
# Route: POST /calendar/api/edit
sub api_edit {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;
    
    my $id = $c->param('id');
    my $user_id = $c->current_user_id;
    my $is_admin = $c->is_admin ? 1 : 0;
    
    # MANDATE: Verify ownership or admin status before edit
    my $event = $c->db->get_calendar_event_by_id($id, $user_id, $is_admin);
    unless ($event && ($event->{created_by} == $user_id || $is_admin)) {
        return $c->render(json => { success => 0, error => 'Forbidden: You do not own this event' }, status => 403);
    }
    
    my $title = trim($c->param('title') // '');
    my $description = trim($c->param('description') // '');
    my $start_date = $c->param('start_date');
    my $end_date = $c->param('end_date');
    my $all_day = $c->param('all_day') ? 1 : 0;
    my $is_private = $c->param('is_private') ? 1 : 0;
    my $category = trim($c->param('category') // '');
    my $color = trim($c->param('color') // '#3788d8');
    
    my $attendee_ids = $c->every_param('attendees[]');
    my $attendees = ($attendee_ids && @$attendee_ids) ? join(',', @$attendee_ids) : '';
    
    return $c->render(json => { success => 0, error => 'Event ID is required' }) unless $id;
    return $c->render(json => { success => 0, error => 'Title is required' }) unless $title;

    if ($end_date lt $start_date) {
        return $c->render(json => { success => 0, error => 'End date cannot be before start date' });
    }
    
    eval {
        $c->db->update_calendar_event(
            $id, $title, $description, $start_date, $end_date,
            $all_day, $category, $color, $attendees, $is_private
        );
        $c->render(json => { success => 1, message => "Event updated" });
    };
    
    if ($@) {
        $c->app->log->error("Failed to update calendar event: $@");
        $c->render(json => { success => 0, error => "Database error occurred" });
    }
}

# API Endpoint: Deletes a calendar event.
# Route: POST /calendar/api/delete
sub api_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;
    
    my $id = $c->param('id');
    my $user_id = $c->current_user_id;
    my $is_admin = $c->is_admin ? 1 : 0;
    
    # MANDATE: Verify ownership or admin status before delete
    my $event = $c->db->get_calendar_event_by_id($id, $user_id, $is_admin);
    unless ($event && ($event->{created_by} == $user_id || $is_admin)) {
        return $c->render(json => { success => 0, error => 'Forbidden: You do not own this event' }, status => 403);
    }
    
    return $c->render(json => { success => 0, error => 'Event ID is required' }) unless $id;
    
    eval {
        $c->db->delete_calendar_event($id);
        $c->render(json => { success => 1, message => "Event removed" });
    };
    
    if ($@) {
        $c->app->log->error("Failed to delete calendar event: $@");
        $c->render(json => { success => 0, error => "Database error occurred" });
    }
}

1;
