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
                
                my $formatted_start = _format_datetime($start_date, $all_day);
                my $formatted_end = _format_datetime($end_date, $all_day);
                
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

# Helper: Formats a SQL datetime string into a user-friendly display string.
sub _format_datetime {
    my ($dt, $all_day) = @_;
    return '' unless $dt;
    
    my $t;
    eval {
        if ($dt =~ /^\d{4}-\d{2}-\d{2}$/) {
            $t = Time::Piece->strptime($dt, "%Y-%m-%d");
        } else {
            # Normalize seconds if missing or partial
            my $clean_dt = $dt;
            $clean_dt .= ":00" if $dt =~ /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
            $t = Time::Piece->strptime($clean_dt, "%Y-%m-%d %H:%M:%S");
        }
    };
    return $dt if $@ || !$t;

    my $day = $t->mday;
    my $suffix = 'th';
    if ($day !~ /^1[123]$/) {
        my $last_digit = $day % 10;
        $suffix = 'st' if $last_digit == 1;
        $suffix = 'nd' if $last_digit == 2;
        $suffix = 'rd' if $last_digit == 3;
    }

    if ($all_day) {
        return sprintf("%s, %d%s %s %d (All day)", $t->full_day, $day, $suffix, $t->full_month, $t->year);
    }

    my $h = $t->hour;
    my $ampm = $h >= 12 ? 'PM' : 'AM';
    $h = $h % 12;
    $h = 12 if $h == 0;
    
    return sprintf("%s, %d%s %s %d - %02d:%02d%s", 
        $t->full_day, $day, $suffix, $t->full_month, $t->year,
        $h, $t->min, $ampm
    );
}

# API Endpoint: Updates an existing calendar event.
# Route: POST /calendar/api/edit
sub api_edit {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
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
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
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
