# /lib/MyApp/Controller/User/Settings.pm

package MyApp::Controller::User::Settings;

use Mojo::Base 'Mojolicious::Controller';

use strict;
use warnings;

sub trim { my $s = shift // ''; $s =~ s/^\s+|\s+$//g; $s }

# Renders the user settings shell template.
# Route: GET /user/settings
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render(template => 'user/settings');
}

# Returns the current user's profile and notification preferences.
# Route: GET /user/settings/api/state
# Returns: JSON { success, profile, prefs, has_fcm }
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_logged_in;

    my $user_id = $c->current_user_id;
    my $data    = $c->db->get_user_settings($user_id);

    return $c->render(json => {
        success => 1,
        profile => {
            username   => $data->{username},
            email      => $data->{email},
            discord_id => $data->{discord_id} // '',
            emoji      => $data->{emoji}      // '',
        },
        prefs => {
            discord => $data->{pref_discord} + 0,
            email   => $data->{pref_email}   + 0,
            fcm     => $data->{pref_fcm}     + 0,
        },
        has_fcm => $data->{has_fcm} + 0,
    });
}

# Updates the current user's profile fields.
# Route: POST /user/settings/api/profile
# Parameters:
#   email            : New email address.
#   discord_id       : Discord user ID (optional).
#   emoji            : Single emoji character (optional).
#   current_password : Required when new_password is provided.
#   new_password     : New credential (optional, min 8 chars).
# Returns: JSON { success, message, error }
sub api_update_profile {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_logged_in;

    my $user_id      = $c->current_user_id;
    my $email        = trim($c->param('email')            // '');
    my $discord_id   = trim($c->param('discord_id')       // '');
    my $emoji        = trim($c->param('emoji')            // '');
    my $current_pass = trim($c->param('current_password') // '');
    my $new_pass     = trim($c->param('new_password')     // '');

    unless ($email =~ /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/) {
        return $c->render(json => { success => 0, error => 'Invalid email format' });
    }

    if (length $emoji && $emoji =~ /^[\x00-\x7E]+$/) {
        return $c->render(json => { success => 0, error => 'Profile emoji must be a single emoji character' });
    }

    eval {
        if (length $new_pass) {
            die "New password must be at least 8 characters" if length($new_pass) < 8;
            die "Current password is required to set a new password" unless length $current_pass;
            die "Current password is incorrect" unless $c->db->verify_user_password($user_id, $current_pass);
            $c->db->update_user_password($user_id, $new_pass);
        }
        $c->db->update_user_profile($user_id, $email, $discord_id, $emoji || undef);
    };

    if ($@) {
        my $err = $@; $err =~ s/ at .*//s;
        return $c->render(json => { success => 0, error => $err });
    }

    return $c->render(json => { success => 1, message => 'Profile updated successfully.' });
}

# Toggles a single notification channel preference for the current user.
# Rejects if the change would leave all channels disabled.
# Route: POST /user/settings/api/pref
# Parameters:
#   channel : One of: discord, email, fcm.
#   value   : 0 or 1.
# Returns: JSON { success, error }
sub api_update_pref {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_logged_in;

    my $user_id = $c->current_user_id;
    my $channel = trim($c->param('channel') // '');
    my $value   = $c->param('value') // 1;

    my %allowed = map { $_ => 1 } qw(discord email fcm);
    return $c->render(json => { success => 0, error => 'Invalid channel' })
        unless $allowed{$channel};

    if (!$value) {
        my $active = $c->db->count_active_notification_prefs($user_id);
        if ($active <= 1) {
            return $c->render(json => {
                success => 0,
                error   => 'At least one notification channel must remain active.',
            });
        }
    }

    eval { $c->db->set_user_notification_pref($user_id, $channel, $value) };
    if ($@) {
        my $err = $@; $err =~ s/ at .*//s;
        return $c->render(json => { success => 0, error => $err });
    }

    return $c->render(json => { success => 1 });
}

1;
