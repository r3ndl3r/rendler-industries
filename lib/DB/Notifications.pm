# /lib/DB/Notifications.pm

package DB::Notifications;

use strict;
use warnings;

# Database Library for Notification Logging and Tracking.
#
# Features:
#   - Persistent audit trail for all outbound communications.
#   - Support for multiple delivery channels (Discord, Email, Push).
#   - Advanced filtering for admin oversight and system diagnostics.
#   - Automated maintenance and pruning utilities.

# Inserts a new record into the notification log.
sub DB::log_notification {
    my ($self, %args) = @_;
    $self->ensure_connection();
    
    my $sql = q{
        INSERT INTO notifications_log 
        (user_id, type, recipient, subject, message, status, error_details)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    };
    
    eval {
        $self->{dbh}->do($sql, undef, 
            $args{user_id}, $args{type}, $args{recipient}, 
            $args{subject}, $args{message}, $args{status} // 'success', 
            $args{error_details}
        );
    };
    return $@ ? 0 : 1;
}

# Retrieves filtered notification logs for the ledger.
# Parameters: HashRef of filters (search, type, status, user_id, days)
# Returns: ArrayRef of log hashes
sub DB::get_notification_logs {
    my ($self, $filters) = @_;
    $self->ensure_connection();

    my @where;
    my @params;

    if ($filters->{search}) {
        push @where, "(nl.message LIKE ? OR nl.recipient LIKE ? OR nl.subject LIKE ?)";
        push @params, ("%$filters->{search}%") x 3;
    }
    if ($filters->{type}) {
        push @where, "nl.type = ?";
        push @params, $filters->{type};
    }
    if ($filters->{status}) {
        push @where, "nl.status = ?";
        push @params, $filters->{status};
    }
    if ($filters->{user_id}) {
        push @where, "nl.user_id = ?";
        push @params, $filters->{user_id};
    }
    if ($filters->{days} && $filters->{days} =~ /^\d+$/) {
        push @where, "nl.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)";
        push @params, $filters->{days};
    }

    my $where_clause = @where ? "WHERE " . join(" AND ", @where) : "";
    
    my $sql = qq{
        SELECT nl.*, u.username 
        FROM notifications_log nl
        LEFT JOIN users u ON nl.user_id = u.id
        $where_clause
        ORDER BY nl.created_at DESC
        LIMIT 500
    };
    
    return $self->{dbh}->selectall_arrayref($sql, { Slice => {} }, @params);
}

# Deletes a specific log entry.
sub DB::delete_notification_log {
    my ($self, $id) = @_;
    $self->ensure_connection();
    return $self->{dbh}->do("DELETE FROM notifications_log WHERE id = ?", undef, $id);
}

# Prunes logs older than X days.
sub DB::prune_notification_logs {
    my ($self, $days) = @_;
    $self->ensure_connection();
    return $self->{dbh}->do("DELETE FROM notifications_log WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)", undef, $days);
}

# --- Notification Queue ---

# Inserts a new item into the delivery queue.
# Parameters (named):
#   user_id   : Internal user ID (optional)
#   type      : 'discord' or 'email'
#   recipient : Discord snowflake ID or email address
#   subject   : Subject line (email only, optional)
#   message   : Message body
# Returns: New row ID or 0 on failure
sub DB::enqueue_notification {
    my ($self, %args) = @_;
    $self->ensure_connection();
    eval {
        $self->{dbh}->do(
            "INSERT INTO notifications_queue (user_id, type, recipient, subject, message)
             VALUES (?, ?, ?, ?, ?)",
            undef,
            $args{user_id}, $args{type}, $args{recipient}, $args{subject}, $args{message}
        );
    };
    return $@ ? 0 : $self->{dbh}->last_insert_id(undef, undef, undef, undef);
}

# Retrieves all pending queue items ordered oldest-first.
# Returns: ArrayRef of row hashrefs
sub DB::get_pending_queue_items {
    my ($self) = @_;
    $self->ensure_connection();
    # Atomically claim pending items by transitioning to 'processing' before
    # returning them. Prevents concurrent timer ticks from picking up the same rows.
    $self->{dbh}->do(
        "UPDATE notifications_queue SET status = 'processing'
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT 50"
    );
    return $self->{dbh}->selectall_arrayref(
        "SELECT * FROM notifications_queue WHERE status = 'processing' ORDER BY created_at ASC",
        { Slice => {} }
    );
}

# Increments retry_count and records the latest error on a queue item.
# Parameters: id, error string
sub DB::increment_queue_retry {
    my ($self, $id, $error) = @_;
    $self->ensure_connection();
    # Revert to 'pending' so the next timer tick can reclaim this item.
    $self->{dbh}->do(
        "UPDATE notifications_queue SET retry_count = retry_count + 1, last_error = ?, status = 'pending' WHERE id = ?",
        undef, $error, $id
    );
}

# Marks a queue item as successfully delivered.
# Parameters: id
sub DB::mark_queue_item_sent {
    my ($self, $id) = @_;
    $self->ensure_connection();
    $self->{dbh}->do(
        "UPDATE notifications_queue SET status = 'sent' WHERE id = ?",
        undef, $id
    );
}

# Marks a queue item as permanently failed and records the final error.
# Parameters: id, error string
sub DB::mark_queue_item_failed {
    my ($self, $id, $error) = @_;
    $self->ensure_connection();
    $self->{dbh}->do(
        "UPDATE notifications_queue SET status = 'failed', last_error = ? WHERE id = ?",
        undef, $error, $id
    );
}

1;
