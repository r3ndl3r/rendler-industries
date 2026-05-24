# /lib/MyApp/Controller/Root.pm

package MyApp::Controller::Root;
use Mojo::Base 'Mojolicious::Controller';
use HTML::Entities qw(encode_entities decode_entities);
use Time::Piece;
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
            success  => 1,
            andrea   => $andrea[0],
            andreas  => $andrea[1],
            nicky    => $nicky[0],
            nickys   => $nicky[1],
            server   => $uptime_str,
            servers  => $uptime_seconds,
        }
    );
}

# Static Page Renders
sub t_page { shift->render('t') }
sub p_page { shift->render('p') }
sub sus { shift->render('sus') }

# Renders the Quick Access dashboard with dynamic tiles from DB
sub quick { 
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    
    # Retrieve the menu tree (already filtered by current user permissions)
    my $menu_tree = $c->menu();
    my $tiles = _merge_quick_tiles($c, _quick_tiles($c, $menu_tree));
    
    $c->render('quick', tiles => $tiles);
}

sub quick_save_order {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $body = $c->req->json || {};
    my $order = $body->{order};
    return $c->render(json => { success => 0, error => 'Invalid payload' }, status => 400)
        unless ref $order eq 'ARRAY';

    my %valid = map { $_->{quick_id} => 1 } @{ _quick_tiles($c, $c->menu()) };
    my %seen;
    my @filtered;
    for my $id (@$order) {
        next unless defined $id && !ref $id;
        next if length($id) > 80;
        next unless $valid{$id};
        next if $seen{$id}++;
        push @filtered, $id;
    }

    $c->db->set_quick_sort_order($c->current_user_id, \@filtered);
    return $c->render(json => { success => 1, order => \@filtered });
}

sub _quick_tiles {
    my ($c, $menu_tree) = @_;
    my @tiles;
    _collect_quick_tiles($menu_tree || [], [], \@tiles);

    push @tiles, {
        quick_id       => 'action:restart',
        quick_group_id => 'action',
        action         => 'restart',
        label          => 'Restart',
        icon           => '⚠️',
        permission_level => 'admin',
    } if $c->is_admin;

    push @tiles, {
        quick_id       => 'action:logout',
        quick_group_id => 'action',
        action         => 'logout',
        label          => 'Logout',
        icon           => '🚪',
        url            => '/logout',
    } if $c->is_logged_in;

    return \@tiles;
}

sub _collect_quick_tiles {
    my ($items, $path, $out) = @_;
    for my $item (@$items) {
        next if $item->{is_separator};
        my @child_path = (@$path, $item->{id});
        if ($item->{url} && $item->{url} ne '#') {
            my $permission = $item->{permission_level} // 'user';
            push @$out, {
                %$item,
                quick_id       => 'menu:' . $item->{id},
                quick_group_id => @$path ? join('/', @$path) : 'root',
                _default_icon  => $permission eq 'admin' ? '⚙️' : '🔗',
            };
        }
        _collect_quick_tiles($item->{children} || [], \@child_path, $out);
    }
}

sub _merge_quick_tiles {
    my ($c, $tiles) = @_;
    my @saved_order = $c->is_logged_in ? @{ $c->db->get_quick_sort_order($c->current_user_id) } : ();

    unless (@saved_order) {
        _mark_quick_tile_new($_) for @$tiles;
        return $tiles;
    }

    my %by_id = map { $_->{quick_id} => $_ } @$tiles;
    my @merged;
    my %seen;

    for my $id (@saved_order) {
        next if $seen{$id}++;
        next unless my $tile = $by_id{$id};
        _mark_quick_tile_new($tile);
        push @merged, $tile;
    }

    for my $tile (@$tiles) {
        next if $seen{$tile->{quick_id}};
        _mark_quick_tile_new($tile);
        if (($tile->{quick_id} // '') =~ /^menu:/) {
            _insert_quick_tile_in_group(\@merged, $tile);
        } else {
            push @merged, $tile;
        }
        $seen{$tile->{quick_id}} = 1;
    }

    return \@merged;
}

sub _insert_quick_tile_in_group {
    my ($tiles, $tile) = @_;
    my $group = $tile->{quick_group_id} // '';
    for (my $i = $#$tiles; $i >= 0; $i--) {
        next unless ($tiles->[$i]{quick_group_id} // '') eq $group;
        splice @$tiles, $i + 1, 0, $tile;
        return;
    }
    push @$tiles, $tile;
}

sub _mark_quick_tile_new {
    my ($tile) = @_;
    $tile->{is_new} = _is_recent_quick_tile($tile->{created_at}) ? 1 : 0;
}

sub _is_recent_quick_tile {
    my ($created_at) = @_;
    return 0 unless $created_at;
    my $tp = eval { Time::Piece->strptime($created_at, "%Y-%m-%d %H:%M:%S") };
    return 0 unless $tp;
    return (time - $tp->epoch) < (48 * 60 * 60);
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
    return $c->redirect_to($c->url_for('/login')->query(redirect => $c->req->url->path)) unless $c->is_logged_in;

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
        $c->send_discord_dm($c->db->get_user_by_id($user_id)->{discord_id}, "📋 CLIPBOARD: $text", $user_id);
        push @channels, "Discord";
    }
    if ($c->param('notify_email') && $c->db->get_user_by_id($user_id)->{email}) {
        $c->send_email_via_gmail($c->db->get_user_by_id($user_id)->{email}, "Clipboard: New Content", $text, $user_id);
        push @channels, "Email";
    }
    if ($c->is_admin) {
        if ($c->param('notify_pushover')) {
            $c->push_pushover($text, $user_id);
            push @channels, "Pushover";
        }
        if ($c->param('notify_gotify')) {
            $c->push_gotify($text, undef, undef, $user_id);
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

# Provides a high-performance JSON mapping of all user emojis.
# Optimized for SPA state hydration and parity with /emojis module.
# Route: GET /api/user_icons
# Returns: JSON object { users => { username => emoji } }
sub api_user_icons {
    my $c = shift;
    
    # Security: Ensure consumer is authenticated
    return $c->render(json => { error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;
    
    $c->render(json => $c->icons_json_users);
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{r}->get('/')->to('root#index');
    $r->{r}->get('/noperm')->to('root#no_permission');
    $r->{r}->get('/age')->to('root#age');
    $r->{r}->get('/contacts')->to('root#contact');
    $r->{r}->get('/contact')->to('root#contact');
    $r->{r}->get('/c')->to('root#contact');
    $r->{r}->get('/p')->to('root#p_page');
    $r->{r}->get('/m')->to('root#p_page');
    $r->{r}->get('/phone')->to('root#p_page');
    $r->{r}->get('/mobile')->to('root#p_page');
    $r->{r}->get('/this.is.totally.not.sus')->to('root#sus');
    $r->{r}->get('/api/user_icons')->to('root#api_user_icons');
    $r->{r}->get('/quick')->to('root#quick');
    $r->{auth}->patch('/api/quick/order')->to('root#quick_save_order');
    $r->{auth}->get('/clipboard')->to('root#copy_get');
    $r->{auth}->get('/copy')->to('root#copy_get');
    $r->{auth}->get('/clipboard/api/state')->to('root#copy_api_state');
    $r->{auth}->post('/copy')->to('root#copy_post');
    $r->{auth}->post('/clipboard/update')->to('root#copy_update');
    $r->{auth}->post('/clipboard/delete')->to('root#remove_message');
}

1;
