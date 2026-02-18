# /lib/DB/Calendar.pm

package DB::Calendar;

use strict;
use warnings;
use Mojo::Util qw(trim);

# Database Helper for Family Calendar Management.
# Features:
#   - Event CRUD operations with timezone awareness
#   - Category/tag support for event classification
#   - All-day vs timed event handling
#   - User tagging via attendees field (comma-separated user IDs)
# Integration points:
#   - Extends DB package for database access
#   - Used by Calendar controller for all data operations

# Retrieves all calendar events within a date range.
# Parameters:
#   start_date : ISO format date string (YYYY-MM-DD) or undef for no lower bound
#   end_date   : ISO format date string (YYYY-MM-DD) or undef for no upper bound
# Returns:
#   ArrayRef of HashRefs containing event details sorted by start_date
#   Includes attendee_names field with comma-separated display names
sub DB::get_calendar_events {
    my ($self, $start_date, $end_date) = @_;
    $self->ensure_connection;
    
    # SCHEMA MATCH: Using underscored column names per 'DESCRIBE calendar_events'
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
            e.created_by,
            e.created_at,
            u.username as creator_name
        FROM calendar_events e
        LEFT JOIN users u ON e.created_by = u.id
        WHERE 1=1
    };
    
    my @params;
    
    if ($start_date) {
        $sql .= " AND e.end_date >= ?";
        push @params, $start_date;
    }
    
    if ($end_date) {
        # Normalize date-only parameters to include full day
        my $query_end = $end_date;

        if ($query_end =~ /^\d{4}-\d{2}-\d{2}$/) {
            $query_end .= ' 23:59:59';
        }
        
        $sql .= " AND e.start_date <= ?";
        push @params, $query_end;
    }
    
    $sql .= " ORDER BY e.start_date ASC, e.all_day DESC, e.title ASC";
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(@params);
    
    my $events = $sth->fetchall_arrayref({});
    
    # Pre-fetch all users for attendee resolution
    my $all_users = $self->get_all_users();
    
    # Map ID => "Display Name" (or "Username" fallback)
    my %user_map = map { 
        $_->{id} => ($_->{displayname} || $_->{username}) 
    } @$all_users;

    # Resolve attendee IDs to display names
    for my $event (@$events) {
        if ($event->{attendees}) {
            my @attendee_ids = split(',', $event->{attendees});
            my @names;
            
            for my $uid (@attendee_ids) {
                $uid = trim($uid);
                next unless $uid;
                
                push @names, $user_map{$uid} if $user_map{$uid};
            }
            
            $event->{attendee_names} = join(', ', @names);
        }
    }
    
    return $events;
}

# Retrieves a single event by ID.
# Parameters:
#   id : Unique Event ID (Integer)
# Returns:
#   HashRef containing event details or undef if not found
#   Includes attendee_names field with comma-separated display names
sub DB::get_calendar_event_by_id {
    my ($self, $id) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare(qq{
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
            e.created_by,
            e.created_at,
            u.username as creator_name
        FROM calendar_events e
        LEFT JOIN users u ON e.created_by = u.id
        WHERE e.id = ?
    });
    
    $sth->execute($id);
    my $event = $sth->fetchrow_hashref;
    
    return undef unless $event;
    
    # Resolve attendee IDs to display names
    if ($event->{attendees}) {
        my $all_users = $self->get_all_users();
        
        my %user_map = map { 
            $_->{id} => ($_->{displayname} || $_->{username}) 
        } @$all_users;
        
        my @attendee_ids = split(',', $event->{attendees});
        my @names;
        
        for my $uid (@attendee_ids) {
            $uid = trim($uid);
            next unless $uid;
            
            push @names, $user_map{$uid} if $user_map{$uid};
        }
        
        $event->{attendee_names} = join(', ', @names);
    }
    
    return $event;
}

# Creates a new calendar event.
# Parameters:
#   title       : Event title (Required)
#   description : Event description (Optional)
#   start_date  : ISO datetime string (YYYY-MM-DD HH:MM:SS)
#   end_date    : ISO datetime string (YYYY-MM-DD HH:MM:SS)
#   all_day     : Boolean flag (1 for all-day events, 0 for timed)
#   category    : Event category/tag (Optional)
#   color       : Hex color code (Optional, defaults to #3788d8)
#   attendees   : Comma-separated string of user IDs (Optional)
#   created_by  : User ID of creator (Integer)
# Returns:
#   Integer ID of newly created event
sub DB::add_calendar_event {
    my ($self, $title, $description, $start_date, $end_date, $all_day, $category, $color, $attendees, $created_by) = @_;
    $self->ensure_connection;
    
    $all_day     //= 0;
    $color       //= '#3788d8';
    $description //= '';
    $category    //= '';
    $attendees   //= '';
    
    my $sth = $self->{dbh}->prepare(qq{
        INSERT INTO calendar_events 
        (title, description, start_date, end_date, all_day, category, color, attendees, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    });
    
    $sth->execute($title, $description, $start_date, $end_date, $all_day, $category, $color, $attendees, $created_by);
    
    return $self->{dbh}->last_insert_id(undef, undef, 'calendar_events', 'id');
}

# Updates an existing calendar event.
# Parameters:
#   id          : Unique Event ID (Integer)
#   title       : Event title
#   description : Event description
#   start_date  : ISO datetime string
#   end_date    : ISO datetime string
#   all_day     : Boolean flag
#   category    : Event category/tag
#   color       : Hex color code
#   attendees   : Comma-separated string of user IDs
# Returns:
#   Result of execute (true on success)
sub DB::update_calendar_event {
    my ($self, $id, $title, $description, $start_date, $end_date, $all_day, $category, $color, $attendees) = @_;
    $self->ensure_connection;
    
    $attendees //= '';
    $all_day   //= 0;
    
    my $sth = $self->{dbh}->prepare(qq{
        UPDATE calendar_events SET
            title = ?,
            description = ?,
            start_date = ?,
            end_date = ?,
            all_day = ?,
            category = ?,
            color = ?,
            attendees = ?
        WHERE id = ?
    });
    
    return $sth->execute($title, $description, $start_date, $end_date, $all_day, $category, $color, $attendees, $id);
}

# Deletes a calendar event.
# Parameters:
#   id : Unique Event ID (Integer)
# Returns:
#   Result of execute (true on success)
sub DB::delete_calendar_event {
    my ($self, $id) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("DELETE FROM calendar_events WHERE id = ?");
    return $sth->execute($id);
}

# Retrieves all unique categories from existing events.
# Parameters: None
# Returns:
#   ArrayRef of category strings (excluding empty)
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