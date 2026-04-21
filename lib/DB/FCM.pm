# /lib/DB/FCM.pm

package DB::FCM;

use strict;
use warnings;

# FCM device token persistence layer.
# One row per device — a user can have multiple tokens across devices.
# Tokens are upserted on registration and pruned on FCM 404 (unregistered device).

# Stores or refreshes a device token for a user.
# Upserts on the unique token index; on conflict updates the timestamp only.
# Parameters:
#   user_id : Integer — owning user.
#   token   : String  — FCM registration token for the device.
# Returns: Void.
sub DB::save_fcm_token {
    my ($self, $user_id, $token) = @_;
    $self->ensure_connection;
    $self->{dbh}->do(
        "INSERT INTO fcm_tokens (user_id, token) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE user_id = ?, updated_at = NOW()",
        undef, $user_id, $token, $user_id
    );
}

# Retrieves all active device tokens for a user.
# Parameters:
#   user_id : Integer.
# Returns:
#   ArrayRef of token strings.
sub DB::get_fcm_tokens_for_user {
    my ($self, $user_id) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("SELECT token FROM fcm_tokens WHERE user_id = ?");
    $sth->execute($user_id);
    return [map { $_->[0] } @{$sth->fetchall_arrayref}];
}

# Removes a specific token — called when FCM returns 404 (device unregistered).
# Parameters:
#   token : String.
# Returns: Void.
sub DB::delete_fcm_token {
    my ($self, $token) = @_;
    $self->ensure_connection;
    $self->{dbh}->do("DELETE FROM fcm_tokens WHERE token = ?", undef, $token);
}

1;
