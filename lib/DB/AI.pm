# /lib/DB/AI.pm

package DB::AI;

use strict;
use warnings;
use Mojo::JSON qw(encode_json decode_json);

# Database helper for Family Pulse AI interactions.
# Features:
#   - Conversational history persistence
#   - Context snapshot generation (Aggregates data from other modules)
#   - Specialized metadata tracking for multimodal inputs
# Integration points:
#   - Extends DB package via package injection
#   - Orchestrates context from Medication, Shopping, Calendar, and Swear Jar

# Retrieves the last N messages for a user to maintain thread context.
# Parameters:
#   user_id : Unique identifier for the user
#   limit   : Number of messages to retrieve (Default: 20)
# Returns:
#   ArrayRef of HashRefs containing conversational history
sub DB::get_ai_history {
    my ($self, $user_id, $limit) = @_;
    $limit //= 20;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("
        SELECT role, content, metadata 
        FROM ai_conversations 
        WHERE user_id = ? 
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    ");
    $sth->execute($user_id, $limit);
    
    my @history = reverse @{$sth->fetchall_arrayref({})};
    foreach my $msg (@history) {
        $msg->{metadata} = decode_json($msg->{metadata}) if $msg->{metadata};
    }
    return \@history;
}

# Saves a new message to the conversation history.
# Parameters:
#   user_id  : ID of the user owning the conversation
#   role     : 'user', 'model', or 'system'
#   content  : The text payload of the message
#   metadata : Optional HashRef for multimodal links or system tags
# Returns:
#   Integer : Success status of the insert
sub DB::save_ai_message {
    my ($self, $user_id, $role, $content, $metadata) = @_;
    $self->ensure_connection;
    
    my $meta_json = $metadata ? encode_json($metadata) : undef;
    my $sth = $self->{dbh}->prepare("
        INSERT INTO ai_conversations (user_id, role, content, metadata) 
        VALUES (?, ?, ?, ?)
    ");
    return $sth->execute($user_id, $role, $content, $meta_json);
}

# Clears the conversation history for a specific user.
# Parameters:
#   user_id : Unique identifier for the user
# Returns:
#   Integer : Number of rows deleted
sub DB::clear_ai_history {
    my ($self, $user_id) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("DELETE FROM ai_conversations WHERE user_id = ?");
    return $sth->execute($user_id);
}

# Generates a comprehensive snapshot of the family dashboard state.
# Aggregates: Medication logs, Shopping items, Calendar events, Swear Jar, Timers, and Reminders.
# Returns:
#   HashRef containing deep-context for Gemini system prompting
sub DB::get_dashboard_snapshot {
    my ($self) = @_;
    $self->ensure_connection;
    
    # Calculate date range for calendar (Today + 14 days)
    my @now = localtime(time);
    my $start = sprintf("%04d-%02d-%02d", $now[5]+1900, $now[4]+1, $now[3]);
    
    my @future = localtime(time + (86400 * 14));
    my $end = sprintf("%04d-%02d-%02d", $future[5]+1900, $future[4]+1, $future[3]);

    my $snapshot = {
        current_time => scalar(localtime),
        medication   => $self->get_medication_logs_by_user(),
        shopping     => $self->get_shopping_items(),
        calendar     => $self->get_calendar_events($start, $end),
        swear_jar    => {
            total_balance => $self->get_jar_balance(),
            unpaid_fines  => $self->get_swear_leaderboard()
        },
        timers       => $self->get_all_timers(),
        reminders    => $self->get_all_reminders()
    };
    
    return $snapshot;
}

# Retrieves a file or receipt BLOB for AI analysis.
# Parameters:
#   type : 'receipt' or 'file'
#   id   : Unique identifier in the respective table
# Returns:
#   HashRef: { data => Binary BLOB, mime => String }
sub DB::get_ai_attachment {
    my ($self, $type, $id) = @_;
    $self->ensure_connection;
    
    my $sql = $type eq 'receipt' 
        ? "SELECT receipt_image as data, 'image/jpeg' as mime FROM receipts WHERE id = ?"
        : "SELECT file_data as data, mime_type as mime FROM files WHERE id = ?";
        
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($id);
    return $sth->fetchrow_hashref();
}

1;
