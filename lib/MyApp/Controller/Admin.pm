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
# Integration points:
#   - Uses DB::Users helpers for all data persistence

# Renders the main user administration dashboard.
# Route: GET /users
# Parameters: None
# Returns:
#   Rendered HTML template 'users/admin' with list of all users
sub user_list {
    my $c = shift;

    # Debug Flash Message
    if (my $msg = $c->flash('message')) {
        $c->app->log->debug("DEBUG FLASH: $msg");
        # Re-flash it so it's available to the template (flash is consume-once)
        $c->flash(message => $msg);
    } else {
        $c->app->log->debug("DEBUG FLASH: No message");
    }

    # Fetch full user roster for display
    my $users = $c->db->get_all_users();
    
    $c->stash(users => $users);
    $c->render('users/admin');
}

# Permanently deletes a user account.
# Route: POST /users/delete
# Parameters:
#   id : Unique User ID (Integer)
# Returns:
#   JSON response
sub delete_user {
    my $c = shift;
    my $id = $c->param('id');
    
    # Validate User ID format
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => 'Invalid user ID' });
    }
    
    # Execute deletion
    eval {
        $c->db->delete_user($id);
    };
    if ($@) {
        return $c->render(json => { success => 0, error => 'Database error' });
    }

    return $c->render(json => { success => 1, message => "User ID $id deleted successfully." });
}

# Activates a pending user account.
# Route: POST /users/approve
# Parameters:
#   id : Unique User ID (Integer)
# Returns:
#   JSON response
sub approve_user {
    my $c = shift;
    my $id = $c->param('id');
    
    # Validate User ID format
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => 'Invalid user ID' });
    }

    # Fetch user details before approval to get email
    my $user = $c->db->get_user_by_id($id);
    unless ($user) {
        return $c->render(json => { success => 0, error => 'User not found' });
    }

    # Perform approval status update
    eval {
        $c->db->approve_user($id);
    };
    if ($@) {
        return $c->render(json => { success => 0, error => 'Database error' });
    }

    # Send notification email to the user
    if ($user->{email}) {
        eval {
            my $subject = "Account Approved: $user->{username}";
            my $body = qq{Hello $user->{username},

Your account has been approved and is now active! 

You can now log in to the dashboard at: https://rendler.org/login

- Rendler Industries®};

            $c->send_email_via_gmail($user->{email}, $subject, $body);
        };
        if ($@) {
            $c->app->log->error("Failed to send approval email to $user->{username}: $@");
        }
    }

    return $c->render(json => { success => 1, message => "User '$user->{username}' approved successfully." });
}

# Renders the form for editing an existing user.
# Route: GET /users/edit
# Parameters:
#   id : Unique User ID (Integer)
# Returns:
#   Rendered HTML template 'users/edit' with user data
#   Renders 404 if user not found
sub edit_user_form {
    my $c = shift;
    my $id = $c->param('id');

    # Validate User ID format
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render_error('Invalid user ID');
    }

    # Retrieve current user data
    my $user = $c->db->get_user_by_id($id);

    unless ($user) {
        return $c->render_error('User not found', 404);
    }

    $c->stash(user => $user);
    $c->render('users/edit');
}

# Processes updates to a user profile.
# Route: POST /users/update
# Parameters:
#   id       : Unique User ID (Integer)
#   username : New username (3-20 chars, alphanumeric)
#   email    : New email address
#   is_admin : Admin flag (1 for true, 0 for false)
#   status   : Account status (e.g., 'pending', 'approved')
#   password : (Optional) New password to set. Ignored if empty.
# Returns:
#   JSON response
sub edit_user {
    my $c = shift;
    my $id = $c->param('id');
    my $username = trim($c->param('username') // '');
    my $email = trim($c->param('email') // '');
    my $discord_id = trim($c->param('discord_id') // '');
    
    # Validate User ID format
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => 'Invalid user ID' });
    }

    # Retrieve current user data to preserve roles if not in form
    my $current_user = $c->db->get_user_by_id($id);
    unless ($current_user) {
        return $c->render(json => { success => 0, error => 'User not found' });
    }

    my $is_admin = defined $c->param('is_admin') ? ($c->param('is_admin') ? 1 : 0) : $current_user->{is_admin};
    my $is_family = defined $c->param('is_family') ? ($c->param('is_family') ? 1 : 0) : $current_user->{is_family};
    
    # Logic: Protection - Preserve existing status if not provided in request
    my $status = $c->param('status') // $current_user->{status} // 'pending';
    my $password = $c->param('password');
    
    # Validate strict username and email formats
    unless ($username =~ /^[a-zA-Z0-9_]{3,20}$/) {
        return $c->render(json => { success => 0, error => 'Invalid username (3-20 chars, alphanumeric/underscore)' });
    }
    unless ($email =~ /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/) {
        return $c->render(json => { success => 0, error => 'Invalid email format' });
    }
    
    eval {
        # Conditionally update password if provided
        if (defined $password && length $password > 0) {
            if (length($password) < 8) {
                die "Password too short (min 8 chars)";
            }
            $c->db->update_user_password($id, $password);
        }
        
        # Update profile details
        $c->db->update_user($id, $username, $email, $discord_id, $is_admin, $is_family, $status);
    };
    
    if ($@) {
        my $err = $@;
        $err =~ s/ at .*//s;
        return $c->render(json => { success => 0, error => $err });
    }
    
    return $c->render(json => { success => 1, message => "User profile updated successfully." });
}

# API Endpoint: Granularly toggles a user role (Admin/Family) via AJAX.
# Route: POST /users/toggle_role
# Parameters:
#   id    : User ID
#   role  : 'admin' or 'family'
#   value : 1 or 0
# Returns:
#   JSON: { success => 1 } or { success => 0, error => $msg }
sub toggle_role {
    my $c = shift;
    my $id = $c->param('id');
    my $role = $c->param('role');
    my $value = $c->param('value');

    unless ($id && $id =~ /^\d+$/ && $role =~ /^(admin|family)$/ && defined $value) {
        return $c->render(json => { success => 0, error => 'Invalid parameters' });
    }

    eval {
        $c->db->toggle_user_role($id, $role, $value);
        $c->render(json => { success => 1 });
    };

    if ($@) {
        $c->app->log->error("Failed to toggle role ($role) for user $id: $@");
        $c->render(json => { success => 0, error => 'Database error' });
    }
}

1;