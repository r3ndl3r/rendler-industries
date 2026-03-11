# /lib/MyApp/Controller/Admin.pm

package MyApp::Controller::Admin;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for User Administration and Role Management.
# Features:
#   - User listing and status monitoring
#   - Approval workflow for new registrations
#   - User profile editing (Roles, Details, Passwords)
#   - Account deletion
#   - Granular role toggling (Admin/Family)
# Integration points:
#   - Restricted to administrative members via router bridge
#   - Depends on DB::Users for all data persistence and aggregated roster data

# Renders the main user administration dashboard skeleton.
# Route: GET /users
# Parameters: None
# Returns: Rendered HTML template 'users'.
sub user_list {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_admin;

    $c->render('users');
}

# Returns the consolidated state for the module.
# Route: GET /users/api/state
# Parameters: None
# Returns: JSON object { users, is_admin, success }
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    
    my $state = {
        users           => $c->db->get_all_users(),
        is_admin        => $c->is_admin ? 1 : 0,
        current_user_id => $c->current_user_id,
        success         => 1
    };

    $c->render(json => $state);
}

# Permanently removes a user account.
# Route: POST /users/delete/:id
# Parameters:
#   id : Unique User ID
# Returns: JSON object { success, message, error }
sub delete_user {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $id = $c->param('id');
    
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => 'Invalid user ID' });
    }
    
    eval {
        $c->db->delete_user($id);
    };
    if ($@) {
        return $c->render(json => { success => 0, error => 'Database error while removing account' });
    }

    return $c->render(json => { success => 1, message => "Account removed." });
}

# Activates a pending user account.
# Route: POST /users/approve/:id
# Parameters:
#   id : Unique User ID
# Returns: JSON object { success, message, error }
sub approve_user {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $id = $c->param('id');
    
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => 'Invalid user ID' });
    }

    my $user = $c->db->get_user_by_id($id);
    unless ($user) {
        return $c->render(json => { success => 0, error => 'User not found' });
    }

    eval {
        $c->db->approve_user($id);
    };
    if ($@) {
        return $c->render(json => { success => 0, error => 'Database error while approving user' });
    }

    # Dispatch welcome email asynchronously
    if ($user->{email}) {
        eval {
            my $subject = "Account Approved: $user->{username}";
            my $body = qq{Hello $user->{username},\n\nYour account has been approved!\n\nLog in: https://rendler.org/login\n\n- Rendler Industries®};
            $c->send_email_via_gmail($user->{email}, $subject, $body);
        };
    }

    return $c->render(json => { success => 1, message => "User approved." });
}

# Processes updates to an existing user profile.
# Route: POST /users/update/:id
# Parameters:
#   id         : Unique User ID
#   username   : Updated username
#   email      : Updated email address
#   discord_id : Discord identifier
#   is_admin   : Administrative permission bit
#   is_family  : Family member permission bit
#   status     : Account lifecycle state
#   password   : New credential (Optional)
# Returns: JSON object { success, message, error }
sub edit_user {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $id = $c->param('id');
    my $username = trim($c->param('username') // '');
    my $email = trim($c->param('email') // '');
    my $discord_id = trim($c->param('discord_id') // '');
    
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => 'Invalid user ID' });
    }

    my $current_user = $c->db->get_user_by_id($id);
    unless ($current_user) {
        return $c->render(json => { success => 0, error => 'User not found' });
    }

    my $is_admin = defined $c->param('is_admin') ? ($c->param('is_admin') ? 1 : 0) : $current_user->{is_admin};
    my $is_family = defined $c->param('is_family') ? ($c->param('is_family') ? 1 : 0) : $current_user->{is_family};
    my $status = $c->param('status') // $current_user->{status} // 'pending';
    my $password = trim($c->param('password') // '');
    
    unless ($username =~ /^[a-zA-Z0-9_]{3,20}$/) {
        return $c->render(json => { success => 0, error => 'Invalid username (3-20 chars, alphanumeric/underscore)' });
    }
    unless ($email =~ /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/) {
        return $c->render(json => { success => 0, error => 'Invalid email format' });
    }
    
    eval {
        if (length $password > 0) {
            if (length($password) < 8) {
                die "Password too short (min 8 chars)";
            }
            $c->db->update_user_password($id, $password);
        }
        $c->db->update_user($id, $username, $email, $discord_id, $is_admin, $is_family, $status);
    };
    
    if ($@) {
        my $err = $@;
        $err =~ s/ at .*//s;
        return $c->render(json => { success => 0, error => $err });
    }
    
    return $c->render(json => { success => 1, message => "User profile updated successfully." });
}

# Granularly toggles a specific user role.
# Route: POST /users/toggle_role
# Parameters:
#   id    : Unique User ID
#   role  : Targeted role ('admin'|'family')
#   value : New boolean state
# Returns: JSON object { success, message, error }
sub toggle_role {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $id = $c->param('id');
    my $role = $c->param('role');
    my $value = $c->param('value');

    unless ($id && $id =~ /^\d+$/ && $role =~ /^(admin|family)$/ && defined $value) {
        return $c->render(json => { success => 0, error => 'Invalid parameters' });
    }

    # Security: Prevent admins from un-admining themselves
    if ($role eq 'admin' && $value == 0 && $id == $c->current_user_id) {
        return $c->render(json => { success => 0, error => 'You cannot remove your own administrative privileges.' });
    }

    eval {
        $c->db->toggle_user_role($id, $role, $value);
        $c->render(json => { success => 1, message => "Role updated" });
    };

    if ($@) {
        $c->app->log->error("Failed to toggle role ($role) for user $id: $@");
        $c->render(json => { success => 0, error => 'Database error while updating role' });
    }
}

1;
