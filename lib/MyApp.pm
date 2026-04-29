# /lib/MyApp.pm

package MyApp;

use utf8;
use Mojo::Base 'Mojolicious';
use DB;

# Core Application Class and Entry Point.
# Features:
#   - Application startup and configuration
#   - Global helper definitions (Authentication, DB Access, File listings)
#   - Centralized Route Dispatching
# Integration points:
#   - Inherits from Mojolicious
#   - Initializes the DB subsystem
#   - Defines the HTTP routing table

# Application startup hook.
# Parameters: None
# Returns: Void
# Behavior:
#   - Sets global request limits
#   - Loads configuration and secrets
#   - Configures session parameters
#   - Registers global helpers
#   - Defines all application routes
sub startup {
    my $self = shift;

    # Configure Logging: Ensure logs are written to a file instead of just STDERR
    my $log_path = $self->home->child('ignore', 'mojo.log');
    $self->log(Mojo::Log->new(path => $log_path, level => 'info'));

    # Set maximum request size limit (1GB) to support large file uploads
    $self->max_request_size(1024 * 1024 * 1024);

    # Load configuration plugin
    my $config = $self->plugin('Config');
    
    # Initialize DB connection to retrieve application secrets
    my $db = DB->new();
    my $secret = $db->get_app_secret();
    
    # Dynamically load all custom application plugins
    $self->home->child('lib', 'MyApp', 'Plugin')->list->sort->each(sub {
        my $file = shift;
        return unless $file->basename =~ /\.pm$/;
        $self->plugin("MyApp::Plugin::" . $file->basename('.pm'));
    });

    # Configure signed cookie secrets
    $self->secrets($config->{secrets} || [$secret]);
    
    # Configure Session Cookie parameters
    $self->sessions->cookie_name('session');
    $self->sessions->default_expiration(3600 * 24 * 30); # 30 Days

    # Global Hook: Disable caching for all responses to bypass Cloudflare/Proxy staleness.
    # This ensures absolute freshness for synchronized updates across all modules.
    # Uses after_dispatch (not before_dispatch) because Mojolicious's static file
    # server sets its own Cache-Control/ETag headers during dispatch, which would
    # overwrite any headers set in before_dispatch.
    # Toggable via my_app.conf (caching => 0/1)
    unless ($config->{caching}) {
        $self->hook(after_dispatch => sub {
            my $c = shift;
            $c->res->headers->cache_control('no-store, no-cache, must-revalidate, max-age=0');
            $c->res->headers->header('Pragma' => 'no-cache');
            $c->res->headers->header('Expires' => '0');
        });
    }

    # Global Hook: CSRF Enforcement
    # Protects all state-changing requests (POST, PUT, DELETE, PATCH)
    $self->hook(before_dispatch => sub {
        my $c = shift;

        # Only enforce on state-changing methods
        return if $c->req->method =~ /^(GET|HEAD|OPTIONS)$/i;

        # Retrieve token from header or parameter
        my $token = $c->req->headers->header('X-CSRF-Token') // $c->param('csrf_token');

        # Validate token
        if (!$token || $token ne $c->csrf_token) {
            $c->app->log->warn(sprintf(
                "CSRF failure: %s %s [IP: %s]",
                $c->req->method,
                $c->req->url->path,
                $c->tx->remote_address
            ));

            # Return 403 Forbidden with appropriate response type
            if (($c->req->headers->header('X-Requested-With') // '') eq 'XMLHttpRequest' || ($c->req->headers->accept // '') =~ /json/) {
                $c->render(json => { error => 'Security token mismatch', success => 0 }, status => 403);
            } else {
                $c->render(text => 'Security token mismatch', status => 403);
            }
            return undef; # Halt dispatch
        }
    });
    
    # Start the Native Background Poller
    # 1. Trigger immediate first run
    Mojo::IOLoop->next_tick(sub { $self->run_maintenance() });

    # 2. Schedule recurring runs (Every 60 seconds)
    Mojo::IOLoop->recurring(60 => sub {
        $self->run_maintenance();
    });
    # Define Application Routes
    my $r = $self->routes;

    # Protected Application Routes
    my $auth = $r->under('/')->to('auth#check_login');

    my $admin = $auth->under(sub {
        my $c = shift;
        return 1 if $c->is_admin;
        $c->render('noperm');
        return undef;
    });

    my $family = $auth->under(sub {
        my $c = shift;
        return 1 if $c->is_family;
        $c->render('noperm');
        return undef;
    });

    my $parent = $auth->under(sub {
        my $c = shift;
        return 1 if $c->is_parent;
        $c->render('noperm');
        return undef;
    });

    # Auto-discover and register routes from each controller.
    # Each controller may define a register_routes($bridges) class method.
    my %bridges = (
        r      => $r,
        auth   => $auth,
        family => $family,
        admin  => $admin,
        parent => $parent,
    );

    my $ctrl_dir = $self->home->child('lib', 'MyApp', 'Controller');
    my $lib_dir  = $self->home->child('lib');

    $ctrl_dir->list_tree->sort->each(sub {
        my $file = shift;
        return if -d $file || $file->basename !~ /\.pm$/;
        my $pkg = $file->to_rel($lib_dir)->to_string;
        $pkg =~ s|/|::|g;
        $pkg =~ s/\.pm$//;
        eval "require $pkg" or do {
            $self->log->error("Route loader: could not load $pkg: $@");
            return;
        };
        $pkg->register_routes(\%bridges) if $pkg->can('register_routes');
    });
}

1;
