# /lib/MyApp/Controller/Admin/Settings.pm

package MyApp::Controller::Admin::Settings;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for Application Configuration Management.
# Features:
#   - Centralized settings display interface for admins
#   - Handles updates for Pushover, Gotify, Unsplash, App Secret, and Email settings
#   - Dynamic Gemini AI model registry management
#   - Real-time configuration state synchronization
# Integration points:
#   - Restricted to administrative members via router bridge
#   - Depends on DB::Settings for persistence and system maintenance triggers

# Renders the settings management dashboard skeleton.
# Route: GET /admin/settings
# Parameters: None
# Returns: Rendered HTML template 'settings'.
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_admin;
    $c->render('admin/settings');
}

# Returns the consolidated state for the module.
# Route: GET /admin/settings/api/state
# Parameters: None
# Returns: JSON object { settings, email_settings, timer_reset_hour, gemini, google_cloud, success }
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my ($gemini_models, $gemini_model_error) = _fetch_gemini_models($c);
    my ($opencode_models, $opencode_model_error) = _fetch_opencode_models($c);

    my $state = {
        settings         => $c->db->get_all_settings(),
        email_settings   => $c->db->get_email_settings(),
        timer_reset_hour => $c->db->get_timer_reset_hour(),
        ai_provider      => $c->db->get_ai_provider(),
        gemini           => {
            key    => $c->db->get_gemini_key(),
            models => $gemini_models,
            active => $c->db->get_gemini_active_model(),
            model_error => $gemini_model_error
        },
        opencode         => {
            key         => $c->db->get_opencode_key(),
            models      => $opencode_models,
            active      => $c->db->get_opencode_active_model(),
            model_error => $opencode_model_error
        },
        local_ai         => {
            url => $c->db->get_local_ai_url()
        },
        google_cloud     => {
            key => $c->db->get_google_cloud_key()
        },
        owm_api_key      => $c->db->get_all_settings()->{owm_api_key},
        success          => 1
    };
    
    $c->render(json => $state);
}

# Processes updates for a specific configuration section.
# Route: POST /admin/settings/update
# Parameters:
#   section : The configuration block to update
# Returns: JSON object { success, message, error }
sub update {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    my $section = $c->param('section') // '';
    
    if ($section eq 'pushover') {
        my $existing = $c->db->get_all_settings()->{pushover} || {};
        my $token = _secret_update_value($c->param('pushover_token')) || ($existing->{token} // '');
        my $user = _secret_update_value($c->param('pushover_user')) || ($existing->{user} // '');
        
        if ($token && $user) {
            $c->db->update_pushover($token, $user);
            return $c->render(json => { success => 1, message => 'Pushover settings updated successfully' });
        } else {
            return $c->render(json => { success => 0, error => 'Pushover token and user are required' });
        }
    }
    elsif ($section eq 'gotify') {
        my $existing = $c->db->get_all_settings()->{gotify} || {};
        my $token = _secret_update_value($c->param('gotify_token')) || ($existing->{token} // '');
        
        if ($token) {
            $c->db->update_gotify($token);
            return $c->render(json => { success => 1, message => 'Gotify settings updated successfully' });
        } else {
            return $c->render(json => { success => 0, error => 'Gotify token is required' });
        }
    }
    elsif ($section eq 'app_secret') {
        my $secret = _secret_update_value($c->param('app_secret'));
        return $c->render(json => { success => 1, message => 'App secret left unchanged' }) unless length $secret;

        if ($secret && length($secret) >= 32) {
            $c->db->update_app_secret($secret);
            return $c->render(json => { success => 1, message => 'App secret updated successfully. Restart required.' });
        } else {
            return $c->render(json => { success => 0, error => 'App secret must be at least 32 characters' });
        }
    }
    elsif ($section eq 'unsplash') {
        my $api_key = _secret_update_value($c->param('unsplash_key'));

        $c->db->update_unsplash_key($api_key) if length $api_key;

        my $msg = $api_key ? 'Unsplash API key updated successfully' : 'Unsplash API key left unchanged';
        return $c->render(json => { success => 1, message => $msg });
    }
    elsif ($section eq 'email') {
        my $existing = $c->db->get_email_settings();
        my $gmail_email = trim($c->param('gmail_email') // '');
        my $gmail_password = _secret_update_value($c->param('gmail_app_password'));
        $gmail_password = $existing->{gmail_app_password} // '' unless length $gmail_password;
        $gmail_password =~ s/\s+//g;
        my $from_name = trim($c->param('gmail_from_name') // '');
        
        if ($gmail_email && $gmail_password) {
            unless ($gmail_email =~ /^[a-zA-Z0-9._%+-]+\@gmail\.com$/) {
                return $c->render(json => { success => 0, error => 'Invalid Gmail address (must be @gmail.com)' });
            }
            
            $c->db->update_email_settings($gmail_email, $gmail_password, $from_name);
            return $c->render(json => { success => 1, message => 'Email settings updated successfully' });
        } else {
            return $c->render(json => { success => 0, error => 'Gmail email and app password are required' });
        }
    }
    elsif ($section eq 'timers') {
        my $reset_hour = $c->param('timer_reset_hour');
        
        unless (defined $reset_hour && $reset_hour =~ /^\d+$/ && $reset_hour >= 0 && $reset_hour <= 23) {
            return $c->render(json => { success => 0, error => 'Invalid timer reset hour (must be 0-23)' });
        }
        
        $c->db->set_timer_reset_hour($reset_hour);
        
        my $display_hour = $reset_hour == 0 ? '12:00 AM' 
                         : $reset_hour < 12 ? sprintf("%d:00 AM", $reset_hour)
                         : $reset_hour == 12 ? '12:00 PM'
                         : sprintf("%d:00 PM", $reset_hour - 12);
        
        return $c->render(json => { success => 1, message => "Timer reset time set to $display_hour" });
    }
    elsif ($section eq 'ai_provider') {
        my $provider = trim($c->param('ai_provider') // '');
        unless ($provider eq 'gemini' || $provider eq 'opencode' || $provider eq 'local') {
            return $c->render(json => { success => 0, error => 'Invalid AI provider' });
        }
        $c->db->update_ai_provider($provider);
        return $c->render(json => { success => 1, message => 'AI provider updated successfully' });
    }
    elsif ($section eq 'gemini_key') {
        my $api_key = _secret_update_value($c->param('gemini_key'));
        return $c->render(json => { success => 1, message => 'Gemini API key left unchanged' }) unless length $api_key;
        $c->db->update_gemini_key($api_key);
        return $c->render(json => { success => 1, message => 'Gemini API key updated successfully' });
    }
    elsif ($section eq 'gemini_model') {
        my $active_model = trim($c->param('gemini_active_model') // '');
        return $c->render(json => { success => 0, error => 'Invalid Gemini model' }) unless length $active_model;
        $c->db->update_gemini_active_model($active_model);
        return $c->render(json => { success => 1, message => 'Gemini model updated successfully' });
    }
    elsif ($section eq 'opencode_key') {
        my $api_key = _secret_update_value($c->param('opencode_key'));
        return $c->render(json => { success => 1, message => 'OpenCode API key left unchanged' }) unless length $api_key;
        $c->db->update_opencode_key($api_key);
        return $c->render(json => { success => 1, message => 'OpenCode API key updated successfully' });
    }
    elsif ($section eq 'opencode_model') {
        my $active_model = trim($c->param('opencode_active_model') // '');
        return $c->render(json => { success => 0, error => 'Invalid OpenCode model' }) unless length $active_model;
        $c->db->update_opencode_active_model($active_model);
        return $c->render(json => { success => 1, message => 'OpenCode model updated successfully' });
    }
    elsif ($section eq 'local_ai') {
        my $url = trim($c->param('local_ai_url') // '');
        unless ($url =~ m{^https?://\S+$}) {
            return $c->render(json => { success => 0, error => 'Local LLM URL must start with http:// or https://' });
        }
        $c->db->update_local_ai_url($url);
        return $c->render(json => { success => 1, message => 'Local LLM URL updated successfully' });
    }
    elsif ($section eq 'google_cloud') {
        my $api_key = _secret_update_value($c->param('google_cloud_key'));
        $c->db->update_google_cloud_key($api_key) if length $api_key;
        my $msg = $api_key ? 'Google Cloud API key updated successfully' : 'Google Cloud API key left unchanged';
        return $c->render(json => { success => 1, message => $msg });
    }
    elsif ($section eq 'openweathermap') {
        my $api_key = _secret_update_value($c->param('owm_api_key'));
        $c->db->update_owm_api_key($api_key) if length $api_key;
        my $msg = $api_key ? 'OpenWeatherMap API key updated successfully' : 'OpenWeatherMap API key left unchanged';
        return $c->render(json => { success => 1, message => $msg });
    }
    elsif ($section eq 'discord') {
        my $token = _secret_update_value($c->param('discord_token')) || ($c->db->get_discord_token() // '');
        unless ($token) {
            return $c->render(json => { success => 0, error => 'Bot token is required' });
        }
        $c->db->update_discord($token);
        return $c->render(json => { success => 1, message => 'Discord bot token updated successfully' });
    }

    return $c->render(json => { success => 0, error => 'Unknown settings section' });
}

sub _fetch_opencode_models {
    my ($c) = @_;
    return $c->ai_opencode_models;
}

sub _fetch_gemini_models {
    my ($c) = @_;
    return $c->ai_gemini_models;
}

sub _secret_update_value {
    my ($value) = @_;
    $value = trim($value // '');
    return '' unless length $value;
    return '' if $value =~ /\A\(configured\b/i;
    return '' if $value =~ /\A[\*\x{2022}]{4,}\z/;
    return $value;
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{admin}->get('/admin/settings')->to('admin-settings#index');
    $r->{admin}->get('/admin/settings/api/state')->to('admin-settings#api_state');
    $r->{admin}->post('/admin/settings/update')->to('admin-settings#update');
}

1;
