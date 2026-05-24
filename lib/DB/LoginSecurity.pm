# /lib/DB/LoginSecurity.pm

package DB::LoginSecurity;

use strict;
use warnings;
use utf8;
use DateTime;

# Database helper for login abuse protection. This module records failed
# authentication attempts, enforces username-scoped lockouts, and exposes
# cleanup hooks for the centralized maintenance scheduler.
# Features:
#   - Tracks failed login attempts by normalized username
#   - Maintains temporary username lockout state
#   - Enforces admin alert cooldown metadata for lockout notifications
#   - Prunes expired login security records from the maintenance loop
# Integration Points:
#   - Extends DB package via package injection
#   - Called by Auth.pm for authentication-time lockout decisions
#   - Called by System.pm centralized maintenance for retention cleanup

# Records a failed login attempt for the normalized username key.
sub DB::record_login_failure {
    my ($self, $username_key, $remote_ip, $user_agent) = @_;
    return 0 unless $username_key;
    $self->ensure_connection;

    $user_agent = substr($user_agent // '', 0, 255);
    my $now = _login_security_now($self);

    return $self->{dbh}->do(
        "INSERT INTO login_failures (username_key, attempted_at, remote_ip, user_agent)
         VALUES (?, ?, ?, ?)",
        undef, $username_key, $now, $remote_ip, $user_agent
    );
}

# Counts recent failures for a normalized username key.
sub DB::count_recent_login_failures {
    my ($self, $username_key, $window_seconds) = @_;
    return 0 unless $username_key;
    $window_seconds = int($window_seconds || 900);
    $self->ensure_connection;

    my $cutoff = _login_security_offset($self, -$window_seconds);
    my ($count) = $self->{dbh}->selectrow_array(
        "SELECT COUNT(*)
         FROM login_failures
         WHERE username_key = ?
           AND attempted_at >= ?",
        undef, $username_key, $cutoff
    );

    return $count || 0;
}

# Returns the active lockout row for a username key, or undef if not locked.
sub DB::get_active_login_lockout {
    my ($self, $username_key) = @_;
    return undef unless $username_key;
    $self->ensure_connection;

    my $now = _login_security_now($self);
    return $self->{dbh}->selectrow_hashref(
        "SELECT username_key, locked_until, alerted_at, fail_count, remote_ip, user_agent
         FROM login_lockouts
         WHERE username_key = ?
           AND locked_until > ?",
        undef, $username_key, $now
    );
}

# Creates or refreshes a temporary username lockout after the threshold is crossed.
sub DB::activate_login_lockout {
    my ($self, $username_key, $lock_seconds, $fail_count, $remote_ip, $user_agent) = @_;
    return 0 unless $username_key;
    $lock_seconds = int($lock_seconds || 900);
    $user_agent = substr($user_agent // '', 0, 255);
    $self->ensure_connection;

    my $locked_until = _login_security_offset($self, $lock_seconds);
    return $self->{dbh}->do(
        "INSERT INTO login_lockouts
             (username_key, locked_until, fail_count, remote_ip, user_agent)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
             locked_until = VALUES(locked_until),
             fail_count   = VALUES(fail_count),
             remote_ip    = VALUES(remote_ip),
             user_agent   = VALUES(user_agent)",
        undef, $username_key, $locked_until, $fail_count, $remote_ip, $user_agent
    );
}

# Checks whether an admin alert may be sent without violating the cooldown.
sub DB::should_send_login_lockout_alert {
    my ($self, $username_key, $cooldown_seconds) = @_;
    return 0 unless $username_key;
    $cooldown_seconds = int($cooldown_seconds || 1800);
    $self->ensure_connection;

    my $cutoff = _login_security_offset($self, -$cooldown_seconds);
    my ($allowed) = $self->{dbh}->selectrow_array(
        "SELECT COUNT(*)
         FROM login_lockouts
         WHERE username_key = ?
           AND (alerted_at IS NULL OR alerted_at < ?)",
        undef, $username_key, $cutoff
    );

    return $allowed ? 1 : 0;
}

# Marks that an alert has been emitted for the current lockout.
sub DB::mark_login_lockout_alerted {
    my ($self, $username_key) = @_;
    return 0 unless $username_key;
    $self->ensure_connection;

    my $now = _login_security_now($self);
    return $self->{dbh}->do(
        "UPDATE login_lockouts SET alerted_at = ? WHERE username_key = ?",
        undef, $now, $username_key
    );
}

# Clears both failure history and active lockout state after a successful login.
sub DB::clear_login_failures {
    my ($self, $username_key) = @_;
    return 0 unless $username_key;
    $self->ensure_connection;

    $self->{dbh}->do("DELETE FROM login_failures WHERE username_key = ?", undef, $username_key);
    $self->{dbh}->do("DELETE FROM login_lockouts WHERE username_key = ?", undef, $username_key);
    return 1;
}

# Opportunistic cleanup to keep the tables small.
sub DB::prune_login_security {
    my ($self, $retention_seconds) = @_;
    $retention_seconds = int($retention_seconds || 86400);
    $self->ensure_connection;

    my $cutoff = _login_security_offset($self, -$retention_seconds);
    $self->{dbh}->do(
        "DELETE FROM login_failures
         WHERE attempted_at < ?",
        undef, $cutoff
    );
    $self->{dbh}->do(
        "DELETE FROM login_lockouts
         WHERE locked_until < ?
           AND (alerted_at IS NULL OR alerted_at < ?)",
        undef, $cutoff, $cutoff
    );

    return 1;
}

sub _login_security_now {
    my ($self) = @_;
    return DateTime->now(time_zone => $self->{timezone} || 'UTC')->strftime('%Y-%m-%d %H:%M:%S');
}

sub _login_security_offset {
    my ($self, $seconds) = @_;
    my $dt = DateTime->now(time_zone => $self->{timezone} || 'UTC');
    $dt->add(seconds => $seconds) if $seconds > 0;
    $dt->subtract(seconds => -$seconds) if $seconds < 0;
    return $dt->strftime('%Y-%m-%d %H:%M:%S');
}

1;
