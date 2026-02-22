# /lib/MyApp/Controller/Root.pm

package MyApp::Controller::Root;
use Mojo::Base 'Mojolicious::Controller';
use Tools;
use Cwd qw(abs_path getcwd);
use Mojo::File 'path';
use HTML::Entities qw(encode_entities);
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
        last_visit => $last_visit
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
    
    # Calculate ages using Tools.pm helper
    my @andrea = howOld($dob->{andrea}->{dob});
    my @nicky  = howOld($dob->{nicky}->{dob});
    
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

# Debug utility to display current working directory.
# Route: GET /cwd
# Returns: Plain text path
sub cwd { shift->render(text => "CWD: " . getcwd()) }

# Static Page Renders
sub t_page { shift->render('t') }
sub p_page { shift->render('p') }
sub sus { shift->render('sus') }
sub quick { shift->render('quick') }


# Renders the Contact page.
# Route: GET /contact
# Returns:
#   Rendered HTML template 'contact' with list of QR code images
sub contact {
    my $c = shift;
    my @qr_images = qw(discord.png email.png line.jpg messenger.png);
    $c->render(template => 'contact', qr_images => \@qr_images);
}

# Renders the Admin Clipboard/Pastebin interface.
# Route: GET /copy
# Parameters: None
# Returns:
#   Rendered HTML template 'copy/copy' with history
sub copy_get {
    my $c = shift;
    my $user_id = $c->current_user_id;
    my @msgs = $c->db->get_pasted($user_id);
    my $client_ip = $c->tx->remote_address;

    $c->stash(
        messages  => \@msgs,
        client_ip => $client_ip,
        is_admin  => $c->is_admin
    );

    $c->render('clipboard');
}

# Saves a new item to the Admin Clipboard.
# Route: POST /copy
# Parameters:
#   paste : Text content or URL to save
# Returns:
#   Redirects to clipboard page on success
# Behavior:
#   - Encodes HTML entities for safety
#   - Triggers external notifications (Pushover, Gotify) ONLY for user 'rendler'
sub copy_post {
    my $c = shift;
    my $user_id = $c->current_user_id;
    my $username = $c->session('user');
    my $text = trim($c->param('paste') // '');

    # Persist to database
    my $encoded_text = encode_entities($text);
    $c->db->paste($user_id, $encoded_text);
    
    # Dispatch external notifications ONLY for rendler
    if ($username eq 'rendler') {
        $c->db->push_over($text);
        $c->db->push_gotify($text);
    }
    
    return $c->redirect_to('/clipboard');
}

# Updates an existing item in the Admin Clipboard.
# Route: POST /clipboard/update
# Parameters:
#   id    : Unique ID of the message
#   paste : New text content
# Returns:
#   Redirects to clipboard page
sub copy_update {
    my $c = shift;
    my $id = $c->param('id');
    my $user_id = $c->current_user_id;
    my $text = trim($c->param('paste') // '');

    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render_error('Invalid ID');
    }

    my $encoded_text = encode_entities($text);
    $c->db->update_message($id, $user_id, $encoded_text);
    return $c->redirect_to('/clipboard');
}

# Removes an item from the Admin Clipboard.
# Route: POST /clipboard/delete
# Parameters:
#   id : Unique ID of the message to delete
# Returns:
#   Redirects to clipboard page
sub remove_message {
    my $c = shift;
    my $id = $c->param('id');
    my $user_id = $c->current_user_id;

    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render_error('Invalid ID');
    }

    $c->db->delete_message($id, $user_id);
    $c->redirect_to('/clipboard');
}

1;