# /lib/DB/Users.pm

package DB::Users;

use strict;
use warnings;
use Crypt::Eksblowfish::Bcrypt qw(bcrypt en_base64);

# User Authentication and Role-Based Access Control Database Library.
#
# Features:
#   - Secure user authentication using Bcrypt-based hashing.
#   - Full user lifecycle management (Registration, Approval, Update, Deletion).
#   - Role-Based Access Control (RBAC): Admin, Family, User, and Guest levels.
#   - Account approval workflow with state-driven transitions (Pending/Approved).
#   - Detailed user auditing and platform-wide profile management.
#
# Integration Points:
#   - Extends the core DB package via package injection.
#   - Acts as the primary security layer for the Auth controller (Login/Register).
#   - Serves as the data source for the Admin controller for platform auditing.
#   - Coordinates with Email and Discord plugins for automated approval notifications.
#   - Provides $c->is_admin, $c->is_family, and $c->is_logged_in via session lookups.

# Authenticates a user against stored credentials.
# Parameters:
#   username : String identifier.
#   password : Plain text string.
# Returns:
#   Integer: 1 (Success), 0 (Invalid), 2 (Pending Approval).
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
#   username : String.
#   password : Plain text string.
#   email    : User email address.
# Returns:
#   Integer: Newly created user ID on success.
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
    
    # Return the new User ID to allow immediate role/status configuration
    return $self->{dbh}->last_insert_id(undef, undef, 'users', 'id');
}

# Checks if a username is already taken.
# Parameters:
#   username : String to check.
# Returns:
#   Boolean : True if exists.
sub DB::user_exists {
    my ($self, $username) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT COUNT(*) FROM users WHERE username = ?");
    $sth->execute($username);
    my ($count) = $sth->fetchrow_array();
    
    return $count > 0;
}

# Checks if an email address is already registered.
# Parameters:
#   email : Email string to check.
# Returns:
#   Boolean : True if exists.
sub DB::email_exists {
    my ($self, $email) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT COUNT(*) FROM users WHERE email = ?");
    $sth->execute($email);
    my ($count) = $sth->fetchrow_array();
    
    return $count > 0;
}

# Retrieves list of all registered users.
# Parameters: None
# Returns:
#   ArrayRef of HashRefs containing user details (excluding passwords).
sub DB::get_all_users {
    my ($self) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT id, username, email, discord_id, created_at, is_admin, is_family, is_child, status FROM users");
    $sth->execute();
    
    return $sth->fetchall_arrayref({});
}

# Retrieves list of approved family members for selection dropdowns.
# Parameters: None
# Returns:
#   ArrayRef of HashRefs containing user details.
sub DB::get_family_users {
    my ($self) = @_;
    
    $self->ensure_connection;
    
    # Strict Privacy: Filter by is_family and status at the database level.
    my $sql = "SELECT id, username, email, discord_id FROM users WHERE is_family = 1 AND status = 'approved' ORDER BY username ASC";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute();
    
    return $sth->fetchall_arrayref({});
}

# Retrieves list of approved administrative users.
# Parameters: None
# Returns:
#   ArrayRef of HashRefs containing user details.
sub DB::get_admins {
    my ($self) = @_;
    
    $self->ensure_connection;
    
    # Strict Privacy: Filter by is_admin and status at the database level.
    my $sql = "SELECT id, username, email, discord_id FROM users WHERE is_admin = 1 AND status = 'approved' ORDER BY username ASC";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute();
    
    return $sth->fetchall_arrayref({});
}

# Retrieves specific user details by ID.
# Parameters:
#   id : Unique User ID.
# Returns:
#   HashRef with user details (excluding password), or undef.
sub DB::get_user_by_id {
    my ($self, $id) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT id, username, email, discord_id, is_admin, is_family, is_child, status FROM users WHERE id = ?");
    $sth->execute($id);
    
    return $sth->fetchrow_hashref();
}

# Updates user profile information.
# Parameters:
#   id, username, email, discord_id, is_admin, is_family, is_child, status : Attributes.
# Returns: Void.
sub DB::update_user {
    my ($self, $id, $username, $email, $discord_id, $is_admin, $is_family, $is_child, $status) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("UPDATE users SET username = ?, email = ?, discord_id = ?, is_admin = ?, is_family = ?, is_child = ?, status = ? WHERE id = ?");
    $sth->execute($username, $email, $discord_id, $is_admin, $is_family, $is_child, $status, $id);
}

# Resets a user's password.
# Parameters:
#   id       : User ID.
#   password : New plain text string.
# Returns: Void.
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
#   id : Unique User ID.
# Returns: Void.
sub DB::delete_user {
    my ($self, $id) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("DELETE FROM users WHERE id = ?");
    $sth->execute($id);
}

# Activates a pending user account.
# Parameters:
#   id : Unique User ID.
# Returns: Void.
sub DB::approve_user {
    my ($self, $id) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("UPDATE users SET status = 'approved' WHERE id = ?");
    $sth->execute($id);
}

# Checks if a user has administrative privileges.
# Parameters:
#   username : String identifier.
# Returns:
#   Integer : 1 if Admin, 0 otherwise.
sub DB::is_admin {
    my ($self, $username) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT is_admin FROM users WHERE username = ?");
    $sth->execute($username);
    my ($is_admin) = $sth->fetchrow_array();
    
    return $is_admin ? 1 : 0;
}

# Checks if a user has family member status.
# Parameters:
#   username : String identifier.
# Returns:
#   Integer : 1 if Family, 0 otherwise.
sub DB::is_family {
    my ($self, $username) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT is_family FROM users WHERE username = ?");
    $sth->execute($username);
    my ($is_family) = $sth->fetchrow_array();
    
    return $is_family ? 1 : 0;
}

# Checks if a user has child status.
# Parameters:
#   username : String identifier.
# Returns:
#   Integer : 1 if Child, 0 otherwise.
sub DB::is_child {
    my ($self, $username) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT is_child FROM users WHERE username = ?");
    $sth->execute($username);
    my ($is_child) = $sth->fetchrow_array();
    
    return $is_child ? 1 : 0;
}

# Granularly toggles a specific user role (is_admin, is_family, or is_child).
# Parameters:
#   id    : User ID.
#   role  : Column name ('admin' -> is_admin, 'family' -> is_family, 'child' -> is_child).
#   value : Boolean (1/0).
# Returns: Void.
sub DB::toggle_user_role {
    my ($self, $id, $role, $value) = @_;
    $self->ensure_connection;
    
    my $column = 'is_family';
    $column = 'is_admin' if $role eq 'admin';
    $column = 'is_child' if $role eq 'child';
    
    my $sth = $self->{dbh}->prepare("UPDATE users SET $column = ? WHERE id = ?");
    $sth->execute($value, $id);
}

# Helper to resolve username to internal ID.
# Parameters:
#   username : String name.
# Returns:
#   Integer : User ID or undef.
sub DB::get_user_id {
    my ($self, $username) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT id FROM users WHERE username = ?");
    $sth->execute($username);
    my ($id) = $sth->fetchrow_array();
    
    return $id;
}

# Retrieves the application secret key for session signing.
# Parameters: None.
# Returns:
#   String : The primary application secret.
sub DB::get_app_secret {
    my ($self) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT secret_value FROM app_secrets WHERE key_name = 'mojo_app_secret'");
    $sth->execute();
    my ($secret) = $sth->fetchrow_array();
    
    return $secret;
}

# Retrieves Date of Birth records.
# Parameters: None.
# Returns:
#   HashRef of DOB records keyed by name.
sub DB::dob {
    my ($self) = @_;
    
    $self->ensure_connection;
    
    return $self->{dbh}->selectall_hashref("SELECT * FROM dob", 'name');
}

1;
