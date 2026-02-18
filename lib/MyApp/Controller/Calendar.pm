# /lib/MyApp/Controller/Calendar.pm

package MyApp::Controller::Calendar;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);
use utf8;

# Calendar Controller
# Handles the display, management, and API endpoints for the Family Calendar.
# Features:
#   - Main calendar view (Month/Week/Day)
#   - Admin management interface
#   - Event CRUD operations with Email Notifications

# Renders the main calendar interface.
# Parameters:
#   view : (Optional) Calendar view mode ('month', 'week', 'day'). Defaults to 'month'.
#   date : (Optional) Initial focus date.
# Returns:
#   Renders 'calendar/calendar' template with categories and users stash.
sub index {
    my $c = shift;
    
    my $view = $c->param('view') || 'month';
    my $date = $c->param('date') || '';
    
    my $categories = $c->db->get_calendar_categories();
    my $users = $c->db->get_all_users();
    
    $c->stash(
        view => $view,
        date => $date,
        categories => $categories,
        users => $users
    );
    
    $c->render('calendar/calendar');
}

# API Endpoint: Retrieves events for the frontend calendar widget.
# Parameters:
#   start : ISO date string (YYYY-MM-DD) for the start of the range.
#   end   : ISO date string (YYYY-MM-DD) for the end of the range.
# Returns:
#   JSON response containing an array of event hash refs.
sub get_events {
    my $c = shift;
    
    my $start = $c->param('start');
    my $end = $c->param('end');
    
    my $events = $c->db->get_calendar_events($start, $end);
    
    @$events = sort { $a->{start_date} cmp $b->{start_date} } @$events;
    
    $c->render(json => $events);
}

# Renders the administrative management list for all events.
# Separates events into 'Upcoming' and 'Past' lists.
# Access restricted to Administrators.
# Parameters: None
# Returns:
#   Renders 'calendar/manage' template or redirects to '/noperm'.
sub manage {
    my $c = shift;
    
    return $c->redirect_to('/noperm') unless $c->is_admin;
    
    my $events = $c->db->get_calendar_events();
    
    my ($sec,$min,$hour,$mday,$mon,$year) = gmtime(time + 39600);
    my $now = sprintf("%04d-%02d-%02d %02d:%02d:%02d", $year+1900, $mon+1, $mday, $hour, $min, $sec);
    
    my @upcoming;
    my @past;
    
    for my $e (@$events) {
        my $compare_date = $e->{end_date} || $e->{start_date};
        
        if ($compare_date lt $now) {
            push @past, $e;
        } else {
            push @upcoming, $e;
        }
    }
    
    @upcoming = sort { $a->{start_date} cmp $b->{start_date} } @upcoming;
    @past = sort { $b->{start_date} cmp $a->{start_date} } @past;
    
    for my $event (@upcoming, @past) {
        $event->{start_date_formatted} = _format_datetime($event->{start_date}, $event->{all_day});
        $event->{end_date_formatted} = _format_datetime($event->{end_date}, $event->{all_day});
    }

    my $categories = $c->db->get_calendar_categories();
    my $users = $c->db->get_all_users();
    
    $c->stash(
        upcoming_events => \@upcoming,
        past_events => \@past,
        categories => $categories,
        users => $users
    );
    
    $c->render('calendar/manage');
}

# Helper: Formats a SQL datetime string into a user-friendly display string.
# Parameters:
#   dt      : SQL datetime string (YYYY-MM-DD HH:MM:SS)
#   all_day : Boolean flag (1 = All Day, 0 = Timed)
# Returns:
#   Formatted string (e.g., "DD/MM/YYYY (All day)" or "DD/MM/YYYY - HH:MM AM")
sub _format_datetime {
    my ($dt, $all_day) = @_;
    return '' unless $dt;
    
    if ($dt =~ /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/) {
        my ($y, $m, $d, $h, $min) = ($1, $2, $3, $4, $5);
        
        if ($all_day) {
            return sprintf("%02d/%02d/%04d (All day)", $d, $m, $y);
        }
        
        my $ampm = $h >= 12 ? 'PM' : 'AM';
        $h = $h % 12;
        $h = 12 if $h == 0;
        return sprintf("%02d/%02d/%04d - %02d:%02d%s", $d, $m, $y, $h, $min, $ampm);
    }
    
    return $dt;
}

# API Endpoint: Validates and creates a new calendar event.
# Sends email notifications to all users upon success.
# Parameters (POST):
#   title       : Event title (Required)
#   description : Event details
#   start_date  : Start date (Required)
#   end_date    : End date (Required)
#   all_day     : Boolean
#   category    : Event category
#   color       : Hex color code
#   attendees[] : List of user IDs
# Returns:
#   JSON: { success => 1, id => $id } or { success => 0, error => $msg }
sub add {
    my $c = shift;
    
    my $title = trim($c->param('title') // '');
    my $description = trim($c->param('description') // '');
    my $start_date = $c->param('start_date');
    my $end_date = $c->param('end_date');
    my $all_day = $c->param('all_day') ? 1 : 0;
    my $category = trim($c->param('category') // '');
    my $color = trim($c->param('color') // '#3788d8');
    
    my $attendee_ids = $c->every_param('attendees[]');
    my $attendees = '';
    if ($attendee_ids && ref($attendee_ids) eq 'ARRAY' && @$attendee_ids) {
        $attendees = join(',', @$attendee_ids);
    }
    
    return $c->render(json => { success => 0, error => 'Title is required' })
        unless $title;
    
    return $c->render(json => { success => 0, error => 'Start date is required' })
        unless $start_date;
    
    return $c->render(json => { success => 0, error => 'End date is required' })
        unless $end_date;

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
        
        my $all_users = $c->db->get_all_users();
        
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
        
        my $email_subject = "New Calendar Event / เหตุการณ์ปฏิทินใหม่: $title";
        my $email_body = qq{A new event has been added to the calendar by $creator_name
มีเหตุการณ์ใหม่ถูกเพิ่มในปฏิทินโดย $creator_name


Event Details / รายละเอียดเหตุการณ์:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title / หัวข้อ: $title};

        $email_body .= qq{
Description / คำอธิบาย: $description} if $description;

        $email_body .= qq{


Start / เริ่ม: $formatted_start
End / สิ้นสุด: $formatted_end};

        $email_body .= qq{
Category / หมวดหมู่: $category} if $category;

        $email_body .= qq{
Participants / ผู้เข้าร่วม: $attendee_names} if $attendee_names;

        $email_body .= qq{



View the calendar / ดูปฏิทิน: } . $c->url_for('/calendar')->to_abs . qq{


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This notification was sent to all users.
การแจ้งเตือนนี้ถูกส่งถึงผู้ใช้ทั้งหมด};

        my @all_emails;
        for my $user (@$all_users) {
            push @all_emails, $user->{email} if $user->{email};
        }

        if (@all_emails) {
            if ($c->send_email_via_gmail(\@all_emails, $email_subject, $email_body)) {
                my $sent_count = scalar(@all_emails);
                $c->app->log->info("Calendar event '$title' created by $creator_name. Notification sent to $sent_count users.");
            }
        } else {
            $c->app->log->info("Calendar event '$title' created by $creator_name. No users with email addresses.");
        }
        
        $c->render(json => { success => 1, id => $event_id });
    };
    
    if ($@) {
        $c->app->log->error("Failed to add calendar event: $@");
        $c->render(json => { success => 0, error => "Database error: $@" });
    }
}

# API Endpoint: Updates an existing calendar event.
# Parameters (POST):
#   id          : Event ID (Required)
#   title       : Event title (Required)
#   description : Event details
#   start_date  : Start date
#   end_date    : End date
#   all_day     : Boolean
#   category    : Event category
#   color       : Hex color code
#   attendees[] : List of user IDs
# Returns:
#   JSON: { success => 1 } or { success => 0, error => $msg }
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
    my $attendees = '';
    if ($attendee_ids && ref($attendee_ids) eq 'ARRAY' && @$attendee_ids) {
        $attendees = join(',', @$attendee_ids);
    }
    
    return $c->render(json => { success => 0, error => 'Event ID is required' })
        unless $id;
    
    return $c->render(json => { success => 0, error => 'Title is required' })
        unless $title;

    if ($end_date lt $start_date) {
        return $c->render(json => { success => 0, error => 'End date cannot be before start date' });
    }
    
    eval {
        $c->db->update_calendar_event(
            $id, $title, $description, $start_date, $end_date,
            $all_day, $category, $color, $attendees
        );
        $c->render(json => { success => 1 });
    };
    
    if ($@) {
        $c->app->log->error("Failed to update calendar event: $@");
        $c->render(json => { success => 0, error => "Database error: $@" });
    }
}

# API Endpoint: Deletes a calendar event.
# Parameters (POST):
#   id : Event ID (Required)
# Returns:
#   JSON: { success => 1 } or { success => 0, error => $msg }
sub delete {
    my $c = shift;
    
    my $id = $c->param('id');
    
    return $c->render(json => { success => 0, error => 'Event ID is required' })
        unless $id;
    
    eval {
        $c->db->delete_calendar_event($id);
        $c->render(json => { success => 1 });
    };
    
    if ($@) {
        $c->app->log->error("Failed to delete calendar event: $@");
        $c->render(json => { success => 0, error => "Database error: $@" });
    }
}

1;
