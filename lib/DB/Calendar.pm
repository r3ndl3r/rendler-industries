# /lib/DB/Calendar.pm

package DB::Calendar;

use strict;
use warnings;
use Mojo::Util qw(trim);

# Database Helper for Family Calendar Management.
#
# Features:
#   - Event CRUD operations with timezone awareness.
#   - Category/tag support for event classification.
#   - All-day vs timed event handling.
#   - User tagging via attendees field (comma-separated user IDs).
#   - Strict Privacy Mandate: Private events visible only to owner/admin.
#
# Integration points:
#   - Extends DB package for database access.
#   - Used by Calendar controller for all data operations.

# Retrieves calendar events within a date range with strict privacy filtering.
# Parameters:
#   user_id    : ID of current user (Integer)
#   is_admin   : Admin status flag (Boolean)
#   start_date : ISO format date string (YYYY-MM-DD) or undef
#   end_date   : ISO format date string (YYYY-MM-DD) or undef
# Returns:
#   ArrayRef of HashRefs containing filtered event details.
sub DB::get_calendar_events {
    my ($self, $user_id, $is_admin, $start_date, $end_date) = @_;
    $self->ensure_connection;
    
    # MANDATE: Strict Privacy Filter
    # Return events only if: Public OR Owned by user OR User is Admin
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
            e.created_by,
            e.created_at,
            u.username as creator_name
        FROM calendar_events e
        LEFT JOIN users u ON e.created_by = u.id
        WHERE (e.is_private = 0 OR e.created_by = ? OR ? = 1)
    };
    
    my @params = ($user_id, $is_admin);
    
    if ($start_date) {
        $sql .= " AND e.end_date >= ?";
        push @params, $start_date;
    }
    
    if ($end_date) {
        my $query_end = $end_date;
        $query_end .= ' 23:59:59' if $query_end =~ /^\d{4}-\d{2}-\d{2}$/;
        $sql .= " AND e.start_date <= ?";
        push @params, $query_end;
    }
    
    $sql .= " ORDER BY e.start_date ASC, e.all_day DESC, e.title ASC";
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(@params);
    
    my $events = $sth->fetchall_arrayref({});
    
    my $all_users = $self->get_all_users();
    my %user_map = map { $_->{id} => $_->{username} } @$all_users;

    for my $event (@$events) {
        if ($event->{attendees}) {
            my @names = map { $user_map{trim($_)} // () } split(',', $event->{attendees});
            $event->{attendee_names} = join(', ', @names);
        }
    }
    
    return $events;
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
        my %user_map = map { $_->{id} => $_->{username} } @$all_users;
        my @names = map { $user_map{trim($_)} // () } split(',', $event->{attendees});
        $event->{attendee_names} = join(', ', @names);
    }
    
    return $event;
}

# Creates a new calendar event.
# Parameters:
#   title, description, start_date, end_date, all_day, category, color, attendees, created_by, is_private
# Returns:
#   Last inserted ID (Integer).
sub DB::add_calendar_event {
    my ($self, $title, $description, $start_date, $end_date, $all_day, $category, $color, $attendees, $created_by, $is_private) = @_;
    $self->ensure_connection;
    
    $all_day     //= 0;
    $color       //= '#3788d8';
    $description //= '';
    $category    //= '';
    $attendees   //= '';
    $is_private  //= 0;
    
    my $sth = $self->{dbh}->prepare(qq{
        INSERT INTO calendar_events 
        (title, description, start_date, end_date, all_day, category, color, attendees, created_by, is_private)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    });
    
    $sth->execute($title, $description, $start_date, $end_date, $all_day, $category, $color, $attendees, $created_by, $is_private);
    
    return $self->{dbh}->last_insert_id(undef, undef, 'calendar_events', 'id');
}

# Updates an existing calendar event.
# Parameters:
#   id, title, description, start_date, end_date, all_day, category, color, attendees, is_private
# Returns:
#   Success flag (Boolean).
sub DB::update_calendar_event {
    my ($self, $id, $title, $description, $start_date, $end_date, $all_day, $category, $color, $attendees, $is_private) = @_;
    $self->ensure_connection;
    
    $attendees  //= '';
    $all_day    //= 0;
    $is_private //= 0;
    
    my $sth = $self->{dbh}->prepare(qq{
        UPDATE calendar_events SET
            title = ?,
            description = ?,
            start_date = ?,
            end_date = ?,
            all_day = ?,
            category = ?,
            color = ?,
            attendees = ?,
            is_private = ?
        WHERE id = ?
    });
    
    return $sth->execute($title, $description, $start_date, $end_date, $all_day, $category, $color, $attendees, $is_private, $id);
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

1;
