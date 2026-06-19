# /lib/MyApp/Controller/Calendar.pm

package MyApp::Controller::Calendar;
use Mojo::Base 'Mojolicious::Controller';
use DateTime;
use Encode qw(FB_CROAK encode);
use Mojo::JSON qw(false true);
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

# Helper: Normalises scalar AI/prompt context text for safe reuse.
# Parameters:
#   value : Candidate scalar value.
#   max   : Optional maximum character length.
# Returns:
#   Trimmed plain string with control whitespace collapsed.
sub _ai_plain {
    my ($value, $max) = @_;
    return '' if !defined $value || ref $value;
    $value = trim("$value");
    $value =~ s/[\r\n\t]+/ /g;
    $value =~ s/\s{2,}/ /g;
    return defined $max && length($value) > $max ? substr($value, 0, $max) : $value;
}

# Helper: Decodes an AI JSON response and requires a top-level object.
# Parameters:
#   c    : Mojolicious controller, used for the shared ai_decode_json helper.
#   text : Raw provider text, possibly already decoded with wide characters.
# Returns:
#   HashRef on success, undef on invalid/non-object JSON.
sub _decode_ai_calendar_json {
    my ($c, $text) = @_;
    my $parsed = $c->ai_decode_json($text);
    return $parsed if ref $parsed eq 'HASH';

    my $bytes = eval { encode('UTF-8', $text, FB_CROAK) };
    $parsed = $@ ? undef : $c->ai_decode_json($bytes);
    return ref $parsed eq 'HASH' ? $parsed : undef;
}

# Helper: Extracts text from the provider-neutral AI response envelope.
# Parameters:
#   data : AI provider response hash.
# Returns:
#   First text part string, or an empty string for malformed responses.
sub _extract_ai_calendar_text {
    my ($data) = @_;
    return '' unless ref $data eq 'HASH';

    my $candidates = $data->{candidates};
    return '' unless ref $candidates eq 'ARRAY' && @$candidates;

    my $candidate = $candidates->[0];
    return '' unless ref $candidate eq 'HASH';

    my $content = $candidate->{content};
    return '' unless ref $content eq 'HASH';

    my $parts = $content->{parts};
    return '' unless ref $parts eq 'ARRAY' && @$parts;

    my $part = $parts->[0];
    return ref $part eq 'HASH' ? ($part->{text} // '') : '';
}

# Helper: Parses a calendar datetime string using DateTime validation.
# Parameters:
#   value    : Datetime string in YYYY-MM-DD HH:MM:SS format.
#   timezone : IANA timezone name for local calendar interpretation.
# Returns:
#   DateTime object, or undef for malformed/impossible dates.
sub _parse_ai_datetime {
    my ($value, $timezone) = @_;
    return undef if !defined $value || ref $value;
    return undef unless $value =~ /\A(\d{4})-(\d{2})-(\d{2}) ([0-2]\d):([0-5]\d):([0-5]\d)\z/;
    my $dt = eval {
        DateTime->new(
            year      => $1,
            month     => $2,
            day       => $3,
            hour      => $4,
            minute    => $5,
            second    => $6,
            time_zone => $timezone || 'UTC'
        );
    };
    return $@ ? undef : $dt;
}

# Helper: Parses a calendar date string using DateTime validation.
# Parameters:
#   value    : Date string in YYYY-MM-DD format.
#   timezone : IANA timezone name for local calendar interpretation.
# Returns:
#   DateTime object, or undef for malformed/impossible dates.
sub _parse_ai_date {
    my ($value, $timezone) = @_;
    return undef if !defined $value || ref $value || $value eq '';
    return undef unless $value =~ /\A(\d{4})-(\d{2})-(\d{2})\z/;
    my $dt = eval {
        DateTime->new(
            year      => $1,
            month     => $2,
            day       => $3,
            time_zone => $timezone || 'UTC'
        );
    };
    return $@ ? undef : $dt;
}

# Helper: Formats a DateTime for Calendar DB/API form values.
# Parameters:
#   dt : DateTime object.
# Returns:
#   Datetime string in YYYY-MM-DD HH:MM:SS format.
sub _format_ai_datetime {
    my ($dt) = @_;
    return $dt->strftime('%F %T');
}

# Helper: Validates and normalises AI-parsed calendar fields.
# Parameters:
#   parsed     : Decoded AI response hash.
#   users      : Family user rows used to whitelist attendee IDs.
#   categories : Existing category names used to whitelist category.
#   timezone   : Calendar timezone for date parsing.
# Returns:
#   Sanitised API response hash with success true/false.
sub _normalise_ai_calendar_parse {
    my ($parsed, $users, $categories, $timezone) = @_;

    return { success => false, error => 'AI returned invalid data. Try again.' }
        unless ref $parsed eq 'HASH';

    if (!$parsed->{success}) {
        my $error = _ai_plain($parsed->{error}, 200);
        $error ||= 'Could not parse that description. Try being more specific.';
        return { success => false, error => $error };
    }

    my $title = _ai_plain($parsed->{title}, 255);
    return { success => false, error => 'Could not find an event title. Try being more specific.' }
        unless length $title;

    my $all_day = $parsed->{all_day} ? 1 : 0;
    my $start_dt = _parse_ai_datetime($parsed->{start_date}, $timezone);
    return { success => false, error => 'Could not find a valid start date and time.' }
        unless $start_dt;

    my $end_dt;
    if (defined $parsed->{end_date} && length "$parsed->{end_date}") {
        $end_dt = _parse_ai_datetime($parsed->{end_date}, $timezone);
        return { success => false, error => 'AI returned an invalid end date.' }
            unless $end_dt;
    }

    if ($all_day) {
        $start_dt = $start_dt->clone->set(hour => 0, minute => 0, second => 0);
        $end_dt = $end_dt && DateTime->compare($end_dt, $start_dt) > 0 ? $end_dt : $start_dt->clone;
        $end_dt = $end_dt->clone->set(hour => 23, minute => 59, second => 59);
    } else {
        $end_dt ||= $start_dt->clone->add(hours => 1);
        $end_dt = $start_dt->clone->add(hours => 1)
            if DateTime->compare($end_dt, $start_dt) <= 0;
    }

    my %valid_user_ids = map { int($_->{id} || 0) => 1 } @{$users || []};
    my %seen_attendees;
    my @attendee_ids;
    if (ref $parsed->{attendee_ids} eq 'ARRAY') {
        for my $id (@{$parsed->{attendee_ids}}) {
            next unless defined $id && !ref $id && "$id" =~ /\A\d+\z/;
            $id = int($id);
            next unless $valid_user_ids{$id} && !$seen_attendees{$id}++;
            push @attendee_ids, $id;
        }
    }

    my %category_by_lc = map { lc($_) => $_ } grep { defined $_ && !ref $_ } @{$categories || []};
    my $category = _ai_plain($parsed->{category}, 100);
    $category = length $category && exists $category_by_lc{lc $category} ? $category_by_lc{lc $category} : '';

    my $color = _ai_plain($parsed->{color}, 7);
    $color = '#3788d8' unless $color =~ /\A#[0-9A-Fa-f]{6}\z/;

    my $notification_minutes = 0;
    if (defined $parsed->{notification_minutes} && !ref $parsed->{notification_minutes}
        && "$parsed->{notification_minutes}" =~ /\A\d+\z/) {
        $notification_minutes = int($parsed->{notification_minutes});
        $notification_minutes = 11519 if $notification_minutes > 11519;
    }

    my $rule = _ai_plain($parsed->{recurrence_rule}, 20);
    my $interval = 1;
    if ($rule eq 'biweekly') {
        $rule = 'weekly';
        $interval = 2;
    } elsif ($rule =~ /\A(?:daily|weekly|monthly|yearly)\z/) {
        if (defined $parsed->{recurrence_interval} && !ref $parsed->{recurrence_interval}
            && "$parsed->{recurrence_interval}" =~ /\A\d+\z/) {
            $interval = int($parsed->{recurrence_interval});
            $interval = 1 if $interval < 1;
            $interval = 99 if $interval > 99;
        }
    } else {
        $rule = '';
    }

    my $recurrence_end_date = '';
    if ($rule && defined $parsed->{recurrence_end_date} && length "$parsed->{recurrence_end_date}") {
        my $end_date_dt = _parse_ai_date($parsed->{recurrence_end_date}, $timezone);
        $recurrence_end_date = $end_date_dt ? $end_date_dt->strftime('%F') : '';
    }

    return {
        success              => true,
        title                => $title,
        description          => _ai_plain($parsed->{description}, 2000),
        start_date           => _format_ai_datetime($start_dt),
        end_date             => _format_ai_datetime($end_dt),
        all_day              => $all_day ? true : false,
        category             => $category,
        color                => $color,
        attendee_ids         => \@attendee_ids,
        notification_minutes => $notification_minutes,
        is_private           => $parsed->{is_private} ? true : false,
        recurrence_rule      => $rule,
        recurrence_interval  => $rule ? $interval : 1,
        recurrence_end_date  => $recurrence_end_date
    };
}

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

    $c->render(json => {
        success         => 1,
        categories      => $categories,
        users           => $users,
        is_admin        => $c->is_admin ? 1 : 0,
        current_user_id => $c->current_user_id
    });
}

# API Endpoint: Parses a natural-language event description into unsaved form data.
# Route: POST /calendar/api/ai_parse
# Params:
#   prompt : Natural-language event description, capped at 2000 characters.
# Returns:
#   Sanitised event fields for client-side form fill; never persists the event.
sub api_ai_parse {
    my $c = shift;
    return $c->render(json => { success => false, error => 'Unauthorized' }, status => 403) unless $c->is_family;

    my $prompt = _ai_plain($c->param('prompt') // '', 2000);
    return $c->render(json => { success => false, error => 'Describe the event first.' })
        unless length $prompt;

    my $now = $c->now;
    my $timezone = eval { $now->time_zone->name } || $c->app->config->{timezone} || 'UTC';
    my $users = $c->db->get_family_users();
    my $categories = $c->db->get_calendar_categories();
    my $requester_id = int($c->current_user_id || 0);
    my $requester_name = _ai_plain($c->session('user') || 'Unknown', 80);

    my $user_context = join "\n", map {
        sprintf '- id: %d, username: %s', int($_->{id} || 0), _ai_plain($_->{username}, 80)
    } @{$users || []};
    $user_context ||= '- none';

    my $category_context = join "\n", map { '- ' . _ai_plain($_, 100) } @{$categories || []};
    $category_context ||= '- none';

    my $system = <<"PROMPT";
You parse family calendar event text into JSON for a review form. Return only valid JSON.
Current datetime: @{[$now->strftime('%F %T')]}
Timezone: $timezone
Requester: id $requester_id, username: $requester_name

Family users:
$user_context

Existing categories:
$category_context

Rules:
- Return {"success":false,"error":"..."} when the text is too vague to determine an event title and start date.
- Return success true with keys: title, description, start_date, end_date, all_day, category, color, attendee_ids, notification_minutes, is_private, recurrence_rule, recurrence_interval, recurrence_end_date.
- Dates must be absolute local times in YYYY-MM-DD HH:MM:SS.
- Missing non-all-day end_date should be start_date plus 1 hour.
- All-day events use start 00:00:00 and end 23:59:59.
- Title should start with one appropriate emoji.
- Use attendee_ids only from the Family users list. "with Nicky" means requester plus Nicky; "for Nicky" means Nicky only.
- Use category only when it exactly matches an Existing category; otherwise use an empty string.
- Use a #RRGGBB color.
- notification_minutes is an integer number of minutes before the event, or 0.
- recurrence_rule is "", daily, weekly, monthly, or yearly. For biweekly use recurrence_rule weekly and recurrence_interval 2.
- recurrence_end_date is YYYY-MM-DD or an empty string.
PROMPT

    $c->render_later;
    my $promise = eval {
        $c->ai_prompt(
            contents        => [{ role => 'user', parts => [{ text => $prompt }] }],
            system          => $system,
            timeout         => 30,
            response_format => 'application/json',
            app_profile     => 'calendar_ai_parse'
        );
    };

    unless ($promise) {
        my $err = $@ || 'AI request setup failed';
        $c->app->log->error("Calendar AI parse setup failed: $err");
        return $c->render(json => { success => false, error => 'AI parsing could not be started.' });
    }

    $promise->then(sub {
        my $data = shift;
        my $json_text = _extract_ai_calendar_text($data);
        my $response = eval {
            my $parsed = _decode_ai_calendar_json($c, $json_text);
            _normalise_ai_calendar_parse($parsed, $users, $categories, $timezone);
        };
        if ($@) {
            $c->app->log->error("Calendar AI parse normalization failed: $@");
            return $c->render(json => { success => false, error => 'AI returned invalid calendar data.' });
        }
        return $c->render(json => $response);
    })->catch(sub {
        my $err = shift;
        $c->app->log->error("Calendar AI parse failed: $err");
        return $c->render(json => { success => false, error => 'AI processing timed out or failed. Please try again.' });
    });

    return;
}

# API Endpoint: Retrieves events with optional server-side search and pagination.
# Route: GET /calendar/api/events
# Params:
#   start    : ISO date string for window start (calendar view — omit for history)
#   end      : ISO date string for window end (calendar view — omit for history)
#   search   : Text search applied as LIKE %?% against title and description
#   category : Exact category match applied at SQL level
#   limit    : Max base rows per page (default 0 = no limit; enforced max 500)
#   offset   : Pagination offset (default 0)
#   sort     : ASC, DESC, or NEAR (default ASC; history mode uses DESC)
sub api_events {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

    my $start    = $c->param('start')    // '';
    my $end      = $c->param('end')      // '';
    my $search   = $c->param('search')   // '';
    my $category = $c->param('category') // '';
    my $limit    = int($c->param('limit')  // 0);
    my $offset   = int($c->param('offset') // 0);
    my $sort     = uc($c->param('sort')  // 'ASC');

    $limit  = 500 if $limit > 500;
    $sort   = 'ASC' unless $sort eq 'DESC' || $sort eq 'NEAR';
    $offset = 0    if $offset < 0;

    my ($events, $has_more) = $c->db->get_calendar_events(
        $c->current_user_id,
        $c->is_admin ? 1 : 0,
        $start || undef,
        $end   || undef,
        { search => $search, category => $category, limit => $limit, offset => $offset, sort => $sort }
    );

    my %resp = (success => 1, events => $events);
    if ($sort eq 'NEAR') {
        $resp{server_now} = $c->now->strftime('%F %T');
    }
    if ($limit > 0) {
        $resp{has_more} = $has_more ? 1 : 0;
        $resp{offset}   = $offset;
        $resp{limit}    = $limit;
    }
    
    $c->render(json => \%resp);
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
    # ONLY admins are permitted to suppress family announcements.
    $send_notifications = (defined($send_notifications) && $send_notifications eq '0' && $c->is_admin) ? 0 : 1;
    
    my $category = trim($c->param('category') // '');
    my $color = trim($c->param('color') // '#3788d8');
    
    my $attendee_ids = $c->every_param('attendees[]');
    my $attendees = ($attendee_ids && @$attendee_ids) ? join(',', @$attendee_ids) : '';

    my $notification_minutes = $c->param('notification_minutes') // 0;
    my $recurrence_rule      = $c->param('recurrence_rule')      || undef;
    my $recurrence_interval  = $c->param('recurrence_interval')  || 1;
    my $recurrence_end_date  = $c->param('recurrence_end_date')  || undef;

    return $c->render(json => { success => 0, error => 'Title is required' }) unless $title;
    return $c->render(json => { success => 0, error => 'Start date is required' }) unless $start_date;
    return $c->render(json => { success => 0, error => 'End date is required' }) unless $end_date;

    # Ensure at least one attendee is selected if notifications are enabled.
    if ($notification_minutes > 0 && !$attendees) {
        return $c->render(json => { success => 0, error => 'Please select at least one attendee for notifications' });
    }

    if ($notification_minutes == 0 && $c->param('event_notify')) {
        return $c->render(json => { success => 0, error => 'Please select a reminder time' });
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
            $notification_minutes, $recurrence_rule, $recurrence_interval, $recurrence_end_date
        );
        
        # ONLY notify family if the event creation succeeded and it is NOT private
        if ($event_id && $send_notifications && !$is_private) {
            my $family_users   = $c->db->get_family_users();
            my $attendee_names = $c->db->get_attendee_names($attendees) // 'None';

            foreach my $user (@$family_users) {
                # Don't notify the creator themselves
                next if int($user->{id}) == int($user_id);

                $c->notify_templated($user->{id}, 'calendar_new', {
                    creator     => $creator_name,
                    title       => $title,
                    description => $description || 'No description',
                    start       => $c->format_datetime($start_date, $all_day),
                    end         => $c->format_datetime($end_date, $all_day),
                    category    => $category || 'General',
                    attendees   => $attendee_names,
                    id          => $event_id,
                    date        => substr($start_date // '', 0, 10)
                }, $event_id);
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
    my $send_notifications = $c->param('send_notifications');
    # ONLY admins are permitted to suppress family announcements.
    $send_notifications = (defined($send_notifications) && $send_notifications eq '0' && $c->is_admin) ? 0 : 1;

    my $category = trim($c->param('category') // '');
    my $color = trim($c->param('color') // '#3788d8');
    
    my $attendee_ids = $c->every_param('attendees[]');
    my $attendees = ($attendee_ids && @$attendee_ids) ? join(',', @$attendee_ids) : '';

    my $notification_minutes = $c->param('notification_minutes') // 0;
    my $recurrence_rule      = $c->param('recurrence_rule')      || undef;
    my $recurrence_interval  = $c->param('recurrence_interval')  || 1;
    my $recurrence_end_date  = $c->param('recurrence_end_date')  || undef;

    return $c->render(json => { success => 0, error => 'Event ID is required' }) unless $id;
    return $c->render(json => { success => 0, error => 'Title is required' }) unless $title;

    # Ensure at least one attendee is selected if notifications are enabled.
    if ($notification_minutes > 0 && !$attendees) {
        return $c->render(json => { success => 0, error => 'Please select at least one attendee for notifications' });
    }

    if ($notification_minutes == 0 && $c->param('event_notify')) {
        return $c->render(json => { success => 0, error => 'Please select a reminder time' });
    }

    if ($end_date lt $start_date) {
        return $c->render(json => { success => 0, error => 'End date cannot be before start date' });
    }

    # Reset notification status if the start time is modified to ensure 
    # the reminder fires for the new scheduled time.
    my $reset_notification = ($event->{start_date} ne $start_date) ? 1 : 0;
    
    eval {
        my $result = $c->db->update_calendar_event(
            $id, $title, $description, $start_date, $end_date,
            $all_day, $category, $color, $attendees, $is_private,
            $notification_minutes, $reset_notification,
            $recurrence_rule, $recurrence_interval, $recurrence_end_date
        );

        # Notify family if event is public and notifications are active
        if ($result && $result > 0 && $send_notifications && !$is_private) {
            my $family_users   = $c->db->get_family_users();
            my $attendee_names = $c->db->get_attendee_names($attendees) // 'None';
            my $editor_name    = $c->session('user') // 'Unknown';

            foreach my $user (@$family_users) {
                # Don't notify the editor themselves
                next if int($user->{id}) == int($user_id);
                
                $c->notify_templated($user->{id}, 'calendar_update', {
                    editor      => $editor_name,
                    title       => $title,
                    description => $description || 'No description',
                    start       => $c->format_datetime($start_date, $all_day),
                    end         => $c->format_datetime($end_date, $all_day),
                    category    => $category || 'General',
                    attendees   => $attendee_names,
                    id          => $id,
                    date        => substr($start_date // '', 0, 10)
                }, $id);
            }
        }

        if ($result && $result > 0) {
            $c->render(json => { success => 1, message => "Event updated" });
        } else {
            $c->render(json => { success => 0, error => "No changes made or event not found" });
        }
    };
    
    if ($@) {
        $c->app->log->error("Failed to update calendar event: $@");
        $c->render(json => { success => 0, error => "Database error occurred" });
    }
}

# API Endpoint: Marks a single occurrence of a recurring event as skipped.
# Appends the date to recurrence_exceptions on the base event row.
# Route: POST /calendar/api/skip_occurrence
sub api_skip_occurrence {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

    my $id      = $c->param('id');
    my $date    = $c->param('date');
    my $user_id = $c->current_user_id;
    my $is_admin = $c->is_admin ? 1 : 0;

    return $c->render(json => { success => 0, error => 'Missing parameters' }) unless $id && $date;

    my $event = $c->db->get_calendar_event_by_id($id, $user_id, $is_admin);
    unless ($event && ($event->{created_by} == $user_id || $is_admin)) {
        return $c->render(json => { success => 0, error => 'Forbidden' }, status => 403);
    }

    eval { $c->db->add_recurrence_exception($id, $date) };
    if ($@) {
        $c->app->log->error("Failed to skip occurrence: $@");
        return $c->render(json => { success => 0, error => 'Database error' });
    }

    $c->render(json => { success => 1 });
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


sub register_routes {
    my ($class, $r) = @_;
    $r->{family}->get('/calendar')->to('calendar#index');
    $r->{family}->get('/calendar/api/state')->to('calendar#api_state');
    $r->{family}->get('/calendar/api/events')->to('calendar#api_events');
    $r->{family}->post('/calendar/api/ai_parse')->to('calendar#api_ai_parse');
    $r->{family}->post('/calendar/api/add')->to('calendar#api_add');
    $r->{family}->post('/calendar/api/edit')->to('calendar#api_edit');
    $r->{family}->post('/calendar/api/delete')->to('calendar#api_delete');
    $r->{family}->post('/calendar/api/skip_occurrence')->to('calendar#api_skip_occurrence');
}

1;
