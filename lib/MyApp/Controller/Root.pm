# /lib/MyApp/Controller/Root.pm

package MyApp::Controller::Root;
use Mojo::Base 'Mojolicious::Controller';
use Cwd qw(abs_path getcwd);
use Mojo::File 'path';
use HTML::Entities qw(encode_entities decode_entities);
use Mojo::Util qw(trim);

# Controller for core application logic and utility pages.
# Features:
#   - Main dashboard rendering
#   - Source code viewing utility (Restricted scope)
#   - Static page routing (Contact, Terms, Privacy)
#   - Admin Clipboard/Pastebin tool with notification integration
# Integration points:
#   - Uses Tools.pm for date/age calculations
#   - Uses DB helpers for clipboard persistence and push notifications

# Renders the main application dashboard.
# Route: GET /
# Parameters: None
# Returns:
#   Rendered HTML template 'index' with client IP and visit stats
sub index {
    my $c = shift;
    my $client_ip  = $c->tx->remote_address;
    
    # Track session visit frequency
    my $last_visit = $c->session('last_visit') || time();
    $c->session(last_visit => time());
    
    $c->stash(
        client_ip  => $client_ip,
        last_visit => $last_visit,
        logged_in  => $c->is_logged_in ? 1 : 0
    );
    $c->render('index');
}

# Renders a generic permission denied page.
# Route: Internal redirect
# Parameters: None
# Returns:
#   Rendered HTML template 'noperm'
sub no_permission { shift->render('noperm') }

# Utility to view server-side source files via the browser.
# Route: GET /source
# Parameters:
#   f : Relative path to the file (e.g., 'lib/MyApp.pm')
# Returns:
#   Raw text content of the file if allowed
#   400/403/404 Error status codes otherwise
# Security:
#   - Enforces strict directory whitelisting (public, templates, lib, script)
sub view_source {
    my $c = shift;
    
    # Define project root
    my $base_dir = abs_path(path($c->app->home)->child('.'));
    my $file_param = $c->param('f');
    
    return $c->render(text => "Invalid file.", status => 400) unless $file_param;

    # Resolve paths to absolute system paths
    my $requested_path = path($base_dir, $file_param)->to_string;
    my $real_path = abs_path($requested_path);
    
    return $c->render(text => "File not found.", status => 404) unless $real_path;

    # Define allowed directories for security whitelist
    my $public_dir       = abs_path(path($base_dir, 'public'));
    my $templates_dir    = abs_path(path($base_dir, 'templates'));
    my $lib_dir          = abs_path(path($base_dir, 'lib'));
    my $script_path      = abs_path(path($base_dir, 'mojo.pl'));
    
    # Check if requested file resides within allowed directories
    my $is_allowed = 0;
    if ($real_path) {
        $is_allowed =
             ($real_path eq $script_path)
          || ($real_path =~ m{^\Q$public_dir\E/})
          || ($real_path =~ m{^\Q$templates_dir\E/})
          || ($real_path =~ m{^\Q$lib_dir\E/});
    }

    # Serve file content if security check passes
    if ($is_allowed && -f $real_path) {
        my $text = path($real_path)->slurp;
        $c->render(text => $text, format => 'txt');
    }
    else {
        $c->render(text => "Access denied.", format => 'txt', status => 403);
    }
}

# JSON API endpoint serving age data for dashboard widgets.
# Route: GET /age
# Parameters: None
# Returns:
#   JSON object containing age strings (years/months/days) for configured users
sub age {
    my $c = shift;
    
    # Fetch DOB configuration
    my $dob = $c->db->dob();
    
    # Calculate ages using Tools plugin helpers
    my @andrea = $c->how_old($dob->{andrea}->{dob});
    my @nicky  = $c->how_old($dob->{nicky}->{dob});
    
    # Calculate server uptime
    my ($uptime_str, $uptime_seconds) = (0, 0);
    
    if (-r '/proc/uptime') {
        if (open my $fh, '<', '/proc/uptime') {
            my $line = <$fh>;
            close $fh;
            if ($line) {
                ($uptime_seconds) = split /\s+/, $line;
                $uptime_seconds = int($uptime_seconds);
                
                my $days = int($uptime_seconds / 86400);
                my $hours = int(($uptime_seconds % 86400) / 3600);
                my $minutes = int(($uptime_seconds % 3600) / 60);
                
                my @parts;
                push @parts, "$days day" . ($days != 1 ? 's' : '') if $days > 0;
                push @parts, "$hours hour" . ($hours != 1 ? 's' : '') if $hours > 0;
                push @parts, "$minutes minute" . ($minutes != 1 ? 's' : '') if $minutes > 0 || @parts == 0;
                
                if (@parts == 1) {
                    $uptime_str = $parts[0];
                } elsif (@parts == 2) {
                    $uptime_str = join(' and ', @parts);
                } else {
                    my $last = pop @parts;
                    $uptime_str = join(', ', @parts) . ' and ' . $last;
                }
            }
        }
    }
    
    $uptime_str ||= "Unable to read";
    
    $c->render(
        json => {
            andrea   => $andrea[0],
            andreas  => $andrea[1],
            nicky    => $nicky[0],
            nickys   => $nicky[1],
            server   => $uptime_str,
            servers  => $uptime_seconds,
        }
    );
}

# JSON API endpoint serving application source file list.
# Route: GET /system/api/file_map
# Parameters: None
# Returns:
#   JSON array of file paths
sub file_map_json {
    my $c = shift;
    my $files = $c->listFiles();
    $c->render(json => $files);
}

# Debug utility to display current working directory.
# Route: GET /cwd
# Returns: Plain text path
sub cwd { shift->render(text => "CWD: " . getcwd()) }

# JSON API endpoint serving semantic icon mappings as a JS variable.
# Route: GET /api/icons.js
# Returns: JavaScript assignment window.GLOBAL_ICONS = { ... }
sub get_icons_js {
    my $c = shift;
    # Public resource for UI icons
    $c->res->headers->content_type('application/javascript;charset=UTF-8');
    $c->render(text => "window.GLOBAL_ICONS = " . $c->icons_json . ";");
}

# Static Page Renders
sub t_page { shift->render('t') }
sub p_page { shift->render('p') }
sub sus { shift->render('sus') }

# Renders the Quick Access dashboard with dynamic tiles from DB
sub quick { 
    my $c = shift;
    
    # Retrieve the menu tree (already filtered by current user permissions)
    my $menu_tree = $c->menu();
    
    $c->render('quick', menu_tree => $menu_tree);
}


# Renders the Contact page.
# Route: GET /contact
# Returns:
#   Rendered HTML template 'contact' with list of QR code images
sub contact {
    my $c = shift;

    my @qr_images = qw(discord.png email.png line.jpg messenger.png);
    $c->render(template => 'contact', qr_images => \@qr_images);
}

# Renders the skeleton template for the Clipboard SPA.
# Route: GET /clipboard
# Parameters: None
# Returns: Rendered HTML template 'clipboard'.
sub copy_get {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;

    $c->render('clipboard');
}

# Returns the complete state for the Clipboard module.
# Route: GET /clipboard/api/state
# Parameters: None
# Returns: JSON object { success, messages, is_admin, user_config }
sub copy_api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id = $c->current_user_id;
    my $user = $c->db->get_user_by_id($user_id);
    my @msgs = $c->db->get_pasted($user_id);

    # Decodes HTML entities in the raw content field to provide the original 
    # text for clipboard and editor functionality, while preserving the 
    # encoded 'text' field for XSS-safe display.
    for my $msg (@msgs) {
        $msg->{raw} = decode_entities($msg->{raw});
    }

    $c->render(json => {
        success  => 1,
        messages => \@msgs,
        is_admin => $c->is_admin ? 1 : 0,
        user_config => {
            has_discord  => $user->{discord_id} ? 1 : 0,
            has_email    => $user->{email} ? 1 : 0,
            can_pushover => $c->is_admin ? 1 : 0,
            can_gotify   => $c->is_admin ? 1 : 0,
        }
    });
}

# Registers a new text snippet and dispatches selected notifications.
# Route: POST /copy
# Parameters:
#   paste           : Text content to store (String)
#   notify_discord  : Enable Discord DM (Boolean)
#   notify_email    : Enable Gmail delivery (Boolean)
#   notify_pushover : Enable Pushover alert (Admin only)
#   notify_gotify   : Enable Gotify push (Admin only)
# Returns: JSON object { success, message }
sub copy_post {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id = $c->current_user_id;
    my $text = trim($c->param('paste') // '');

    unless ($text) {
        return $c->render(json => { success => 0, error => "Content is required" });
    }

    # Persist to database
    my $encoded_text = encode_entities($text);
    my $id = $c->db->paste($user_id, $encoded_text);
    
    # Handle Dynamic Notifications
    my @channels;
    if ($c->param('notify_discord') && $c->db->get_user_by_id($user_id)->{discord_id}) {
        $c->send_discord_dm($c->db->get_user_by_id($user_id)->{discord_id}, "📋 CLIPBOARD: $text");
        push @channels, "Discord";
    }
    if ($c->param('notify_email') && $c->db->get_user_by_id($user_id)->{email}) {
        $c->send_email_via_gmail($c->db->get_user_by_id($user_id)->{email}, "Clipboard: New Content", $text);
        push @channels, "Email";
    }
    if ($c->is_admin) {
        if ($c->param('notify_pushover')) {
            $c->push_pushover($text);
            push @channels, "Pushover";
        }
        if ($c->param('notify_gotify')) {
            $c->push_gotify($text);
            push @channels, "Gotify";
        }
    }

    my $msg = "Content added.";
    $msg .= " Sent via " . join(", ", @channels) if @channels;

    $c->render(json => { success => 1, message => $msg });
}

# Modifies an existing clipboard entry.
# Route: POST /clipboard/update
# Parameters:
#   id    : Record ID (Integer)
#   paste : Updated text content (String)
# Returns: JSON object { success, message }
sub copy_update {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $id = $c->param('id');
    my $user_id = $c->current_user_id;
    my $text = trim($c->param('paste') // '');

    unless ($id && $id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => "Invalid ID" });
    }

    my $encoded_text = encode_entities($text);
    $c->db->update_message($id, $user_id, $encoded_text);

    $c->render(json => { success => 1, message => "Content updated." });
}

# Permanently removes a clipping from history.
# Route: POST /clipboard/delete
# Parameters:
#   id : Unique record ID (Integer)
# Returns: JSON object { success, message }
sub remove_message {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $id = $c->param('id');
    my $user_id = $c->current_user_id;

    unless ($id && $id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => "Invalid ID" });
    }

    $c->db->delete_message($id, $user_id);
    $c->render(json => { success => 1, message => "Content removed." });
}

1;
