# /lib/DB/FCM.pm

package DB::FCM;

use strict;
use warnings;

# FCM device token persistence layer.
# One row per device — a user can have multiple tokens across devices.
# Tokens are upserted on registration and pruned on FCM 404 (unregistered device).

# Stores or refreshes a device token for a user.
# Upserts on the unique token index; on conflict refreshes ownership and device metadata.
# Parameters:
#   user_id : Integer — owning user.
#   token      : String — FCM registration token for the device.
#   platform   : String — android_native | pwa_web.
#   user_agent : String — Browser/device UA for diagnostics.
# Returns: Void.
sub DB::save_fcm_token {
    my ($self, $user_id, $token, $platform, $user_agent) = @_;
    $platform ||= 'android_native';
    $self->ensure_connection;
    $self->{dbh}->do(
        "INSERT INTO fcm_tokens (user_id, token, platform, user_agent, last_seen_at)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE user_id = ?, platform = ?, user_agent = ?, last_seen_at = NOW(), updated_at = NOW()",
        undef, $user_id, $token, $platform, $user_agent, $user_id, $platform, $user_agent
    );
}

# Retrieves all active device tokens for a user.
# Parameters:
#   user_id : Integer.
# Returns:
#   ArrayRef of HashRefs: { token, platform }.
sub DB::get_fcm_tokens_for_user {
    my ($self, $user_id) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("SELECT token, platform FROM fcm_tokens WHERE user_id = ?");
    $sth->execute($user_id);
    return $sth->fetchall_arrayref({});
}

# Checks that a queued FCM token still belongs to the expected user.
# Parameters:
#   token   : FCM registration token.
#   user_id : Expected owning user ID.
# Returns: Boolean ownership result.
sub DB::fcm_token_belongs_to_user {
    my ($self, $token, $user_id) = @_;
    return 0 unless defined $token && defined $user_id;

    $self->ensure_connection;
    my ($owned) = $self->{dbh}->selectrow_array(
        "SELECT 1 FROM fcm_tokens WHERE token = ? AND user_id = ? LIMIT 1",
        undef,
        $token,
        $user_id
    );
    return $owned ? 1 : 0;
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
