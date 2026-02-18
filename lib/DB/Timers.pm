# /lib/DB/Timers.pm

package DB::Timers;

use strict;
use warnings;
use DateTime;
use DateTime::Duration;

# Timer Management Database Helper.
# Responsibilities:
#   - CRUD operations for user timers and daily sessions
#   - Real-time session state tracking (start/stop/pause)
#   - Automatic daily session initialization at configured reset time
#   - Weekday vs Weekend limit calculation
#   - Quiet hours enforcement (9 PM - 7 AM)
#   - Admin bonus time grants and audit logging
# Integration points:
#   - Uses Australia/Melbourne timezone for all date/time operations
#   - Coordinates with Settings module for daily reset time configuration
#   - Triggers email notifications via Email plugin helper

# Retrieve all active timers for a specific user.
# Parameters:
#   user_id : Unique user identifier
# Returns:
#   ArrayRef of hashrefs containing timer definitions with current session state
sub DB::get_user_timers {
    my ($self, $user_id) = @_;
    
    $self->ensure_connection();
    
    my $today = $self->_get_current_date();
    
    my $sql = q{
        SELECT 
            t.id,
            t.name,
            t.category,
            t.weekday_minutes,
            t.weekend_minutes,
            t.is_active,
            ts.elapsed_seconds,
            ts.bonus_seconds,
            ts.is_running,
            ts.started_at,
            ts.is_paused,
            ts.paused_at,
            ts.warning_sent,
            ts.expired_sent,
            ts.session_date
        FROM timers t
        LEFT JOIN timer_sessions ts ON t.id = ts.timer_id AND ts.session_date = ?
        WHERE t.user_id = ? AND t.is_active = 1
        ORDER BY t.category, t.name
    };
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($today, $user_id);
    
    my @timers;
    while (my $row = $sth->fetchrow_hashref) {
        # Calculate time limit based on day of week
        my $limit_minutes = $self->_is_weekend($today) 
            ? $row->{weekend_minutes} 
            : $row->{weekday_minutes};
        
        $row->{limit_seconds} = ($limit_minutes * 60) + ($row->{bonus_seconds} // 0);
        $row->{elapsed_seconds} //= 0;
        $row->{is_running} //= 0;
        $row->{is_paused} //= 0;
        
        # Calculate remaining time
        $row->{remaining_seconds} = $row->{limit_seconds} - $row->{elapsed_seconds};
        
        # Determine status color
        my $usage_percent = $row->{limit_seconds} > 0 
            ? ($row->{elapsed_seconds} / $row->{limit_seconds}) * 100 
            : 0;
        
        if ($usage_percent >= 100) {
            $row->{status_color} = 'red';
        } elsif ($usage_percent >= 80) {
            $row->{status_color} = 'yellow';
        } else {
            $row->{status_color} = 'green';
        }
        
        push @timers, $row;
    }
    
    return \@timers;
}

# Retrieve all timers across all users (Admin view).
# Parameters:
#   user_id : Optional - Filter by specific user, or undef for all users
# Returns:
#   ArrayRef of hashrefs with timer data including username
sub DB::get_all_timers {
    my ($self, $user_id) = @_;
    
    $self->ensure_connection();
    
    my $today = $self->_get_current_date();
    
    my $sql = q{
        SELECT 
            t.id,
            t.user_id,
            u.username,
            t.name,
            t.category,
            t.weekday_minutes,
            t.weekend_minutes,
            t.is_active,
            ts.elapsed_seconds,
            ts.bonus_seconds,
            ts.is_running,
            ts.is_paused,
            ts.warning_sent,
            ts.expired_sent
        FROM timers t
        JOIN users u ON t.user_id = u.id
        LEFT JOIN timer_sessions ts ON t.id = ts.timer_id AND ts.session_date = ?
        WHERE t.is_active = 1
    };

    my @params = ($today);

    if (defined $user_id) {
        $sql .= " AND t.user_id = ?";
        push @params, $user_id;
    }
    
    $sql .= " ORDER BY u.username, t.category, t.name";
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(@params);
    
    my @timers;
    while (my $row = $sth->fetchrow_hashref) {
        my $limit_minutes = $self->_is_weekend($today) 
            ? $row->{weekend_minutes} 
            : $row->{weekday_minutes};
        
        $row->{limit_seconds} = ($limit_minutes * 60) + ($row->{bonus_seconds} // 0);
        $row->{elapsed_seconds} //= 0;
        $row->{remaining_seconds} = $row->{limit_seconds} - $row->{elapsed_seconds};
        
        push @timers, $row;
    }
    
    return \@timers;
}

# Create a new timer for a user.
# Parameters:
#   user_id          : Target user ID
#   name             : Timer display name
#   category         : Device category (Computer, Phone, Tablet, Gaming Console, TV)
#   weekday_minutes  : Daily limit for weekdays
#   weekend_minutes  : Daily limit for weekends
#   admin_id         : ID of admin creating the timer
# Returns:
#   Integer timer_id on success, dies on failure
sub DB::create_timer {
    my ($self, $user_id, $name, $category, $weekday_minutes, $weekend_minutes, $admin_id) = @_;
    
    $self->ensure_connection();
    
    my $sql = q{
        INSERT INTO timers (user_id, name, category, weekday_minutes, weekend_minutes, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
    };
    
    $self->{dbh}->do($sql, undef, $user_id, $name, $category, $weekday_minutes, $weekend_minutes, $admin_id);
    
    my $timer_id = $self->{dbh}->last_insert_id(undef, undef, 'timers', 'id');
    
    # Log the creation
    $self->_log_timer_action($timer_id, $admin_id, 'created', "Timer '$name' created for user $user_id");
    
    return $timer_id;
}

# Update an existing timer's configuration.
# Parameters:
#   timer_id         : Unique timer ID
#   name             : New display name
#   category         : New category
#   weekday_minutes  : New weekday limit
#   weekend_minutes  : New weekend limit
#   admin_id         : ID of admin making the change
# Returns:
#   Boolean success status
sub DB::update_timer {
    my ($self, $timer_id, $name, $category, $weekday_minutes, $weekend_minutes, $admin_id) = @_;
    
    $self->ensure_connection();
    
    # Get old limits for logging
    my $old_timer = $self->_get_timer_by_id($timer_id);
    
    my $sql = q{
        UPDATE timers 
        SET name = ?, category = ?, weekday_minutes = ?, weekend_minutes = ? 
        WHERE id = ?
    };
    
    my $rows = $self->{dbh}->do($sql, undef, $name, $category, $weekday_minutes, $weekend_minutes, $timer_id);
    
    if ($rows > 0) {
        my $old_wd = $old_timer->{weekday_minutes};
        my $old_we = $old_timer->{weekend_minutes};
        my $details = "Timer updated. Weekday: ${old_wd}m → ${weekday_minutes}m, Weekend: ${old_we}m → ${weekend_minutes}m";
        $self->_log_timer_action($timer_id, $admin_id, 'modified', $details);
        
        # If timer has an active session today and new limit < elapsed, mark as expired
        my $today = $self->_get_current_date();
        my $session = $self->_get_session($timer_id, $today);
        
        if ($session && $session->{elapsed_seconds} > 0) {
            my $is_weekend = $self->_is_weekend($today);
            my $new_limit_seconds = ($is_weekend ? $weekend_minutes : $weekday_minutes) * 60 + ($session->{bonus_seconds} || 0);
            
            # If elapsed exceeds new limit, stop the timer if running
            if ($session->{elapsed_seconds} >= $new_limit_seconds) {
                if ($session->{is_running}) {
                    # Get the user_id from the timer
                    my $timer = $self->_get_timer_by_id($timer_id);
                    $self->stop_timer($timer_id, $timer->{user_id}) if $timer;
                }
            }
        }
        
        return 1;
    }
    
    return 0;
}

# Soft-delete a timer by marking it inactive.
# Parameters:
#   timer_id : Unique timer ID
#   admin_id : ID of admin performing deletion
# Returns:
#   Boolean success status
sub DB::delete_timer {
    my ($self, $timer_id, $admin_id) = @_;
    
    $self->ensure_connection();
    
    my $sql = "UPDATE timers SET is_active = 0 WHERE id = ?";
    my $rows = $self->{dbh}->do($sql, undef, $timer_id);
    
    if ($rows > 0) {
        $self->_log_timer_action($timer_id, $admin_id, 'deleted', "Timer deactivated");
        return 1;
    }
    
    return 0;
}

# Start a timer session for the current day.
# Parameters:
#   timer_id : Unique timer ID
#   user_id  : User ID (for ownership verification)
# Returns:
#   Boolean success status, 0 if in quiet hours or already expired
sub DB::start_timer {
    my ($self, $timer_id, $user_id) = @_;
    
    $self->ensure_connection();
    
    my $today = $self->_get_current_date();
    my $now = $self->_get_current_datetime();
    
    # Ensure session exists for today
    $self->_initialize_session($timer_id, $today);
    
    # Get current session state
    my $session = $self->_get_session($timer_id, $today);
    
    # Prevent starting if already expired (including after limit reduction)
    if ($session->{remaining_seconds} <= 0) {
        $self->_log_timer_action($timer_id, $user_id, 'start_blocked', 
            "Start blocked: Time expired (elapsed: " . int($session->{elapsed_seconds}/60) . "m, remaining: " . int($session->{remaining_seconds}/60) . "m)");
        return 0;
    }
    
    # Prevent starting if paused
    return 0 if $session->{is_paused};
    
    # Verify ownership
    my $timer = $self->_get_timer_by_id($timer_id);
    return 0 unless $timer && $timer->{user_id} == $user_id;
    
    my $sql = q{
        UPDATE timer_sessions 
        SET is_running = 1, started_at = ?
        WHERE timer_id = ? AND session_date = ?
    };
    
    return $self->{dbh}->do($sql, undef, $now, $timer_id, $today) > 0;
}

# Stop a running timer and update elapsed time.
# Parameters:
#   timer_id : Unique timer ID
#   user_id  : User ID (for ownership verification)
# Returns:
#   Boolean success status
sub DB::stop_timer {
    my ($self, $timer_id, $user_id) = @_;
    
    $self->ensure_connection();
    
    my $today = $self->_get_current_date();
    
    # Verify ownership
    my $timer = $self->_get_timer_by_id($timer_id);
    return 0 unless $timer && $timer->{user_id} == $user_id;
    
    # Get session to calculate elapsed time
    my $session = $self->_get_session($timer_id, $today);
    return 0 unless $session && $session->{is_running};
    
    # Calculate additional elapsed time since start
    my $additional_seconds = $self->_calculate_elapsed_since($session->{started_at});
    my $new_elapsed = $session->{elapsed_seconds} + $additional_seconds;
    
    my $sql = q{
        UPDATE timer_sessions 
        SET is_running = 0, elapsed_seconds = ?, started_at = NULL
        WHERE timer_id = ? AND session_date = ?
    };
    
    return $self->{dbh}->do($sql, undef, $new_elapsed, $timer_id, $today) > 0;
}

# Toggle pause state for a timer.
# Parameters:
#   timer_id : Unique timer ID
#   user_id  : User ID (for ownership verification)
# Returns:
#   Boolean success status
sub DB::toggle_pause {
    my ($self, $timer_id, $user_id) = @_;
    
    $self->ensure_connection();
    
    my $today = $self->_get_current_date();
    my $now = $self->_get_current_datetime();
    
    # Verify ownership
    my $timer = $self->_get_timer_by_id($timer_id);
    return 0 unless $timer && $timer->{user_id} == $user_id;
    
    my $session = $self->_get_session($timer_id, $today);
    return 0 unless $session;
    
    if ($session->{is_paused}) {
        # Unpause: Clear pause state AND start the timer immediately
        my $sql = q{
            UPDATE timer_sessions 
            SET is_paused = 0, 
                paused_at = NULL,
                is_running = 1,
                started_at = ?
            WHERE timer_id = ? AND session_date = ?
        };
        return $self->{dbh}->do($sql, undef, $now, $timer_id, $today) > 0;
    } else {
        # Pause: Stop timer if running, then mark as paused
        if ($session->{is_running}) {
            $self->stop_timer($timer_id, $user_id);
        }
        
        my $sql = q{
            UPDATE timer_sessions 
            SET is_paused = 1, paused_at = ?
            WHERE timer_id = ? AND session_date = ?
        };
        return $self->{dbh}->do($sql, undef, $now, $timer_id, $today) > 0;
    }
}

# Grant bonus time to a timer (Admin action).
# Parameters:
#   timer_id       : Unique timer ID
#   bonus_minutes  : Additional minutes to grant
#   admin_id       : ID of admin granting the time
# Returns:
#   Boolean success status
sub DB::grant_bonus_time {
    my ($self, $timer_id, $bonus_minutes, $admin_id) = @_;
    
    $self->ensure_connection();
    
    my $today = $self->_get_current_date();
    my $bonus_seconds = $bonus_minutes * 60;
    
    $self->_initialize_session($timer_id, $today);
    
    my $sql = q{
        UPDATE timer_sessions 
        SET bonus_seconds = bonus_seconds + ?
        WHERE timer_id = ? AND session_date = ?
    };
    
    my $rows = $self->{dbh}->do($sql, undef, $bonus_seconds, $timer_id, $today);
    
    if ($rows > 0) {
        $self->_log_timer_action($timer_id, $admin_id, 'bonus_granted', "$bonus_minutes minutes added");
        return 1;
    }
    
    return 0;
}

# Update elapsed time for all running timers (called by cron or polling).
# Parameters: None
# Returns:
#   Integer count of timers updated
sub DB::update_running_timers {
    my ($self) = @_;
    
    $self->ensure_connection();
    
    my $today = $self->_get_current_date();
    
    # Get all running timers
    my $sql = q{
        SELECT timer_id, elapsed_seconds, started_at
        FROM timer_sessions
        WHERE session_date = ? AND is_running = 1
    };
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($today);
    
    my $updated = 0;
    
    while (my $row = $sth->fetchrow_hashref) {
        my $additional_seconds = $self->_calculate_elapsed_since($row->{started_at});
        my $new_elapsed = $row->{elapsed_seconds} + $additional_seconds;
        
        my $update_sql = q{
            UPDATE timer_sessions 
            SET elapsed_seconds = ?, started_at = ?
            WHERE timer_id = ? AND session_date = ?
        };

        my $now = $self->_get_current_datetime();
        $self->{dbh}->do($update_sql, undef, $new_elapsed, $now, $row->{timer_id}, $today);

        $updated++;
    }
    
    return $updated;
}

# Get timers that need warning emails (10 minutes or less remaining).
# Parameters: None
# Returns:
#   ArrayRef of hashrefs with timer and user information
sub DB::get_timers_needing_warning {
    my ($self) = @_;
    
    $self->ensure_connection();
    
    my $today = $self->_get_current_date();
    
    my $sql = q{
        SELECT 
            t.id as timer_id,
            t.name,
            t.category,
            t.user_id,
            u.username,
            u.email,
            ts.elapsed_seconds,
            ts.bonus_seconds,
            CASE 
                WHEN DAYOFWEEK(?) IN (1, 7) THEN t.weekend_minutes
                ELSE t.weekday_minutes
            END as limit_minutes
        FROM timer_sessions ts
        JOIN timers t ON ts.timer_id = t.id
        JOIN users u ON t.user_id = u.id
        WHERE ts.session_date = ?
          AND ts.warning_sent = 0
          AND ts.is_running = 1
          AND ((CASE 
                WHEN DAYOFWEEK(?) IN (1, 7) THEN t.weekend_minutes
                ELSE t.weekday_minutes
              END * 60 + COALESCE(ts.bonus_seconds, 0)) - ts.elapsed_seconds) <= 600
          AND ((CASE 
                WHEN DAYOFWEEK(?) IN (1, 7) THEN t.weekend_minutes
                ELSE t.weekday_minutes
              END * 60 + COALESCE(ts.bonus_seconds, 0)) - ts.elapsed_seconds) > 0
    };
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($today, $today, $today, $today);
    
    my @timers;
    while (my $row = $sth->fetchrow_hashref) {
        $row->{limit_seconds} = ($row->{limit_minutes} * 60) + ($row->{bonus_seconds} || 0);
        $row->{remaining_seconds} = $row->{limit_seconds} - $row->{elapsed_seconds};
        push @timers, $row;
    }
    
    return \@timers;
}

# Get timers that have expired and need notification.
# Parameters: None
# Returns:
#   ArrayRef of hashrefs with timer, user, and admin email information
sub DB::get_expired_timers {
    my ($self) = @_;
    
    $self->ensure_connection();
    
    my $today = $self->_get_current_date();
    
    my $sql = q{
        SELECT 
            t.id as timer_id,
            t.name,
            t.category,
            t.user_id,
            u.username,
            u.email,
            ts.elapsed_seconds,
            ts.bonus_seconds,
            CASE 
                WHEN DAYOFWEEK(?) IN (1, 7) THEN t.weekend_minutes
                ELSE t.weekday_minutes
            END as limit_minutes
        FROM timer_sessions ts
        JOIN timers t ON ts.timer_id = t.id
        JOIN users u ON t.user_id = u.id
        WHERE ts.session_date = ?
          AND ts.expired_sent = 0
          AND ts.elapsed_seconds >= ((CASE 
                WHEN DAYOFWEEK(?) IN (1, 7) THEN t.weekend_minutes
                ELSE t.weekday_minutes
              END * 60 + ts.bonus_seconds))
    };
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($today, $today, $today);
    
    my @timers;
    while (my $row = $sth->fetchrow_hashref) {
        $row->{limit_seconds} = ($row->{limit_minutes} * 60) + $row->{bonus_seconds};
        push @timers, $row;
    }
    
    return \@timers;
}

# Mark warning email as sent for a timer session.
# Parameters:
#   timer_id : Unique timer ID
# Returns:
#   Boolean success status
sub DB::mark_warning_sent {
    my ($self, $timer_id) = @_;
    
    $self->ensure_connection();
    
    my $today = $self->_get_current_date();
    
    my $sql = q{
        UPDATE timer_sessions 
        SET warning_sent = 1
        WHERE timer_id = ? AND session_date = ?
    };
    
    return $self->{dbh}->do($sql, undef, $timer_id, $today) > 0;
}

# Mark expiry email as sent and stop the timer.
# Parameters:
#   timer_id : Unique timer ID
# Returns:
#   Boolean success status
sub DB::mark_expired_sent {
    my ($self, $timer_id) = @_;
    
    $self->ensure_connection();
    
    my $today = $self->_get_current_date();
    
    my $sql = q{
        UPDATE timer_sessions 
        SET expired_sent = 1, is_running = 0
        WHERE timer_id = ? AND session_date = ?
    };
    
    return $self->{dbh}->do($sql, undef, $timer_id, $today) > 0;
}

# Get audit log for a specific timer.
# Parameters:
#   timer_id : Unique timer ID
#   limit    : Maximum number of records (default 50)
# Returns:
#   ArrayRef of log entries with admin username
sub DB::get_timer_logs {
    my ($self, $timer_id, $limit) = @_;
    
    $limit //= 50;
    
    $self->ensure_connection();
    
    my $sql = q{
        SELECT 
            tl.action,
            tl.details,
            tl.created_at,
            u.username as admin_username
        FROM timer_logs tl
        JOIN users u ON tl.admin_id = u.id
        WHERE tl.timer_id = ?
        ORDER BY tl.created_at DESC
        LIMIT ?
    };
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($timer_id, $limit);
    
    return $sth->fetchall_arrayref({});
}

# ============================================================================
# PRIVATE HELPER METHODS
# ============================================================================

# Get current date in Australia/Melbourne timezone.
# Returns: Date string in YYYY-MM-DD format
sub DB::_get_current_date {
    my ($self) = @_;
    my $dt = DateTime->now(time_zone => 'Australia/Melbourne');
    return $dt->ymd;
}

# Get current datetime in Australia/Melbourne timezone.
# Returns: DateTime string in MySQL format
sub DB::_get_current_datetime {
    my ($self) = @_;
    my $dt = DateTime->now(time_zone => 'Australia/Melbourne');
    return $dt->strftime('%Y-%m-%d %H:%M:%S');
}

# Determine if a given date falls on a weekend.
# Parameters:
#   date : Date string in YYYY-MM-DD format
# Returns: Boolean (1 for weekend, 0 for weekday)
sub DB::_is_weekend {
    my ($self, $date) = @_;
    
    my ($year, $month, $day) = split /-/, $date;
    my $dt = DateTime->new(year => $year, month => $month, day => $day);
    
    my $dow = $dt->day_of_week;
    return ($dow == 6 || $dow == 7) ? 1 : 0;
}

# Initialize a timer session for a specific date if it doesn't exist.
# Parameters:
#   timer_id : Unique timer ID
#   date     : Date string in YYYY-MM-DD format
# Returns: Void
sub DB::_initialize_session {
    my ($self, $timer_id, $date) = @_;
    
    my $sql = q{
        INSERT IGNORE INTO timer_sessions (timer_id, session_date)
        VALUES (?, ?)
    };
    
    $self->{dbh}->do($sql, undef, $timer_id, $date);
}

# Retrieve session data for a timer on a specific date.
# Parameters:
#   timer_id : Unique timer ID
#   date     : Date string in YYYY-MM-DD format
# Returns: HashRef of session data or undef
sub DB::_get_session {
    my ($self, $timer_id, $date) = @_;
    
    my $sql = q{
        SELECT * FROM timer_sessions
        WHERE timer_id = ? AND session_date = ?
    };
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($timer_id, $date);
    
    my $session = $sth->fetchrow_hashref;
    
    if ($session) {
        # Calculate remaining time
        my $timer = $self->_get_timer_by_id($timer_id);
        my $limit_minutes = $self->_is_weekend($date) 
            ? $timer->{weekend_minutes} 
            : $timer->{weekday_minutes};
        
        my $limit_seconds = ($limit_minutes * 60) + ($session->{bonus_seconds} // 0);
        $session->{remaining_seconds} = $limit_seconds - $session->{elapsed_seconds};
    }
    
    return $session;
}

# Retrieve timer definition by ID.
# Parameters:
#   timer_id : Unique timer ID
# Returns: HashRef of timer data or undef
sub DB::_get_timer_by_id {
    my ($self, $timer_id) = @_;
    
    my $sql = "SELECT * FROM timers WHERE id = ?";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($timer_id);
    
    return $sth->fetchrow_hashref;
}

# Calculate elapsed seconds since a given datetime.
# Parameters:
#   started_at : DateTime string in MySQL format
# Returns: Integer seconds elapsed
sub DB::_calculate_elapsed_since {
    my ($self, $started_at) = @_;
    
    return 0 unless $started_at;
    
    my $now = DateTime->now(time_zone => 'Australia/Melbourne');
    
    my ($date, $time) = split / /, $started_at;
    my ($year, $month, $day) = split /-/, $date;
    my ($hour, $minute, $second) = split /:/, $time;
    
    my $started = DateTime->new(
        year   => $year,
        month  => $month,
        day    => $day,
        hour   => $hour,
        minute => $minute,
        second => $second,
        time_zone => 'Australia/Melbourne'
    );
    
    my $duration = $now->subtract_datetime_absolute($started);
    return $duration->seconds;
}

# Log an admin action on a timer.
# Parameters:
#   timer_id : Unique timer ID
#   admin_id : ID of admin performing action
#   action   : Action type enum value
#   details  : Descriptive text of the action
# Returns: Void
sub DB::_log_timer_action {
    my ($self, $timer_id, $admin_id, $action, $details) = @_;
    
    my $sql = q{
        INSERT INTO timer_logs (timer_id, admin_id, action, details)
        VALUES (?, ?, ?, ?)
    };
    
    $self->{dbh}->do($sql, undef, $timer_id, $admin_id, $action, $details);
}

1;
