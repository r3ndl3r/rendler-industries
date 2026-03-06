# /lib/MyApp/Controller/Calendar.pm

package MyApp::Controller::Calendar;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);
use utf8;

# Controller for the Family Calendar.
# Manages event scheduling, invitations, and chronological data visualization.
#
# Features:
#   - Multi-view calendar interface (Month, Week, Day).
#   - Administrative event management with upcoming/past filtering.
#   - Automated email notifications for new/updated events.
#   - Attendee tracking and category color-coding.
#
# Integration Points:
#   - DB::Calendar for all persistence and category management.
#   - MyApp::Plugin::Email for automated notification delivery.
#   - FullCalendar.js implementation via synchronized JSON handshakes.

# Renders the main calendar interface.
# Route: GET /calendar
sub index {
    my $c = shift;
    
    # Preserving original view/date params for initial JS focus
    my $view = $c->param('view') || 'month';
    my $date = $c->param('date') || '';
    
    $c->stash(
        view => $view,
        date => $date
    );
    
    $c->render('calendar/calendar');
}

# API Endpoint: Retrieves structural metadata for UI bootstrapping.
# Route: GET /calendar/api/state
# Returns: JSON object { categories, users, is_admin, success }
sub api_state {
    my $c = shift;
    
    my $categories = $c->db->get_calendar_categories();
    my $all_users = $c->db->get_all_users();
    
    # Filter to only family members for attendee selection
    my $users = [ grep { $c->db->is_family($_->{username}) } @$all_users ];
    
    $c->render(json => {
        success    => 1,
        categories => $categories,
        users      => $users,
        is_admin   => $c->is_admin ? 1 : 0
    });
}

# API Endpoint: Retrieves events for the interface.
# Route: GET /calendar/api/events
# Parameters:
#   - start : ISO date string (YYYY-MM-DD) for range start.
#   - end   : ISO date string (YYYY-MM-DD) for range end.
# Returns:
#   JSON: { success, events }
sub get_events {
    my $c = shift;
    
    my $start = $c->param('start');
    my $end   = $c->param('end');
    
    my $events = $c->db->get_calendar_events($start, $end);
    
    # Preserve original chronological sorting
    my @sorted = sort { $a->{start_date} cmp $b->{start_date} } @$events;
    
    $c->render(json => {
        success => 1,
        events  => \@sorted
    });
}

# Renders the administrative management interface.
# Route: GET /calendar/manage
sub manage {
    shift->render('calendar/manage');
}

# API Endpoint: Validates and creates a new calendar event.
# Route: POST /calendar/api/add
sub add {
    my $c = shift;
    
    my $title = trim($c->param('title') // '');
    my $description = trim($c->param('description') // '');
    my $start_date = $c->param('start_date');
    my $end_date = $c->param('end_date');
    my $all_day = $c->param('all_day') ? 1 : 0;
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
            $all_day, $category, $color, $attendees, $user_id
        );
        
        if ($send_notifications) {
            # Background notification logic preserved from original
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
sub edit {
    my $c = shift;
    
    my $id = $c->param('id');
    my $title = trim($c->param('title') // '');
    my $description = trim($c->param('description') // '');
    my $start_date = $c->param('start_date');
    my $end_date = $c->param('end_date');
    my $all_day = $c->param('all_day') ? 1 : 0;
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
            $all_day, $category, $color, $attendees
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
sub delete {
    my $c = shift;
    my $id = $c->param('id');
    
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
