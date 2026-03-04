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

# Renders the main user administration dashboard (Skeleton).
# Route: GET /users
# Parameters: None
# Returns: Rendered HTML template 'users'.
sub user_list {
    my $c = shift;

    # Handle AJAX state request
    if ($c->req->headers->header('X-Requested-With') && $c->req->headers->header('X-Requested-With') eq 'XMLHttpRequest') {
        my $users = $c->db->get_all_users();
        return $c->render(json => { 
            success => 1, 
            users   => $users,
            is_admin => $c->is_admin ? 1 : 0
        });
    }

    $c->render('users');
}

# Permanently removes a user account via AJAX.
# Route: POST /users/delete/:id
# Parameters:
#   id : Unique User ID (Integer)
# Returns: JSON object { success, message }
sub delete_user {
    my $c = shift;
    my $id = $c->param('id');
    
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => 'Invalid user ID' });
    }
    
    eval {
        $c->db->delete_user($id);
    };
    if ($@) {
        return $c->render(json => { success => 0, error => 'Database error' });
    }

    return $c->render(json => { success => 1, message => "Account removed." });
}

# Activates a pending user account via AJAX.
# Route: POST /users/approve/:id
# Parameters:
#   id : Unique User ID (Integer)
# Returns: JSON object { success, message }
sub approve_user {
    my $c = shift;
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
        return $c->render(json => { success => 0, error => 'Database error' });
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

# Processes updates to a user profile via AJAX.
# Route: POST /users/update/:id
# Parameters:
#   id         : Unique User ID (Integer)
#   username   : New username (String)
#   email      : New email address (String)
#   discord_id : Discord user identifier (String)
#   is_admin   : Administrative bit (Boolean)
#   is_family  : Family member bit (Boolean)
#   status     : Account lifecycle state (String)
#   password   : New credential (Optional String)
# Returns: JSON object { success, message }
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

# Granularly toggles a user role (Admin/Family) via AJAX.
# Route: POST /users/toggle_role
# Parameters:
#   id    : User ID (Integer)
#   role  : Targeted role ('admin'|'family')
#   value : New boolean state (1|0)
# Returns: JSON object { success }
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