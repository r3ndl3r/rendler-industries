# /lib/DB/Notifications.pm

package DB::Notifications;

use strict;
use warnings;

# Database Library for Notification Logging and Tracking.
#
# Features:
#   - Persistent audit trail for all outbound communications.
#   - Support for multiple delivery channels (Discord, Email, Push).
#   - Error detail capturing for deliverability diagnostics.

# Inserts a new record into the notification log.
# Parameters (named hash):
#   user_id       : Optional target user ID
#   type          : Channel enum ('discord','email','pushover','gotify')
#   recipient     : Destination address/identifier
#   subject       : Optional subject line
#   message       : Full message content
#   status        : Outcome enum ('success','failed')
#   error_details : Optional diagnostic text
# Returns:
#   Boolean success status
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
            $args{user_id}, 
            $args{type}, 
            $args{recipient}, 
            $args{subject}, 
            $args{message}, 
            $args{status} // 'success', 
            $args{error_details}
        );
    };
    
    if ($@) {
        $self->{app}->log->error("Failed to log notification to DB: $@") if $self->{app};
        return 0;
    }
    
    return 1;
}

# Retrieves recent notification history.
# Parameters:
#   limit : Maximum number of records (default 50)
# Returns:
#   ArrayRef of log hashes
sub DB::get_notification_history {
    my ($self, $limit) = @_;
    $limit //= 50;
    
    $self->ensure_connection();
    
    my $sql = q{
        SELECT nl.*, u.username 
        FROM notifications_log nl
        LEFT JOIN users u ON nl.user_id = u.id
        ORDER BY nl.created_at DESC
        LIMIT ?
    };
    
    return $self->{dbh}->selectall_arrayref($sql, { Slice => {} }, $limit);
}

1;
