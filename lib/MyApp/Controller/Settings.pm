# /lib/MyApp/Controller/Settings.pm

package MyApp::Controller::Settings;
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
# Route: GET /settings
# Parameters: None
# Returns: Rendered HTML template 'settings'.
sub index {
    my $c = shift;
    $c->stash(title => 'Settings');
    $c->render('settings');
}

# Returns the consolidated state for the module.
# Route: GET /settings/api/state
# Parameters: None
# Returns: JSON object { settings, email_settings, timer_reset_hour, gemini, google_cloud, success }
sub api_state {
    my $c = shift;
    
    my $state = {
        settings         => $c->db->get_all_settings(),
        email_settings   => $c->db->get_email_settings(),
        timer_reset_hour => $c->db->get_timer_reset_hour(),
        gemini           => {
            key    => $c->db->get_gemini_key(),
            models => $c->db->get_gemini_models(),
            active => $c->db->get_gemini_active_model()
        },
        google_cloud     => {
            key => $c->db->get_google_cloud_key()
        },
        success          => 1
    };
    
    $c->render(json => $state);
}

# Processes updates for a specific configuration section.
# Route: POST /settings/update
# Parameters:
#   section : The configuration block to update
# Returns: JSON object { success, message, error }
sub update {
    my $c = shift;
    my $section = $c->param('section') // '';
    
    if ($section eq 'pushover') {
        my $token = trim($c->param('pushover_token') // '');
        my $user = trim($c->param('pushover_user') // '');
        
        if ($token && $user) {
            $c->db->update_pushover($token, $user);
            return $c->render(json => { success => 1, message => 'Pushover settings updated successfully' });
        } else {
            return $c->render(json => { success => 0, error => 'Pushover token and user are required' });
        }
    }
    elsif ($section eq 'gotify') {
        my $token = trim($c->param('gotify_token') // '');
        
        if ($token) {
            $c->db->update_gotify($token);
            return $c->render(json => { success => 1, message => 'Gotify settings updated successfully' });
        } else {
            return $c->render(json => { success => 0, error => 'Gotify token is required' });
        }
    }
    elsif ($section eq 'app_secret') {
        my $secret = trim($c->param('app_secret') // '');
        
        if ($secret && length($secret) >= 32) {
            $c->db->update_app_secret($secret);
            return $c->render(json => { success => 1, message => 'App secret updated successfully. Restart required.' });
        } else {
            return $c->render(json => { success => 0, error => 'App secret must be at least 32 characters' });
        }
    }
    elsif ($section eq 'unsplash') {
        my $api_key = trim($c->param('unsplash_key') // '');
        
        $c->db->update_unsplash_key($api_key);
        
        my $msg = $api_key ? 'Unsplash API key updated successfully' : 'Unsplash API key cleared (will use Picsum fallback)';
        return $c->render(json => { success => 1, message => $msg });
    }
    elsif ($section eq 'email') {
        my $gmail_email = trim($c->param('gmail_email') // '');
        my $gmail_password = trim($c->param('gmail_app_password') // '');
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
    } elsif ($section eq 'gemini') {
        my $api_key = trim($c->param('gemini_key') // '');
        $c->db->update_gemini_key($api_key);
        
        my $active_model = $c->param('gemini_active_model');
        $c->db->update_gemini_active_model($active_model) if $active_model;

        return $c->render(json => { success => 1, message => 'Gemini settings updated successfully' });
    }
    elsif ($section eq 'gemini_models') {
        my $action = $c->param('action') // 'update';
        my $models = $c->db->get_gemini_models();

        if ($action eq 'add') {
            my $new_model = trim($c->param('new_model') // '');
            if ($new_model && !grep { $_ eq $new_model } @$models) {
                push @$models, $new_model;
                $c->db->update_gemini_models($models);
                return $c->render(json => { success => 1, message => "Added model: $new_model" });
            }
            return $c->render(json => { success => 0, error => "Invalid or duplicate model name" });
        }
        elsif ($action eq 'delete') {
            my $to_delete = $c->param('model_name');
            my @filtered = grep { $_ ne $to_delete } @$models;
            $c->db->update_gemini_models(\@filtered);
            return $c->render(json => { success => 1, message => "Removed model: $to_delete" });
        }
    }
    elsif ($section eq 'google_cloud') {
        my $api_key = trim($c->param('google_cloud_key') // '');
        $c->db->update_google_cloud_key($api_key);
        return $c->render(json => { success => 1, message => 'Google Cloud API key updated successfully' });
    }

    return $c->render(json => { success => 0, error => 'Unknown settings section' });
}

1;
