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
#   Redirects to user list on success
#   Renders error if ID is invalid
sub delete_user {
    my $c = shift;
    my $id = $c->param('id');
    
    # Validate User ID format
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render_error('Invalid user ID');
    }
    
    # Execute deletion
    $c->db->delete_user($id);

    return $c->redirect_to('/users');
}

# Activates a pending user account.
# Route: POST /users/approve
# Parameters:
#   id : Unique User ID (Integer)
# Returns:
#   Redirects to user list on success
#   Renders error if ID is invalid
sub approve_user {
    my $c = shift;
    my $id = $c->param('id');
    
    # Validate User ID format
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render_error('Invalid user ID');
    }

    # Perform approval status update
    $c->db->approve_user($id);

    return $c->redirect_to('/users');
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
#   Redirects to user list on success
#   Renders error on validation failure
sub edit_user {
    my $c = shift;
    my $id = $c->param('id');
    my $username = trim($c->param('username') // '');
    my $email = trim($c->param('email') // '');
    my $is_admin = $c->param('is_admin') ? 1 : 0;
    my $status = $c->param('status') // 'pending';
    my $password = $c->param('password');
    
    # Validate User ID format
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render_error('Invalid user ID');
    }
    
    # Validate strict username and email formats
    return $c->render_error('Invalid username') unless $username =~ /^[a-zA-Z0-9_]{3,20}$/;
    return $c->render_error('Invalid email')
        unless $email =~ /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    
    # Conditionally update password if provided
    if (defined $password && length $password > 0) {
        return $c->render_error('Password too short') if length($password) < 8;
        $c->db->update_user_password($id, $password);
    }
    
    # Update profile details
    $c->db->update_user($id, $username, $email, $is_admin, $status);
    
    return $c->redirect_to('/users');
}

1;