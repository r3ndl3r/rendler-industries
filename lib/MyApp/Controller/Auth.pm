# /lib/MyApp/Controller/Auth.pm

package MyApp::Controller::Auth;
use Mojo::Base 'Mojolicious::Controller';

use Mojo::Util qw(trim);

# Controller for User Authentication and Session Management.
# Features:
#   - User Login with status handling (Active vs Pending)
#   - Session lifecycle management (Login/Logout)
#   - New User Registration with validation
# Integration points:
#   - Uses DB::Users for credential verification and creation
#   - Manages Mojolicious signed cookies ($c->session)

# Renders the login interface.
# Route: GET /login
# Parameters:
#   msg : Optional error/status code string (e.g., 'invalid', 'pending')
# Returns:
#   Rendered HTML template 'login'
sub login_form {
    my $c = shift;
    $c->render('login', msg => $c->param('msg'));
}

# Processes user login credentials.
# Route: POST /login
# Parameters:
#   username : User identifier
#   password : Plain text password
# Returns:
#   Redirect to '/' on success
#   Redirect to '/login' with error message on failure or pending status
sub login {
    my $c = shift;
    
    # Sanitize input parameters
    my $username = trim($c->param('username') // '');
    my $password = $c->param('password');

    # Attempt authentication against database records
    # Returns: 1 (Success), 2 (Pending Approval), 0 (Failure)
    my $auth_result = $c->db->authenticate_user($username, $password);

    if ($auth_result == 1) {
        # Establish session and log access
        $c->session(user => $username); 
        $c->app->log->info("User $username logged in from IP " . $c->tx->remote_address);
        return $c->redirect_to('/');
    } elsif ($auth_result == 2) {
        # Handle "Pending Approval" state
        $c->app->log->warn("Pending approval login attempt for user $username from IP " . $c->tx->remote_address);
        return $c->redirect_to('/login?msg=pending');
    } else {
        # Handle invalid credentials
        $c->app->log->warn("Failed login attempt for user $username from IP " . $c->tx->remote_address);
        return $c->redirect_to('/login?msg=invalid');
    }
}

# Acts as a security gatekeeper for protected routes.
# Route: BRIDGE (used in $r->under)
# Parameters: None
# Returns:
#   1 on success (allow access)
#   undef on failure (redirect to login)
sub check_login {
    my $self = shift;
    
    # Check session using the application-wide helper
    if ($self->is_logged_in) {
        return 1;
    }
    
    # Authentication failed: Redirect and halt the chain
    $self->redirect_to('/login');
    return undef;
}

# Terminates the user session.
# Route: GET /logout
# Parameters: None
# Returns:
#   Redirects to '/'
sub logout {
    my $c = shift;
    
    # Invalidate session cookie immediately
    $c->session(expires => 1);
    
    return $c->redirect_to('/');
}

# Renders the registration interface.
# Route: GET /register
# Parameters: None
# Returns:
#   Rendered HTML template 'register'
sub register_form {
    my $c = shift;
    $c->render('register');
}

# Processes new user registration.
# Route: POST /register
# Parameters:
#   username : Desired username (3-20 chars, alphanumeric)
#   password : Plain text password (min 8 chars)
#   email    : Valid email address
# Returns:
#   HTTP 200 Text confirmation on success
#   Rendered error on validation failure or database error
sub register {
    my $c = shift;
    
    # Sanitize inputs
    my $username = trim($c->param('username') // '');
    my $password = $c->param('password');
    my $email    = trim($c->param('email') // '');

    # Validate input formats strict compliance
    return $c->render_error('Invalid username') unless $username =~ /^[a-zA-Z0-9_]{3,20}$/;
    return $c->render_error('Password too short') if length($password) < 8;
    return $c->render_error('Invalid email')
      unless $email =~ /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    # Check for existing username collision
    if ($c->db->user_exists($username)) {
        return $c->render_error('Username already exists');
    }

    # Attempt to create new user record
    eval { $c->db->create_user($username, $password, $email); };
    if (my $error = $@) {
        $c->app->log->error("Failed to create user: $error");
        return $c->render_error("Error creating user: $error", 500);
    }

    # Log registration event
    $c->app->log->info("New user registered (pending approval): $username from IP " . $c->tx->remote_address);
    
    # Return success message (Frontend should handle redirection)
    $c->render(text => 'New user registered (pending approval).', status => 200);
}

1;