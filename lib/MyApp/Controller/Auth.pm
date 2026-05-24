# /lib/MyApp/Controller/Auth.pm

package MyApp::Controller::Auth;
use Mojo::Base 'Mojolicious::Controller';

use utf8;
use Mojo::Util qw(trim);

use constant {
    LOGIN_FAILURE_THRESHOLD          => 5,
    LOGIN_FAILURE_WINDOW_SECONDS     => 15 * 60,
    LOGIN_LOCKOUT_SECONDS            => 15 * 60,
    LOGIN_LOCKOUT_ALERT_COOLDOWN_SEC => 30 * 60,
};

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
    return $c->redirect_to('/quick') if $c->is_logged_in;
    $c->render('auth/login', msg => $c->param('msg'));
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
    my $login_key = _login_username_key($username);

    if ($login_key && $c->db->get_active_login_lockout($login_key)) {
        $c->app->log->warn("Blocked login attempt for locked username $username from IP " . $c->tx->remote_address);
        return $c->redirect_to('/login?msg=invalid');
    }

    # Attempt authentication against database records
    # Returns: 1 (Success), 2 (Pending Approval), 0 (Failure)
    my $auth_result = $c->db->authenticate_user($username, $password);

    if ($auth_result == 1) {
        $c->db->clear_login_failures($login_key);

        # Security: Force session rotation by expiring the old ID and generating a new one
        # 1. Clear current session data
        $c->session({});
        
        # 2. Establish new user identity
        my $user_id = $c->db->get_user_id($username);
        $c->session(user => $username);
        $c->session(user_id => $user_id);
        
        # 3. Force Mojolicious to generate a fresh Session ID (Rotation)
        # This is the safest way to prevent session fixation in Mojo.
        $c->session(expires => time + (3600 * 24 * 30)); 
        
        # 4. Regenerate CSRF token for the new session
        $c->csrf_token;
        
        $c->app->log->info("User $username logged in (session rotated) from IP " . $c->tx->remote_address);
        
        # Determine destination: prioritizes the 'redirect' parameter for deep linking
        my $redirect = $c->param('redirect') || '/quick';
        
        # Security: Prevent Open Redirect attacks by enforcing local relative paths
        $redirect = '/quick' unless $redirect =~ m{^/};
        
        return $c->redirect_to($redirect);
    } elsif ($auth_result == 2) {
        # Handle "Pending Approval" state
        $c->app->log->warn("Pending approval login attempt for user $username from IP " . $c->tx->remote_address);
        _handle_login_failure($c, $username, $login_key);
        return $c->redirect_to('/login?msg=invalid');
    } else {
        # Handle invalid credentials
        $c->app->log->warn("Failed login attempt for user $username from IP " . $c->tx->remote_address);
        _handle_login_failure($c, $username, $login_key);
        return $c->redirect_to('/login?msg=invalid');
    }
}

sub _login_username_key {
    my ($username) = @_;
    $username = trim($username // '');
    return lc $username;
}

sub _handle_login_failure {
    my ($c, $username, $login_key) = @_;
    return unless $login_key;

    my $ip = $c->tx->remote_address;
    my $ua = $c->req->headers->user_agent // '';

    $c->db->record_login_failure($login_key, $ip, $ua);
    my $count = $c->db->count_recent_login_failures($login_key, LOGIN_FAILURE_WINDOW_SECONDS);
    return unless $count >= LOGIN_FAILURE_THRESHOLD;

    $c->db->activate_login_lockout($login_key, LOGIN_LOCKOUT_SECONDS, $count, $ip, $ua);

    return unless $c->db->should_send_login_lockout_alert($login_key, LOGIN_LOCKOUT_ALERT_COOLDOWN_SEC);
    _notify_admins_login_lockout($c, $username, $count, $ip, $ua);
    $c->db->mark_login_lockout_alerted($login_key);
}

sub _notify_admins_login_lockout {
    my ($c, $username, $count, $ip, $ua) = @_;

    my $admins = $c->db->get_admins();
    my $window_label = _duration_label(LOGIN_FAILURE_WINDOW_SECONDS);
    my $lockout_minutes = int(LOGIN_LOCKOUT_SECONDS / 60);
    for my $admin (@$admins) {
        $c->notify_templated($admin->{id}, 'security_login_lockout', {
            username       => $username || '(blank)',
            count          => $count,
            window         => $window_label,
            locked_minutes => $lockout_minutes,
            ip             => $ip || 'unknown',
            user_agent     => $ua || 'unknown',
        }, 0);
    }
}

sub _duration_label {
    my ($seconds) = @_;
    my $minutes = int($seconds / 60);
    return $minutes == 1 ? '1 minute' : "$minutes minutes";
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
    
    # Authentication failed: Capture the current request path and redirect to login
    # This enables seamless return to the intended page after successful login.
    my $path = $self->req->url->path;
    $self->redirect_to($self->url_for('/login')->query(redirect => $path));
    return undef;
}

# Terminates the user session.
# Route: POST /logout
# Parameters: None
# Returns:
#   Redirects to '/'
sub logout {
    my $c = shift;
    
    # Invalidate session cookie immediately with negative expiration
    $c->session(expires => 1);
    $c->session({}); # Clear all data
    
    return $c->redirect_to('/');
}

# Renders the registration interface.
# Route: GET /register
# Parameters: None
# Returns:
#   Rendered HTML template 'auth/register'
sub register_form {
    my $c = shift;
    $c->render('auth/register');
}

# Processes new user registration.
# Route: POST /register
# Parameters:
#   username : Desired username (3-20 chars, alphanumeric, underscore, hyphen, dot)
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
    return $c->render_error('Invalid username') unless $username =~ /^[a-zA-Z0-9_.\-]{3,20}$/;
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
    
    # Send email notification to admins
    eval {
        my $users = $c->db->get_all_users();
        my @admin_emails;
        foreach my $user (@$users) {
            if ($user->{is_admin} && $user->{email}) {
                push @admin_emails, $user->{email};
            }
        }

        if (@admin_emails) {
            my $subject = "New User Registration: $username";
            my $body = qq{A new user has registered and is awaiting approval:
            
Username: $username
Email: $email
IP Address: } . $c->tx->remote_address . qq{

Please log in to the admin panel to approve or reject this account.

- Rendler Industries®};

            $c->send_email_via_gmail(\@admin_emails, $subject, $body);
        }
    };
    if ($@) {
        $c->app->log->error("Failed to send admin registration email: $@");
    }

    # Return themed success page
    $c->render('auth/registration_success', username => $username);
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{r}->get('/login')->to('auth#login_form');
    $r->{r}->post('/login')->to('auth#login');
    $r->{auth}->post('/logout')->to('auth#logout');
    $r->{r}->get('/register')->to('auth#register_form');
    $r->{r}->post('/register')->to('auth#register');
}

1;
