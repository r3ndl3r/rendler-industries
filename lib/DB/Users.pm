# /lib/DB/Users.pm

package DB::Users;

use strict;
use warnings;
use Crypt::Eksblowfish::Bcrypt qw(bcrypt en_base64);

# Database helper for User Authentication and Management.
# Features:
#   - Secure user authentication via Bcrypt
#   - User lifecycle management (Create, Update, Delete)
#   - Role-based access control (Admin flags)
#   - Account approval workflow (Pending vs Approved status)
# Integration points:
#   - Extends DB package via package injection
#   - Depends on Crypt::Eksblowfish::Bcrypt for password hashing

# Inject methods into the main DB package

# Authenticates a user against stored credentials.
# Parameters:
#   username : Unique username
#   password : Plain text password
# Returns:
#   1 : Authentication successful
#   0 : Invalid credentials or user not found
#   2 : Account exists but is pending approval
sub DB::authenticate_user {
    my ($self, $username, $password) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    # Retrieve stored hash and account status
    my $sth = $self->{dbh}->prepare("SELECT password, status FROM users WHERE username = ?");
    $sth->execute($username);
    my $user = $sth->fetchrow_hashref();
    
    # Check if user exists
    return 0 unless $user;
    
    # Check account approval status
    return 2 if $user->{status} ne 'approved';
    
    # Compare provided password against stored Bcrypt hash
    return (bcrypt($password, $user->{password}) eq $user->{password}) ? 1 : 0;
}

# Registers a new user with secure password hashing.
# Parameters:
#   username : Unique username
#   password : Plain text password
#   email    : User email address
# Returns:
#   1 on success, dies on error
sub DB::create_user {
    my ($self, $username, $password, $email) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    my $hashed_password;
    
    # Generate secure salt and hash password (Bcrypt cost 10)
    eval {
        my $salt = en_base64(join('', map chr(int(rand(256))), 1..16));
        $hashed_password = bcrypt($password, '$2a$10$'.$salt);
    };
    
    if ($@) {
        die "Failed to hash password: $@";
    }
    
    # Insert new user record
    eval {
        my $sth = $self->{dbh}->prepare("INSERT INTO users (username, password, email) VALUES (?, ?, ?)");
        $sth->execute($username, $hashed_password, $email);
    };
    
    if ($@) {
        die "Failed to insert user into database: $@";
    }
    
    return 1;
}

# Checks if a username is already taken.
# Parameters:
#   username : Username to check
# Returns:
#   Boolean (True if exists, False otherwise)
sub DB::user_exists {
    my ($self, $username) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT COUNT(*) FROM users WHERE username = ?");
    $sth->execute($username);
    my ($count) = $sth->fetchrow_array();
    
    return $count > 0;
}

# Retrieves list of all registered users.
# Parameters: None
# Returns:
#   ArrayRef of HashRefs containing user details (excluding passwords)
sub DB::get_all_users {
    my ($self) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT id, username, email, created_at, is_admin, status FROM users");
    $sth->execute();
    
    return $sth->fetchall_arrayref({});
}

# Retrieves specific user details by ID.
# Parameters:
#   id : Unique User ID
# Returns:
#   HashRef with user details (excluding password), or undef
sub DB::get_user_by_id {
    my ($self, $id) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT id, username, email, is_admin, status FROM users WHERE id = ?");
    $sth->execute($id);
    
    return $sth->fetchrow_hashref();
}

# Updates user profile information.
# Parameters:
#   id       : User ID to update
#   username : New username
#   email    : New email
#   is_admin : Admin flag (1/0)
#   status   : Account status (e.g., 'approved', 'pending')
# Returns: Void
sub DB::update_user {
    my ($self, $id, $username, $email, $is_admin, $status) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("UPDATE users SET username = ?, email = ?, is_admin = ?, status = ? WHERE id = ?");
    $sth->execute($username, $email, $is_admin, $status, $id);
}

# Resets a user's password.
# Parameters:
#   id       : User ID
#   password : New plain text password
# Returns: Void
sub DB::update_user_password {
    my ($self, $id, $password) = @_;
    
    $self->ensure_connection;
    
    my $hashed_password;
    
    # Generate new salt and hash for the new password
    eval {
        my $salt = en_base64(join('', map chr(int(rand(256))), 1..16));
        $hashed_password = bcrypt($password, '$2a$10$'.$salt);
    };
    
    if ($@) {
        die "Failed to hash password: $@";
    }
    
    # Update password field
    my $sth = $self->{dbh}->prepare("UPDATE users SET password = ? WHERE id = ?");
    $sth->execute($hashed_password, $id);
}

# Permanently deletes a user account.
# Parameters:
#   id : User ID
# Returns: Void
sub DB::delete_user {
    my ($self, $id) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("DELETE FROM users WHERE id = ?");
    $sth->execute($id);
}

# Activates a pending user account.
# Parameters:
#   id : User ID
# Returns: Void
sub DB::approve_user {
    my ($self, $id) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("UPDATE users SET status = 'approved' WHERE id = ?");
    $sth->execute($id);
}

# Checks if a user has administrative privileges.
# Parameters:
#   username : Username to check
# Returns:
#   1 if admin, 0 otherwise
sub DB::is_admin {
    my ($self, $username) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT is_admin FROM users WHERE username = ?");
    $sth->execute($username);
    my ($is_admin) = $sth->fetchrow_array();
    
    return $is_admin ? 1 : 0;
}

# Helper to resolve username to internal ID.
# Parameters:
#   username : Username
# Returns:
#   Integer ID or undef
sub DB::get_user_id {
    my ($self, $username) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT id FROM users WHERE username = ?");
    $sth->execute($username);
    my ($id) = $sth->fetchrow_array();
    
    return $id;
}

# Retrieves the application secret key.
# Parameters: None
# Returns:
#   String containing the secret value
# Note: Typically handled by DB::Settings, but retained here for legacy access.
sub DB::get_app_secret {
    my ($self) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT secret_value FROM app_secrets WHERE key_name = 'mojo_app_secret'");
    $sth->execute();
    my ($secret) = $sth->fetchrow_array();
    
    return $secret;
}

# Retrieves Date of Birth records.
# Parameters: None
# Returns:
#   HashRef of DOB records keyed by name
sub DB::dob {
    my ($self) = @_;
    
    $self->ensure_connection;
    
    return $self->{dbh}->selectall_hashref("SELECT * FROM dob", 'name');
}

1;