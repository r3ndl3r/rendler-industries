# /lib/MyApp/Controller/Calendar.pm

package MyApp::Controller::Calendar;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);
use Time::Piece;
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
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family;
    
    $c->stash(view => $c->param('view') || 'month', date => $c->param('date') || '');
    $c->render('calendar/calendar');
}

# API Endpoint: Retrieves structural metadata for UI bootstrapping.
# Route: GET /calendar/api/state
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $categories = $c->db->get_calendar_categories();
    my $users      = $c->db->get_family_users();

    # Determine available notification channels
    my @channels = (
        { id => 'email', label => 'Email', icon => 'email' },
        { id => 'discord', label => 'Discord', icon => 'discord' }
    );

    # Admin-only channels
    if ($c->is_admin) {
        push @channels, { id => 'gotify', label => 'Gotify', icon => 'gotify' };
        push @channels, { id => 'pushover', label => 'Pushover', icon => 'pushover' };
    }
    
    $c->render(json => {
        success    => 1,
        categories => $categories,
        users      => $users,
        channels   => \@channels,
        is_admin   => $c->is_admin ? 1 : 0,
        current_user_id => $c->current_user_id
    });
}

# API Endpoint: Retrieves events for the interface with STRICT PRIVACY.
# Route: GET /calendar/api/events
sub api_events {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
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
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family;
    $c->render('calendar/manage');
}

# API Endpoint: Validates and creates a new calendar event.
# Route: POST /calendar/api/add
sub api_add {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
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

    my $notification_minutes = $c->param('notification_minutes') // 0;
    my $channel_list = $c->every_param('notification_channels[]');
    my $notification_channels = ($channel_list && @$channel_list) ? join(',', @$channel_list) : '';
    
    return $c->render(json => { success => 0, error => 'Title is required' }) unless $title;
    return $c->render(json => { success => 0, error => 'Start date is required' }) unless $start_date;
    return $c->render(json => { success => 0, error => 'End date is required' }) unless $end_date;

    # Ensure at least one attendee is selected if notifications are enabled.
    if ($notification_minutes > 0 && !$attendees) {
        return $c->render(json => { success => 0, error => 'Please select at least one attendee for notifications' });
    }

    if ($end_date lt $start_date) {
        return $c->render(json => { success => 0, error => 'End date cannot be before start date' });
    }
    
    my $user_id = $c->current_user_id;
    my $creator_name = $c->session('user') || 'Unknown';
    
    eval {
        my $event_id = $c->db->add_calendar_event(
            $title, $description, $start_date, $end_date,
            $all_day, $category, $color, $attendees, $user_id, $is_private,
            $notification_minutes, $notification_channels
        );
        
        # Only notify others if the event is NOT private
        if ($send_notifications && !$is_private) {
            my $family_users = $c->db->get_family_users();
            my @family_emails = grep { $_->{email} } @$family_users;
            
            if (@family_emails) {
                my $attendee_names = '';
                if ($attendees) {
                    my @attendee_ids = split(',', $attendees);
                    my @names;
                    for my $uid (@attendee_ids) {
                        my $user = $c->db->get_user_by_id($uid);
                        push @names, $user->{username} if $user;
                    }
                    $attendee_names = join(', ', @names) if @names;
                }
                
                my $formatted_start = $c->format_datetime($start_date, $all_day);
                my $formatted_end = $c->format_datetime($end_date, $all_day);
                
                my $subject = "New Calendar Event / เหตุการณ์ปฏิทินใหม่: $title";
                my $body = qq{A new event has been added to the calendar by $creator_name
มีเหตุการณ์ใหม่ถูกเพิ่มในปฏิทินโดย $creator_name


Event Details / รายละเอียดเหตุการณ์:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title / หัวข้อ: $title};

                $body .= qq{
Description / คำอธิบาย: $description} if $description;

                $body .= qq{


Start / เริ่ม: $formatted_start
End / สิ้นสุด: $formatted_end};

                $body .= qq{
Category / หมวดหมู่: $category} if $category;

                $body .= qq{
Participants / ผู้เข้าร่วม: $attendee_names} if $attendee_names;

                $body .= qq{



View the calendar / ดูปฏิทิน: } . $c->url_for('/calendar')->to_abs . qq{


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This notification was sent to family members.
การแจ้งเตือนนี้ถูกส่งถึงสมาชิกครอบครัว};

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
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $id = $c->param('id');
    my $user_id = $c->current_user_id;
    my $is_admin = $c->is_admin ? 1 : 0;
    
    # Verify ownership or admin status before allowing the edit.
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

    my $notification_minutes = $c->param('notification_minutes') // 0;
    my $channel_list = $c->every_param('notification_channels[]');
    my $notification_channels = ($channel_list && @$channel_list) ? join(',', @$channel_list) : '';
    
    return $c->render(json => { success => 0, error => 'Event ID is required' }) unless $id;
    return $c->render(json => { success => 0, error => 'Title is required' }) unless $title;

    # Ensure at least one attendee is selected if notifications are enabled.
    if ($notification_minutes > 0 && !$attendees) {
        return $c->render(json => { success => 0, error => 'Please select at least one attendee for notifications' });
    }

    if ($end_date lt $start_date) {
        return $c->render(json => { success => 0, error => 'End date cannot be before start date' });
    }

    # Reset notification status if the start time is modified to ensure 
    # the reminder fires for the new scheduled time.
    my $reset_notification = ($event->{start_date} ne $start_date) ? 1 : 0;
    
    eval {
        $c->db->update_calendar_event(
            $id, $title, $description, $start_date, $end_date,
            $all_day, $category, $color, $attendees, $is_private,
            $notification_minutes, $notification_channels, $reset_notification
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
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $id = $c->param('id');
    my $user_id = $c->current_user_id;
    my $is_admin = $c->is_admin ? 1 : 0;
    
    # Verify ownership or admin status before allowing deletion.
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
