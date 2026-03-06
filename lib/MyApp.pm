# /lib/MyApp.pm

package MyApp;

use utf8;
use Mojolicious::Controller;
use Mojo::Base 'Mojolicious';
use DB;
use Mojo::File 'path';
use Cwd 'abs_path';
use Path::Iterator::Rule;
use Mojo::JSON qw(decode_json encode_json);
use Mojo::UserAgent;
use URI;
use DateTime;

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
    
    # Load standardized icons
    $self->plugin('MyApp::Plugin::Icons');
    
    # Initialize DB connection to retrieve application secrets
    my $db = DB->new();
    my $secret = $db->get_app_secret();
    
    # Load plugins
    $self->plugin('MyApp::Plugin::Notifications');
    $self->plugin('MyApp::Plugin::Tools');
    $self->plugin('MyApp::Plugin::OCR');
    $self->plugin('MyApp::Plugin::TTS');
    $self->plugin('MyApp::Plugin::Translation');

    # Configure signed cookie secrets
    $self->secrets($config->{secrets} || [$secret]);
    
    # Configure Session Cookie parameters
    $self->sessions->cookie_name('session');
    $self->sessions->default_expiration(3600 * 24 * 30); # 30 Days

    # Global Hook: Disable caching for all responses to bypass Cloudflare/Proxy staleness.
    # This ensures absolute freshness for synchronized updates across all modules.
    $self->hook(before_dispatch => sub {
        my $c = shift;
        $c->res->headers->cache_control('no-store, no-cache, must-revalidate, max-age=0');
        $c->res->headers->header('Pragma' => 'no-cache');
        $c->res->headers->header('Expires' => '0');
    });
    
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

    # Helper: Check if current user is a Family Member (or Admin)
    # Parameters: None (Uses session)
    # Returns: Boolean (1 if family/admin, 0 otherwise)
    $self->helper(
        is_family => sub {
            my $c = shift;
            return 0 unless $c->session('user');
            my $username = $c->session('user');
            return 1 if $db->is_admin($username);
            return $db->is_family($username);
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
            my $permission = 'guest';
            if ($c->is_admin) {
                $permission = 'admin';
            } elsif ($c->is_family) {
                $permission = 'family';
            } elsif ($c->is_logged_in) {
                $permission = 'user';
            }
            return $c->db->get_menu_tree($permission);
        }
    );
    
    # Helper: Singleton Database Connection
    # Parameters: None
    # Returns: DB object instance
    $self->helper(db => sub { state $db = DB->new(app => $self); return $db });

    # Helper: Native Background Maintenance Runner
    # Parameters: None
    # Behavior: 
    #   Attempts to acquire a MariaDB global lock. If successful, executes 
    #   Timer, Reminder, and Meal Planner automation tasks.
    $self->helper(
        run_maintenance => sub {
            my $c = shift;

            my ($lock) = $c->db->{dbh}->selectrow_array("SELECT GET_LOCK('mojo_maintenance', 0)");
            return unless $lock;

            $c->app->log->info("Background maintenance: Lock acquired. Starting tasks...");

            eval {
                my $now = DateTime->now(time_zone => 'Australia/Melbourne');
                
                require MyApp::Controller::System;
                my $sys = MyApp::Controller::System->new(app => $c->app, tx => $c->tx);
                
                $sys->run_timer_maintenance();
                $sys->run_reminder_maintenance($now);
                $sys->run_meals_maintenance($now);
                my $emoji_stats = $sys->run_emoji_maintenance();
                if ($emoji_stats->{processed} > 0) {
                    $c->app->log->info(sprintf(
                        "Emoji Maintenance: Processed %d items (AI: %d, Dict: %d, Fallback: %d)",
                        $emoji_stats->{processed},
                        $emoji_stats->{ai_calls},
                        $emoji_stats->{dict_hits},
                        $emoji_stats->{fallback_hits}
                    ));
                }
            };

            if ($@) {
                $c->app->log->error("Background maintenance failed: $@");
            }

            $c->db->{dbh}->do("SELECT RELEASE_LOCK('mojo_maintenance')");
            $c->app->log->info("Background maintenance: Lock released.");
        }
    );

    # Start the Native Background Poller (Every 60 seconds)
    Mojo::IOLoop->recurring(60 => sub {
        my $loop = shift;
        # We use next_tick to ensure we have a fresh controller-like context if needed
        $self->run_maintenance();
    });

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

    # Family bridge nested under the auth bridge
    my $family = $auth->under(sub {
        my $c = shift;
        return 1 if $c->is_family;
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
    $r->get('/api/system/file_map')->to('root#file_map_json');
    $r->get('/api/menu/state')->to('menu#get_state');
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

    # --- Clipboard Routes ---
    $auth->get('/clipboard')->to('root#copy_get');
    $auth->get('/copy')->to('root#copy_get');
    $auth->get('/clipboard/api/state')->to('root#copy_api_state');
    $auth->post('/copy')->to('root#copy_post');
    $auth->post('/clipboard/update')->to('root#copy_update');
    $auth->post('/clipboard/delete')->to('root#remove_message');

    # --- User Management Routes ---
    $admin->get('/users')->to('admin#user_list');
    $admin->get('/users/api/state')->to('admin#api_state');
    $admin->post('/users/toggle_role')->to('admin#toggle_role');
    $admin->post('/users/delete/:id')->to('admin#delete_user');
    $admin->post('/users/approve/:id')->to('admin#approve_user');
    $admin->post('/users/update/:id')->to('admin#edit_user');

    # --- Reminders Administration Routes ---
    $family->get('/reminders')->to('reminders#index');
    $family->get('/reminders/api/state')->to('reminders#api_state');
    $family->post('/reminders/add')->to('reminders#add');
    $family->post('/reminders/update/:id')->to('reminders#update');
    $family->post('/reminders/delete/:id')->to('reminders#delete');
    $family->post('/reminders/toggle/:id')->to('reminders#toggle');
    $family->post('/reminders/toggle_day')->to('reminders#toggle_day');
    
    # --- Imposter Game Routes ---
    $family->get('/imposter')->to('imposter#index');
    $family->post('/imposter/add_player')->to('imposter#add_custom_player');
    $family->post('/imposter/edit_player')->to('imposter#edit_player');
    $family->post('/imposter/remove_player')->to('imposter#remove_player');
    $family->post('/imposter/clear_lobby')->to('imposter#clear_lobby');
    $family->post('/imposter/start')->to('imposter#start_game');
    $family->post('/imposter/toggle_view')->to('imposter#toggle_view');
    $family->post('/imposter/set_lang')->to('imposter#set_language');
    $family->post('/imposter/next_player')->to('imposter#next_player');
    $family->post('/imposter/end_game_early')->to('imposter#end_game_early');
    $family->post('/imposter/reveal')->to('imposter#reveal_results');
    $family->post('/imposter/play_again')->to('imposter#play_again');
    
    # --- Swear Jar Routes ---
    $family->get('/swear')->to('swear#index');
    $family->post('/swear/add')->to('swear#add_fine');
    $family->post('/swear/pay')->to('swear#pay_debt');
    $family->post('/swear/spend')->to('swear#spend');
    $family->post('/swear/member/add')->to('swear#add_member');
    $family->post('/swear/member/delete')->to('swear#delete_member');
    
    # --- Birthday Calendar Routes ---
    # --- Birthday Routes ---
    $family->get('/birthdays')->to('birthdays#index');
    $family->get('/birthdays/api/state')->to('birthdays#api_state');
    $admin->post('/birthdays/api/add')->to('birthdays#add');
    $admin->post('/birthdays/api/edit/:id')->to('birthdays#edit');
    $admin->post('/birthdays/api/delete/:id')->to('birthdays#delete');

    # --- Admin Settings Routes ---
    $admin->get('/settings')->to('settings#index');
    $admin->get('/settings/api/state')->to('settings#api_state');
    $admin->post('/settings/update')->to('settings#update');

    # --- File Management Routes ---
    $r->get('/files/serve/:id')->to('files#serve');
    $admin->get('/files')->to('files#index');
    $admin->post('/files')->to('files#upload'); 
    $admin->post('/files/delete/:id')->to('files#delete_file');
    $admin->post('/files/permissions/:id')->to('files#edit_permissions');

    # --- Shopping List Routes ---
    $family->get('/shopping')->to('shopping#index');
    $family->get('/shopping/api/state')->to('shopping#api_state');
    $family->post('/shopping/api/add')->to('shopping#add');
    $family->post('/shopping/api/toggle/:id')->to('shopping#toggle');
    $family->post('/shopping/api/delete/:id')->to('shopping#delete');
    $family->post('/shopping/api/clear')->to('shopping#clear_checked');
    $family->post('/shopping/api/edit/:id')->to('shopping#edit');

    # --- Todo List Routes ---
    $auth->get('/todo')->to('todo#index');
    $auth->get('/todo/api/state')->to('todo#api_state');
    $auth->post('/todo/api/add')->to('todo#add');
    $auth->post('/todo/api/toggle/:id')->to('todo#toggle');
    $auth->post('/todo/api/delete/:id')->to('todo#delete');
    $auth->post('/todo/api/edit/:id')->to('todo#edit');
    $auth->post('/todo/api/clear')->to('todo#clear_completed');

    # --- Google Cloud API Routes ---
    $auth->post('/api/tts/synthesize')->to('TTS#synthesize');
    $auth->post('/api/translate')->to('Translation#translate');

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
    $auth->post('/uno/start')->to('uno#start');
    $auth->post('/uno/play_card')->to('uno#play_card');
    $auth->post('/uno/draw_card')->to('uno#draw_card');
    $auth->post('/uno/shout')->to('uno#shout_uno');

    # --- Calendar Routes ---
    $family->get('/calendar')->to('calendar#index');
    $family->get('/calendar/events')->to('calendar#get_events');
    $family->post('/calendar/add')->to('calendar#add');
    $family->post('/calendar/edit')->to('calendar#edit');
    $family->post('/calendar/delete')->to('calendar#delete');
    $family->get('/calendar/manage')->to('calendar#manage');

    # --- Timer Routes ---
    $family->get('/timers')->to('timers#dashboard');
    $family->get('/timers/api/state')->to('timers#api_state');
    $family->post('/timers/api/start')->to('timers#start_timer');
    $family->post('/timers/api/stop')->to('timers#stop_timer');
    $family->post('/timers/api/pause')->to('timers#toggle_pause');
    
    $admin->get('/timers/manage')->to('timers#manage');
    $admin->get('/timers/api/manage/state')->to('timers#api_manage_state');
    $admin->post('/timers/api/create')->to('timers#create');
    $admin->post('/timers/api/update/:id')->to('timers#update');
    $admin->post('/timers/api/delete/:id')->to('timers#delete');
    $admin->post('/timers/api/bonus')->to('timers#grant_bonus');

    # --- Citizenship Quiz Routes ---
    $r->get('/quiz')->to('quiz#index');
    $r->get('/quiz/all')->to('quiz#index', mode => 'all');
    $r->get('/quiz/study')->to('quiz#study_mode');
    $r->get('/api/quiz/questions')->to('quiz#get_questions');

    # --- Go Links Routes ---
    $r->get('/g/:keyword')->to('go#resolve');
    $admin->get('/go')->to('go#index');
    $admin->get('/go/api/state')->to('go#api_state');
    $admin->post('/go/add')->to('go#add');
    $admin->post('/go/edit')->to('go#edit');
    $admin->post('/go/delete')->to('go#delete');

    # --- Receipts Management Routes ---
    $family->get('/receipts')->to('receipts#index');
    $family->get('/receipts/api/state')->to('receipts#api_state');
    $family->get('/api/receipts/list')->to('receipts#api_list');
    $family->post('/receipts/api/upload')->to('receipts#upload');
    $family->post('/receipts/api/update/:id')->to('receipts#update');
    $family->post('/receipts/api/delete/:id')->to('receipts#delete');
    $family->get('/receipts/serve/:id')->to('receipts#serve');
    $family->post('/receipts/api/crop/:id')->to('receipts#crop');
    $family->post('/receipts/api/ocr/:id')->to('receipts#trigger_ocr');
    $family->post('/receipts/api/ai_analyze/:id')->to('receipts#ai_analyze');

    # --- Medication Tracker Routes ---
    $family->get('/medication')->to('medication#index');
    $family->get('/medication/api/state')->to('medication#api_state');
    $family->post('/medication/api/add')->to('medication#add');
    $family->post('/medication/api/edit/:id')->to('medication#edit');
    $family->post('/medication/api/reset/:id')->to('medication#reset');
    $family->post('/medication/api/delete/:id')->to('medication#delete');

    # --- Meal Planner Routes ---
    $family->get('/meals')->to('meals#index');
    $family->get('/meals/api/state')->to('meals#api_state');
    $family->post('/meals/suggest')->to('meals#suggest');
    $family->post('/meals/vote')->to('meals#vote');
    $family->post('/meals/edit_suggestion')->to('meals#edit_suggestion');
    $family->post('/meals/delete_suggestion')->to('meals#delete_suggestion');
    $admin->post('/meals/admin/lock')->to('meals#admin_lock');
    $admin->get('/meals/api/vault')->to('meals#get_vault_data');
    $admin->post('/meals/api/vault/add')->to('meals#add_meal_to_vault');
    $admin->post('/meals/api/vault/update')->to('meals#update_meal_in_vault');
    $admin->post('/meals/api/vault/delete')->to('meals#delete_meal_from_vault');

    # --- Family Pulse AI Routes ---
    $family->get('/ai')->to('AI#index');
    $family->get('/ai/api/state')->to('AI#api_state');
    $family->post('/ai/api/chat')->to('AI#chat');
    $family->post('/ai/api/clear')->to('AI#clear');

    # --- Medication Registry Management (Admin Only) ---
    my $med_admin = $family->under(sub { shift->is_admin || 0 });
    $med_admin->post('/medication/api/manage/update/:id')->to('medication#update_registry');
    $med_admin->post('/medication/api/manage/delete/:id')->to('medication#delete_registry');

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