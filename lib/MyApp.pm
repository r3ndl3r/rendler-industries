# /lib/MyApp.pm

package MyApp;

use utf8;
use Mojolicious::Controller;
use Mojo::Base 'Mojolicious';
use DB;
use Tools;
use Mojo::File 'path';
use Cwd 'abs_path';
use Path::Iterator::Rule;
use Mojo::JSON qw(decode_json encode_json);
use URI;

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

    # Set maximum request size limit (1GB) to support large file uploads
    $self->max_request_size(1024 * 1024 * 1024);
    
    # Load configuration plugin
    my $config = $self->plugin('Config');
    
    # Initialize DB connection to retrieve application secrets
    my $db = DB->new();
    my $secret = $db->get_app_secret();
    
    # Load Email plugin for notification delivery
    $self->plugin('MyApp::Plugin::Email');

    # Configure signed cookie secrets
    $self->secrets($config->{secrets} || [$secret]);
    
    # Configure Session Cookie parameters
    $self->sessions->cookie_name('session');
    $self->sessions->default_expiration(3600 * 24 * 30); # 30 Days
    
    # Helper: CSRF Token Generator
    # Parameters: None (Uses context)
    # Returns: Token string
    $self->helper(csrf_token => sub { shift->csrf_token });
    
    # Helper: Check if user is logged in
    # Parameters: None (Uses session)
    # Returns: Boolean (1 if logged in, 0 otherwise)
    $self->helper(
        is_logged_in => sub {
            my $c = shift;
            return $c->session('user') ? 1 : 0;
        }
    );
    
    # Helper: Check if current user has Admin privileges
    # Parameters: None (Uses session)
    # Returns: Boolean (1 if admin, 0 otherwise)
    $self->helper(
        is_admin => sub {
            my $c = shift;
            return 0 unless $c->session('user');
            return $db->is_admin($c->session('user'));
        }
    );
    
    # Helper: Retrieve database ID for current user
    # Parameters: None
    # Returns: Integer ID or 0 if not found
    $self->helper(
        current_user_id => sub {
            my $c = shift;
            my $username = $c->session('user') // '';
            return 0 unless $username;
            return $c->db->get_user_id($username);
        }
    );
    
    # Helper: Determine active resolution context (for responsive logic)
    # Parameters:
    #   r : Query parameter 'r'
    # Returns: Valid resolution string or 'default'
    $self->helper(
        current_resolution => sub {
            my $c = shift;
            my $res = $c->param('r') // '';
            return $res =~ /^[a-zA-Z0-9_-]+$/ ? $res : 'default';
        }
    );
    
    # Helper: List all application source files
    # Parameters: None
    # Returns: ArrayRef of filenames sorted alphabetically
    # Behavior: Scans public, templates, and lib directories for code files
    $self->helper(
        listFiles => sub {
            my @locations = ('public', 'templates', 'lib');
            my @all_files;
            my $rule = Path::Iterator::Rule->new->not_dir->name(qr/(pm|pl|js|css|ep)$/);
            
            for my $location (@locations) {
                push @all_files, $rule->all($location);
            }
            
            (my $file = __FILE__) =~ s{.*/}{};
            push @all_files, $file;
            
            my @sorted = sort { fc($a) cmp fc($b) } @all_files;
            return \@sorted;
        }
    );
    
    # Helper: Standardized Error Renderer
    # Parameters:
    #   message : Error description string
    #   status  : HTTP status code (Default: 400)
    # Returns: Rendered error template
    $self->helper(
        render_error => sub {
            my ($c, $message, $status) = @_;
            $status //= 400;
            $c->render('error', message => $message, status => $status);
        }
    );
    
    # Helper: Retrieve hierarchical menu tree based on user permissions
    # Parameters: None
    # Returns: ArrayRef of HashRefs (Tree structure)
    $self->helper(
        menu => sub {
            my $c = shift;
            my $permission = $c->is_admin ? 'admin' : ($c->is_logged_in ? 'user' : 'guest');
            return $c->db->get_menu_tree($permission);
        }
    );
    
    # Helper: Singleton Database Connection
    # Parameters: None
    # Returns: DB object instance
    $self->helper(db => sub { state $db = DB->new; return $db });
    
    # Define Application Routes
    my $r = $self->routes;

    # Protected Application Routes (Require Login or Admin)
    my $auth = $r->under('/')->to('auth#check_login');
    # Admin bridge nested under the auth bridge
    my $admin = $auth->under(sub {
        my $c = shift;
        
        # Use your existing helper which is already working in Timers.pm
        return 1 if $c->is_admin; 
        
        $c->render('noperm');
        return undef;
    });
    

    $r->get('/login')->to('auth#login_form');
    $r->post('/login')->to('auth#login');
    $r->get('/logout')->to('auth#logout');
    $r->get('/register')->to('auth#register_form');
    $r->post('/register')->to('auth#register');
    
    # --- Root / Utility / Misc Routes ---
    $r->get('/')->to('root#index');
    $r->get('/noperm')->to('root#no_permission');
    $r->get('/source')->to('root#view_source');
    $r->get('/cwd')->to('root#cwd');
    $r->get('/age')->to('root#age');
    $r->get('/contacts')->to('root#contact');
    $r->get('/contact')->to('root#contact');
    $r->get('/c')->to('root#contact');
    $r->get('/p')->to('root#p_page');
    $r->get('/m')->to('root#p_page');
    $r->get('/phone')->to('root#p_page');
    $r->get('/mobile')->to('root#p_page');
    $r->get('/this.is.totally.not.sus')->to('root#sus');
    $r->get('/api/v1/dynamic_data')->to('root#api_dynamic_data');
    $r->get('/t')->to(cb => sub { shift->redirect_to('https://stash.rendler.org/stash?n=Movies&u=rendler') });
    $r->get('/quick')->to('root#quick');
    $auth->get('/chelsea')->to('chelsea#index');
    $admin->get('/restart')->to('system#restart');

    # --- Menu Administration Routes ---
    $admin->get('/menu')->to('menu#manage');
    $admin->post('/menu/add')->to('menu#add');
    $admin->post('/menu/update')->to('menu#update');
    $admin->post('/menu/delete')->to('menu#delete');
    $admin->post('/menu/reorder')->to('menu#reorder');

    # --- Copy Routes ---
    $admin->get('/copy')->to('root#copy_get');
    $admin->post('/copy')->to('root#copy_post');
    $admin->post('/copy/delete/:id')->to('root#remove_message');

    # --- User Administration Routes ---
    $admin->get('/users')->to('admin#user_list');
    $admin->post('/users/delete/:id')->to('admin#delete_user');
    $admin->post('/users/approve/:id')->to('admin#approve_user');
    $admin->get('/users/edit/:id')->to('admin#edit_user_form');
    $admin->post('/users/update/:id')->to('admin#edit_user');
    
    # --- Imposter Game Routes ---
    $auth->get('/imposter')->to('imposter#index');
    $auth->post('/imposter/add_player')->to('imposter#add_custom_player');
    $auth->post('/imposter/edit_player')->to('imposter#edit_player');
    $auth->post('/imposter/remove_player')->to('imposter#remove_player');
    $auth->post('/imposter/clear_lobby')->to('imposter#clear_lobby');
    $auth->post('/imposter/start')->to('imposter#start_game');
    $auth->post('/imposter/toggle_view')->to('imposter#toggle_view');
    $auth->post('/imposter/set_lang')->to('imposter#set_language');
    $auth->post('/imposter/next_player')->to('imposter#next_player');
    $auth->post('/imposter/end_game_early')->to('imposter#end_game_early');
    $auth->post('/imposter/reveal')->to('imposter#reveal_results');
    $auth->post('/imposter/play_again')->to('imposter#play_again');
    
    # --- Swear Jar Routes ---
    $auth->get('/swear')->to('swear#index');
    $auth->post('/swear/add')->to('swear#add_fine');
    $auth->post('/swear/pay')->to('swear#pay_debt');
    $auth->post('/swear/spend')->to('swear#spend');
    $auth->get('/swear/manage')->to('swear#manage');
    $auth->post('/swear/member/add')->to('swear#add_member');
    $auth->post('/swear/member/delete')->to('swear#delete_member');
    
    # --- Birthday Calendar Routes ---
    $auth->get('/birthdays')->to('birthdays#index');
    $admin->get('/birthdays/manage')->to('birthdays#manage');
    $admin->post('/birthdays/add')->to('birthdays#add');
    $admin->post('/birthdays/edit')->to('birthdays#edit');
    $admin->post('/birthdays/delete')->to('birthdays#delete');

    # --- System Settings Routes ---
    $admin->get('/settings')->to('settings#index');
    $admin->post('/settings/update')->to('settings#update');

    # --- File Management Routes ---
    $r->get('/files/serve/:id')->to('files#serve');
    $admin->get('/files')->to('files#index');
    $admin->get('/files/upload')->to('files#upload_form');
    $admin->post('/files')->to('files#upload'); 
    $admin->post('/files/delete/:id')->to('files#delete_file');
    $admin->post('/files/permissions/:id')->to('files#edit_permissions');

    # --- Shopping List Routes ---
    $auth->get('/shopping')->to('shopping_list#index');
    $auth->post('/shopping/add')->to('shopping_list#add');
    $auth->post('/shopping/toggle/:id')->to('shopping_list#toggle');
    $auth->post('/shopping/delete/:id')->to('shopping_list#delete');
    $auth->post('/shopping/clear')->to('shopping_list#clear_checked');
    $auth->post('/shopping/edit/:id')->to('shopping_list#edit');

    # --- Connect 4 Routes ---
    $auth->get('/connect4/lobby')->to('connect4#lobby');
    $auth->get('/connect4/create')->to('connect4#create');
    $auth->get('/connect4/play/:id')->to('connect4#play');
    $auth->post('/connect4/join')->to('connect4#join');
    $auth->post('/connect4/move')->to('connect4#move');
    $auth->post('/connect4/restart')->to('connect4#restart');

    # --- UNO Routes ---
    $auth->get('/uno/lobby')->to('uno#lobby');
    $auth->get('/uno/create')->to('uno#create');
    $auth->post('/uno/join')->to('uno#join');
    $auth->get('/uno/play/:id')->to('uno#play');
    $auth->post('/uno/ready')->to('uno#toggle_ready');
    $auth->post('/uno/play_card')->to('uno#play_card');
    $auth->post('/uno/draw_card')->to('uno#draw_card');

    # --- Calendar Routes ---
    $auth->get('/calendar')->to('calendar#index');
    $auth->get('/calendar/events')->to('calendar#get_events');
    $auth->post('/calendar/add')->to('calendar#add');
    $auth->post('/calendar/edit')->to('calendar#edit');
    $auth->post('/calendar/delete')->to('calendar#delete');
    $auth->get('/calendar/manage')->to('calendar#manage');

    # --- Timer Routes ---
    $auth->get('/timers')->to('timers#dashboard');
    $auth->get('/timers/api/status')->to('timers#api_status');
    $auth->post('/timers/start')->to('timers#start_timer');
    $auth->post('/timers/stop')->to('timers#stop_timer');
    $auth->post('/timers/pause')->to('timers#toggle_pause');
    $admin->get('/timers/manage')->to('timers#manage');
    $admin->post('/timers/create')->to('timers#create');
    $admin->post('/timers/update/:id')->to('timers#update');
    $admin->post('/timers/delete/:id')->to('timers#delete');
    $admin->post('/timers/bonus')->to('timers#grant_bonus');
    $r->get('/timers/api/maintenance')->to('timers#run_maintenance');

    # --- Citizenship Quiz Routes ---
    $r->get('/quiz')->to('quiz#index');
    $r->get('/quiz/all')->to('quiz#index', mode => 'all');
    $r->get('/quiz/study')->to('quiz#study_mode');
    $r->get('/api/quiz/questions')->to('quiz#get_questions');

    # --- Go Links Routes ---
    $r->get('/g/:keyword')->to('go#resolve');
    $admin->get('/go')->to('go#index');
    $admin->post('/go/add')->to('go#add');
    $admin->post('/go/edit')->to('go#edit');
    $admin->post('/go/delete')->to('go#delete');

        # --- Chess Routes ---
    $auth->get('/chess/lobby')->to('chess#lobby');
    $auth->get('/chess/lobby_status')->to('chess#lobby_status');
    $auth->post('/chess/create')->to('chess#create');
    $auth->post('/chess/join')->to('chess#join_game');
    $auth->get('/chess/play/:id')->to('chess#play');
    $auth->post('/chess/move')->to('chess#move');
    $auth->get('/chess/status/:id')->to('chess#poll_status');
    $auth->post('/chess/offer_draw/:id')->to('chess#offer_draw');
    $auth->post('/chess/respond_draw/:id')->to('chess#respond_draw');
}


1;