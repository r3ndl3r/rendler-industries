# /lib/DB/User/Settings.pm

package DB::User::Settings;

use strict;
use warnings;

# Retrieves a user's full profile and notification preferences in one query.
# Parameters:
#   user_id : Target user ID.
# Returns:
#   HashRef with keys: id, username, email, discord_id, emoji, has_fcm,
#   and pref_discord, pref_email, pref_fcm (defaulting to 1 if no row exists yet).
sub DB::get_user_settings {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(q{
        SELECT
            u.id, u.username, u.email, u.discord_id, u.emoji,
            COUNT(ft.id) > 0        AS has_fcm,
            COALESCE(p.discord, 1)  AS pref_discord,
            COALESCE(p.email,   1)  AS pref_email,
            COALESCE(p.fcm,     1)  AS pref_fcm
        FROM users u
        LEFT JOIN fcm_tokens              ft ON ft.user_id = u.id
        LEFT JOIN user_notification_prefs p  ON p.user_id  = u.id
        WHERE u.id = ?
        GROUP BY u.id
    });
    $sth->execute($user_id);
    return $sth->fetchrow_hashref;
}

# Upserts a single notification channel preference for a user.
# Parameters:
#   user_id : Target user ID.
#   channel : Column name — one of: discord, email, fcm.
#   value   : 0 or 1.
# Returns: Void.
sub DB::set_user_notification_pref {
    my ($self, $user_id, $channel, $value) = @_;
    $self->ensure_connection;

    my %allowed = map { $_ => 1 } qw(discord email fcm);
    die "Invalid notification channel: $channel" unless $allowed{$channel};

    my $sth = $self->{dbh}->prepare(qq{
        INSERT INTO user_notification_prefs (user_id, $channel)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE $channel = VALUES($channel)
    });
    $sth->execute($user_id, $value ? 1 : 0);
}

# Counts active notification channels for a user.
# Used to enforce the minimum-one-channel rule before persisting a disable.
# Parameters:
#   user_id : Target user ID.
# Returns: Integer — number of channels currently set to 1.
sub DB::count_active_notification_prefs {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(q{
        SELECT
            COALESCE(discord, 1) + COALESCE(email, 1) + COALESCE(fcm, 1) AS active_count
        FROM user_notification_prefs
        WHERE user_id = ?
    });
    $sth->execute($user_id);
    my $row = $sth->fetchrow_hashref;
    return $row ? $row->{active_count} : 3;
}

# Updates a user's own profile fields (email, discord_id, emoji).
# Password is handled separately via DB::update_user_password.
# Parameters:
#   user_id    : Target user ID.
#   email      : Updated email address.
#   discord_id : Discord user ID string (may be empty).
#   emoji      : Single emoji character, or undef to clear.
# Returns: Void.
sub DB::update_user_profile {
    my ($self, $user_id, $email, $discord_id, $emoji) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "UPDATE users SET email = ?, discord_id = ?, emoji = ? WHERE id = ?"
    );
    $sth->execute($email, $discord_id || undef, $emoji || undef, $user_id);
}

# Verifies a plain-text password against the stored bcrypt hash for a user.
# Parameters:
#   user_id  : Target user ID.
#   password : Plain text string to verify.
# Returns: 1 if match, 0 otherwise.
sub DB::verify_user_password {
    my ($self, $user_id, $password) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("SELECT password FROM users WHERE id = ?");
    $sth->execute($user_id);
    my $row = $sth->fetchrow_hashref;
    return 0 unless $row && $row->{password};

    require Crypt::Eksblowfish::Bcrypt;
    return (Crypt::Eksblowfish::Bcrypt::bcrypt($password, $row->{password}) eq $row->{password}) ? 1 : 0;
}

1;
