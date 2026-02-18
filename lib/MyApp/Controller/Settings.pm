# /lib/MyApp/Controller/Settings.pm

package MyApp::Controller::Settings;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for Application Configuration Management.
# Features:
#   - Centralized settings display interface for admins
#   - Handles updates for Pushover, Gotify, Unsplash, App Secret, and Email settings
# Integration points:
#   - Uses DB::Settings for retrieving and updating configuration
#   - Admin-only access enforced via is_admin helper

# Renders the settings management interface.
# Route: GET /settings
# Parameters: None
# Returns:
#   Rendered HTML template 'settings' with current configuration
sub index {
    my $c = shift;
    
    return $c->redirect_to('/noperm') unless $c->is_admin;
    
    my $settings = $c->db->get_all_settings();
    my $email_settings = $c->db->get_email_settings();
    my $timer_reset_hour = $c->db->get_timer_reset_hour();
    
    $c->stash(
        settings => $settings,
        email_settings => $email_settings,
        timer_reset_hour => $timer_reset_hour
    );
    
    $c->render('settings');
}
# Processes updates for a specific configuration section.
# Route: POST /settings/update
# Parameters:
#   section            : The configuration block to update ('pushover', 'gotify', 'app_secret', 'unsplash', 'email', 'timers')
#   pushover_token     : (If section=pushover) API Token
#   pushover_user      : (If section=pushover) User Key
#   gotify_token       : (If section=gotify) App Token
#   app_secret         : (If section=app_secret) New session signature key (min 32 chars)
#   unsplash_key       : (If section=unsplash) API Access Key
#   gmail_email        : (If section=email) Gmail account address
#   gmail_app_password : (If section=email) Gmail app-specific password
#   gmail_from_name    : (If section=email) Display name for From header (optional)
#   timer_reset_hour   : (If section=timers) Hour of day (0-23) when timers reset
# Returns:
#   Redirects to settings page with flash message (Success/Error)
sub update {
    my $c = shift;
    
    return $c->redirect_to('/noperm') unless $c->is_admin;
    
    my $section = $c->param('section');
    
    if ($section eq 'pushover') {
        my $token = trim($c->param('pushover_token') // '');
        my $user = trim($c->param('pushover_user') // '');
        
        if ($token && $user) {
            $c->db->update_pushover($token, $user);
            $c->flash(message => 'Pushover settings updated successfully');
        } else {
            $c->flash(error => 'Pushover token and user are required');
        }
    }
    elsif ($section eq 'gotify') {
        my $token = trim($c->param('gotify_token') // '');
        
        if ($token) {
            $c->db->update_gotify($token);
            $c->flash(message => 'Gotify settings updated successfully');
        } else {
            $c->flash(error => 'Gotify token is required');
        }
    }
    elsif ($section eq 'app_secret') {
        my $secret = trim($c->param('app_secret') // '');
        
        if ($secret && length($secret) >= 32) {
            $c->db->update_app_secret($secret);
            $c->flash(message => 'App secret updated successfully. Restart required.');
        } else {
            $c->flash(error => 'App secret must be at least 32 characters');
        }
    }
    elsif ($section eq 'unsplash') {
        my $api_key = trim($c->param('unsplash_key') // '');
        
        $c->db->update_unsplash_key($api_key);
        
        if ($api_key) {
            $c->flash(message => 'Unsplash API key updated successfully');
        } else {
            $c->flash(message => 'Unsplash API key cleared (will use Picsum fallback)');
        }
    }
    elsif ($section eq 'email') {
        my $gmail_email = trim($c->param('gmail_email') // '');
        my $gmail_password = trim($c->param('gmail_app_password') // '');
        $gmail_password =~ s/\s+//g;
        my $from_name = trim($c->param('gmail_from_name') // '');
        
        if ($gmail_email && $gmail_password) {
            unless ($gmail_email =~ /^[a-zA-Z0-9._%+-]+\@gmail\.com$/) {
                $c->flash(error => 'Invalid Gmail address (must be @gmail.com)');
                return $c->redirect_to('/settings');
            }
            
            $c->db->update_email_settings($gmail_email, $gmail_password, $from_name);
            $c->flash(message => 'Email settings updated successfully');
        } else {
            $c->flash(error => 'Gmail email and app password are required');
        }
    }
    elsif ($section eq 'timers') {
        my $reset_hour = $c->param('timer_reset_hour');
        
        unless (defined $reset_hour && $reset_hour =~ /^\d+$/ && $reset_hour >= 0 && $reset_hour <= 23) {
            $c->flash(error => 'Invalid timer reset hour (must be 0-23)');
            return $c->redirect_to('/settings');
        }
        
        $c->db->set_timer_reset_hour($reset_hour);
        
        my $display_hour = $reset_hour == 0 ? '12:00 AM' 
                         : $reset_hour < 12 ? sprintf("%d:00 AM", $reset_hour)
                         : $reset_hour == 12 ? '12:00 PM'
                         : sprintf("%d:00 PM", $reset_hour - 12);
        
        $c->flash(message => "Timer reset time set to $display_hour (Australia/Melbourne timezone)");
    }
    
    return $c->redirect_to('/settings');
}

1;