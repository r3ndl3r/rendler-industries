# /lib/DB/Calendar.pm

package DB::Calendar;

use strict;
use warnings;
use Mojo::Util qw(trim);
use Time::Piece;
use Mojo::JSON qw(decode_json encode_json);

# Database Helper for Family Calendar Management.
#
# Features:
#   - Event CRUD operations with timezone awareness.
#   - Category/tag support for event classification.
#   - All-day vs timed event handling.
#   - User tagging via attendees field (comma-separated user IDs).
#   - Recurring event expansion: base events are synthesised into per-occurrence
#     instances at query time within the requested date window.
#   - Strict Privacy Mandate: Private events visible only to owner/admin.
#
# Integration points:
#   - Extends DB package for database access.
#   - Used by Calendar controller for all data operations.

# Generates occurrence hashrefs for a recurring event within a date window.
# Uses Time::Piece for daily/weekly arithmetic; manual month/year stepping with
# leap-year-safe day clamping for monthly/yearly rules.
#
# Parameters:
#   event     : Base event hashref with recurrence fields populated
#   win_start : Window start as ISO date string (YYYY-MM-DD)
#   win_end   : Window end as ISO date string (YYYY-MM-DD)
#   limit     : Max instances to generate (default 365). Pass 1 for history mode
#               where the caller only needs one representative per series.
# Returns:
#   Array of instance hashrefs (empty if none fall in window).
#   Each instance carries is_recurring_instance=>1, recurrence_source_id, instance_date.
sub _expand_recurring {
    my ($event, $win_start, $win_end, $limit) = @_;
    $limit //= 365;

    my $rule         = $event->{recurrence_rule}     or return ();
    my $interval     = $event->{recurrence_interval} || 1;
    my $end_date_str = $event->{recurrence_end_date};

    my $base_start = Time::Piece->strptime($event->{start_date}, '%Y-%m-%d %H:%M:%S');
    my $base_end   = Time::Piece->strptime($event->{end_date},   '%Y-%m-%d %H:%M:%S');
    my $duration   = $base_end - $base_start;

    my ($base_y, $base_m, $base_d) = $event->{start_date} =~ /^(\d{4})-(\d{2})-(\d{2})/;
    $base_d = int($base_d);

    my $exc_raw    = $event->{recurrence_exceptions};
    my $exceptions = $exc_raw ? decode_json($exc_raw) : [];
    my %skip       = map { $_ => 1 } @$exceptions;

    my @instances;
    my $step = 0;

    while (scalar(@instances) < $limit) {
        my ($occ_y, $occ_m, $occ_d);

        if ($rule eq 'daily') {
            my $tp = $base_start + $step * $interval * 86400;
            ($occ_y, $occ_m, $occ_d) = ($tp->year, $tp->mon, $tp->mday);

        } elsif ($rule eq 'weekly') {
            my $tp = $base_start + $step * $interval * 7 * 86400;
            ($occ_y, $occ_m, $occ_d) = ($tp->year, $tp->mon, $tp->mday);

        } elsif ($rule eq 'monthly') {
            my $total   = $base_m + $step * $interval - 1;
            $occ_y      = $base_y + int($total / 12);
            $occ_m      = ($total % 12) + 1;
            # Clamp day: first-of-next-month minus one day handles variable lengths and leap years
            my ($nx_m, $nx_y) = $occ_m == 12 ? (1, $occ_y + 1) : ($occ_m + 1, $occ_y);
            my $last = (Time::Piece->strptime(sprintf('%04d-%02d-01', $nx_y, $nx_m), '%Y-%m-%d') - 86400)->mday;
            $occ_d = $base_d > $last ? $last : $base_d;

        } elsif ($rule eq 'yearly') {
            $occ_y = $base_y + $step * $interval;
            $occ_m = $base_m;
            my ($nx_m, $nx_y) = $occ_m == 12 ? (1, $occ_y + 1) : ($occ_m + 1, $occ_y);
            my $last = (Time::Piece->strptime(sprintf('%04d-%02d-01', $nx_y, $nx_m), '%Y-%m-%d') - 86400)->mday;
            $occ_d = $base_d > $last ? $last : $base_d;

        } else {
            last;
        }

        $step++;

        my $occ_date = sprintf('%04d-%02d-%02d', $occ_y, $occ_m, $occ_d);

        last if $end_date_str && $occ_date gt $end_date_str;
        last if $occ_date gt $win_end;

        next if $skip{$occ_date};
        next if $occ_date lt $win_start;

        my $time_start   = (split ' ', $event->{start_date}, 2)[1] // '00:00:00';
        my $occ_start_tp = Time::Piece->strptime("$occ_date $time_start", '%Y-%m-%d %H:%M:%S');
        my $occ_end_tp   = $occ_start_tp + $duration;

        push @instances, {
            %$event,
            start_date            => "$occ_date $time_start",
            end_date              => $occ_end_tp->strftime('%Y-%m-%d %H:%M:%S'),
            is_recurring_instance => 1,
            recurrence_source_id  => $event->{id},
            instance_date         => $occ_date,
        };
    }

    return @instances;
}

# Retrieves calendar events with optional server-side search, category filter,
# sort direction, and pagination. Returns a two-element list so callers MUST
# use list destructuring: my ($events, $has_more) = $self->get_calendar_events(...)
# Assigning to a scalar silently captures $has_more (last list element) instead of the arrayref.
#
# Parameters:
#   user_id    : ID of current user (Integer)
#   is_admin   : Admin status flag (Boolean)
#   start_date : ISO format date string (YYYY-MM-DD) or undef
#   end_date   : ISO format date string (YYYY-MM-DD) or undef
#   opts       : HashRef of optional parameters:
#                  search   => text applied as LIKE %?% against title/description
#                  category => exact category match
#                  limit    => max rows (0 = no limit); fetch limit+1 to detect has_more
#                  offset   => SQL OFFSET (default 0)
#                  sort     => 'ASC' or 'DESC' (default 'ASC')
# Returns:
#   Two-element list: (\@result, $has_more)
sub DB::get_calendar_events {
    my ($self, $user_id, $is_admin, $start_date, $end_date, $opts) = @_;
    $self->ensure_connection;

    $opts //= {};
    my $search   = $opts->{search}   // '';
    my $category = $opts->{category} // '';
    my $limit    = int($opts->{limit}  // 0);
    my $offset   = int($opts->{offset} // 0);
    my $sort     = (uc($opts->{sort} // '') eq 'DESC') ? 'DESC' : 'ASC';

    my $sql = qq{
        SELECT
            e.id,
            e.title,
            e.description,
            e.start_date,
            e.end_date,
            e.all_day,
            e.category,
            e.color,
            e.attendees,
            e.is_private,
            e.notification_minutes,
            e.last_notified_at,
            e.created_by,
            e.created_at,
            e.recurrence_rule,
            e.recurrence_interval,
            e.recurrence_end_date,
            e.recurrence_exceptions,
            u.username as creator_name
        FROM calendar_events e
        LEFT JOIN users u ON e.created_by = u.id
        WHERE (e.is_private = 0 OR e.created_by = ? OR ? = 1)
    };

    my @params = ($user_id, $is_admin);

    if ($start_date && $end_date) {
        my $query_end = $end_date;
        $query_end .= ' 23:59:59' if $query_end =~ /^\d{4}-\d{2}-\d{2}$/;
        # Non-recurring events must overlap the window.
        # Recurring events are fetched whenever their series could produce instances
        # in the window: base date before window end, series end after window start.
        $sql .= qq{
            AND (
                (e.recurrence_rule IS NULL AND e.end_date >= ? AND e.start_date <= ?)
                OR
                (e.recurrence_rule IS NOT NULL AND e.start_date <= ?
                 AND (e.recurrence_end_date IS NULL OR e.recurrence_end_date >= ?))
            )
        };
        push @params, $start_date, $query_end, $query_end, $start_date;
    } elsif ($start_date) {
        $sql .= " AND e.end_date >= ?";
        push @params, $start_date;
    } elsif ($end_date) {
        my $query_end = $end_date;
        $query_end .= ' 23:59:59' if $query_end =~ /^\d{4}-\d{2}-\d{2}$/;
        $sql .= " AND e.start_date <= ?";
        push @params, $query_end;
    }

    if ($category ne '') {
        $sql .= " AND e.category = ?";
        push @params, $category;
    }

    if ($search ne '') {
        $sql .= " AND (e.title LIKE ? OR e.description LIKE ?)";
        my $like = '%' . $search . '%';
        push @params, $like, $like;
    }

    $sql .= " ORDER BY e.start_date $sort, e.all_day DESC, e.title ASC";

    if ($limit > 0) {
        # Fetch one extra row to detect whether more pages exist beyond this window.
        $sql .= " LIMIT ? OFFSET ?";
        push @params, $limit + 1, $offset;
    }

    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(@params);
    my $rows = $sth->fetchall_arrayref({});

    my $has_more = 0;
    if ($limit > 0 && scalar(@$rows) > $limit) {
        $has_more = 1;
        pop @$rows;
    }

    my $all_users = $self->get_all_users();
    my %user_map  = map { $_->{id} => $_->{username} } @$all_users;

    my $exp_start   = $start_date || '1970-01-01';
    my $exp_end     = $end_date   || '9999-12-31';
    my $recur_limit = 365;

    my @result;
    for my $event (@$rows) {
        if ($event->{attendees}) {
            my @names = map { $user_map{trim($_)} // () } split(',', $event->{attendees});
            $event->{attendee_names} = join(', ', @names);
        }

        if ($event->{recurrence_rule}) {
            push @result, _expand_recurring($event, $exp_start, $exp_end, $recur_limit);
        } else {
            push @result, $event;
        }
    }

    return (\@result, $has_more);
}

# Retrieves a single event by ID with strict privacy check.
# Parameters:
#   id       : Unique Event ID (Integer)
#   user_id  : ID of current user (Integer)
#   is_admin : Admin status flag (Boolean)
# Returns:
#   HashRef or undef if not found/unauthorized.
sub DB::get_calendar_event_by_id {
    my ($self, $id, $user_id, $is_admin) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(qq{
        SELECT
            e.*,
            u.username as creator_name
        FROM calendar_events e
        LEFT JOIN users u ON e.created_by = u.id
        WHERE e.id = ? AND (e.is_private = 0 OR e.created_by = ? OR ? = 1)
    });

    $sth->execute($id, $user_id, $is_admin);
    my $event = $sth->fetchrow_hashref;

    return undef unless $event;

    if ($event->{attendees}) {
        my $all_users = $self->get_all_users();
        my %user_map  = map { $_->{id} => $_->{username} } @$all_users;
        my @names     = map { $user_map{trim($_)} // () } split(',', $event->{attendees});
        $event->{attendee_names} = join(', ', @names);
    }

    return $event;
}

# Creates a new calendar event.
# Parameters:
#   title, description, start_date, end_date, all_day, category, color,
#   attendees, created_by, is_private, notification_minutes,
#   recurrence_rule, recurrence_interval, recurrence_end_date
# Returns:
#   Last inserted ID (Integer).
sub DB::add_calendar_event {
    my ($self, $title, $description, $start_date, $end_date, $all_day, $category, $color,
        $attendees, $created_by, $is_private, $notification_minutes,
        $recurrence_rule, $recurrence_interval, $recurrence_end_date) = @_;
    $self->ensure_connection;

    $all_day              //= 0;
    $color                //= '#3788d8';
    $description          //= '';
    $category             //= '';
    $attendees            //= '';
    $is_private           //= 0;
    $notification_minutes //= 0;
    $recurrence_interval  //= 1;

    my $sth = $self->{dbh}->prepare(qq{
        INSERT INTO calendar_events
        (title, description, start_date, end_date, all_day, category, color, attendees,
         created_by, is_private, notification_minutes,
         recurrence_rule, recurrence_interval, recurrence_end_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    });

    $sth->execute($title, $description, $start_date, $end_date, $all_day, $category, $color,
        $attendees, $created_by, $is_private, $notification_minutes,
        $recurrence_rule, $recurrence_interval, $recurrence_end_date);

    return $self->{dbh}->last_insert_id(undef, undef, 'calendar_events', 'id');
}

# Updates an existing calendar event.
# Updating a series resets recurrence_exceptions so prior skips do not persist
# against a redefined schedule.
# Parameters:
#   id, title, description, start_date, end_date, all_day, category, color,
#   attendees, is_private, notification_minutes, reset_notification,
#   recurrence_rule, recurrence_interval, recurrence_end_date
# Returns:
#   Success flag (Boolean).
sub DB::update_calendar_event {
    my ($self, $id, $title, $description, $start_date, $end_date, $all_day, $category, $color,
        $attendees, $is_private, $notification_minutes, $reset_notification,
        $recurrence_rule, $recurrence_interval, $recurrence_end_date) = @_;
    $self->ensure_connection;

    $attendees            //= '';
    $all_day              //= 0;
    $is_private           //= 0;
    $notification_minutes //= 0;
    $recurrence_interval  //= 1;

    my $sql = qq{
        UPDATE calendar_events SET
            title = ?,
            description = ?,
            start_date = ?,
            end_date = ?,
            all_day = ?,
            category = ?,
            color = ?,
            attendees = ?,
            is_private = ?,
            notification_minutes = ?,
            recurrence_rule = ?,
            recurrence_interval = ?,
            recurrence_end_date = ?,
            recurrence_exceptions = NULL
    };

    $sql .= ", last_notified_at = NULL " if $reset_notification;
    $sql .= " WHERE id = ?";

    my $sth = $self->{dbh}->prepare($sql);

    return $sth->execute($title, $description, $start_date, $end_date, $all_day, $category, $color,
        $attendees, $is_private, $notification_minutes,
        $recurrence_rule, $recurrence_interval, $recurrence_end_date,
        $id);
}

# Appends a date string to the recurrence_exceptions JSON array for a recurring event.
# Idempotent — inserting the same date twice produces no duplicate.
# Parameters:
#   id       : Base event ID (Integer)
#   date_str : Date to skip in YYYY-MM-DD format (String)
sub DB::add_recurrence_exception {
    my ($self, $id, $date_str) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("SELECT recurrence_exceptions FROM calendar_events WHERE id = ?");
    $sth->execute($id);
    my ($raw) = $sth->fetchrow_array;

    my $exceptions = $raw ? decode_json($raw) : [];
    push @$exceptions, $date_str unless grep { $_ eq $date_str } @$exceptions;

    my $upd = $self->{dbh}->prepare("UPDATE calendar_events SET recurrence_exceptions = ? WHERE id = ?");
    $upd->execute(encode_json($exceptions), $id);
}

# Deletes a calendar event.
# Parameters:
#   id : Unique Event ID (Integer)
# Returns:
#   Success flag (Boolean).
sub DB::delete_calendar_event {
    my ($self, $id) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("DELETE FROM calendar_events WHERE id = ?");
    return $sth->execute($id);
}

# Retrieves all unique categories from existing events.
# Parameters: None.
# Returns:
#   ArrayRef of category strings.
sub DB::get_calendar_categories {
    my ($self) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(qq{
        SELECT DISTINCT category
        FROM calendar_events
        WHERE category IS NOT NULL AND category != ''
        ORDER BY category ASC
    });

    $sth->execute();

    my @categories;
    while (my ($cat) = $sth->fetchrow_array) {
        push @categories, $cat;
    }

    return \@categories;
}

# Finds recurring events whose current occurrence notification is due but not yet sent.
# Compares last_notified_at against each occurrence's trigger time to avoid double-firing.
# Parameters:
#   now_str : Current datetime as 'YYYY-MM-DD HH:MM:SS'
# Returns:
#   ArrayRef of event hashrefs with start_date/end_date replaced by the due occurrence's datetimes.
sub DB::get_due_recurring_reminders {
    my ($self, $now_str) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "SELECT * FROM calendar_events
         WHERE recurrence_rule IS NOT NULL
           AND notification_minutes > 0"
    );
    $sth->execute();
    my $rows = $sth->fetchall_arrayref({});

    my $now_tp = Time::Piece->strptime($now_str, '%Y-%m-%d %H:%M:%S');
    my @due;

    foreach my $event (@$rows) {
        my $win_start = $now_tp->strftime('%Y-%m-%d');
        my $win_end   = ($now_tp + ($event->{notification_minutes} * 60))->strftime('%Y-%m-%d');

        my @instances = _expand_recurring($event, $win_start, $win_end);

        foreach my $occ (@instances) {
            my $occ_tp      = Time::Piece->strptime($occ->{start_date}, '%Y-%m-%d %H:%M:%S');
            my $trigger_tp  = $occ_tp - ($event->{notification_minutes} * 60);
            my $trigger_str = $trigger_tp->strftime('%Y-%m-%d %H:%M:%S');

            next if $trigger_tp > $now_tp;

            # Safety net against clock skew between DB and Perl on overlapping polls.
            next if $event->{last_notified_at} && $event->{last_notified_at} ge $trigger_str;

            push @due, { %$event, start_date => $occ->{start_date}, end_date => $occ->{end_date} };
            last; # At most one occurrence per series per poll; last_notified_at advances to next occurrence.
        }
    }

    return \@due;
}

1;
