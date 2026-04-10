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
            return $c->db->is_admin($c->session('user'));
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
            return 1 if $c->db->is_admin($username);
            return 1 if $c->db->is_child($username);
            return $c->db->is_family($username);
        }
    );
    
    # Helper: Get Current User ID from session
    # Parameters: None (Uses session)
    # Returns: Boolean (1 if child, 0 otherwise)
    $self->helper(
        is_child => sub {
            my $c = shift;
            return 0 unless $c->session('user');
            return $c->db->is_child($c->session('user'));
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

    # Helper: Globally retrieve point balance from ledger
    $self->helper(
        get_points => sub {
            my ($c, $user_id) = @_;
            return $c->db->get_user_points($user_id);
        }
    );

    # Helper: Globally apply points to ledger
    $self->helper(
        add_points => sub {
            my ($c, $user_id, $amount, $reason) = @_;
            return $c->db->add_user_points($user_id, $amount, $reason);
        }
    );

    # Helper: Centralized DateTime factory
    # Returns: DateTime object localized to the system timezone
    $self->helper(
        now => sub {
            my $c = shift;
            my $tz = $c->app->config->{timezone} || 'UTC';
            return DateTime->now(time_zone => $tz);
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
            } elsif ($c->is_child) {
                $permission = 'child';
            } elsif ($c->is_family) {
                $permission = 'family';
            } elsif ($c->is_logged_in) {
                $permission = 'user';
            }
            return $c->db->get_menu_tree($permission);
        }
    );
    
    # Helper: Singleton Database Connection with Reconnection logic
    # Parameters: None
    # Returns: DB object instance
    $self->helper(db => sub {
        my $tz = $self->config->{timezone} || 'UTC';
        state $db = DB->new(app => $self, timezone => $tz);
        # Check if handle is still alive, reconnect if needed
        unless ($db->{dbh} && $db->{dbh}->ping) {
            $self->app->log->info("Database connection lost. Reconnecting...");
            $db = DB->new(app => $self, timezone => $tz);
        }
        return $db;
    });
    # Helper: Native Background Maintenance Runner
    # Parameters: None
    # Behavior:
    #   Attempts to acquire a MariaDB global lock. If successful, executes
    #   Timer, Reminder, and Meal Planner automation tasks.
    $self->helper(
        run_maintenance => sub {
            my $c = shift;

            # Level 1: Simultaneous Execution Lock (Session-based)
            my ($lock) = $c->db->{dbh}->selectrow_array("SELECT GET_LOCK('mojo_maintenance', 0)");
            return unless $lock;

            # Level 2: Sequential/Minute Lock (Timestamp-based)
            # Ensures the task runs exactly once per minute across all workers
            my $epoch_min = int(time / 60);
            return unless $c->db->try_acquire_maintenance_lock($epoch_min);

            $c->log->info("Background maintenance: Lock acquired. Starting tasks...");

            eval {
                my $now = $c->now;

                require MyApp::Controller::System;
                my $sys = MyApp::Controller::System->new(app => $c->app, tx => $c->tx);

                $sys->run_timer_maintenance();
                $sys->run_reminder_maintenance($now);
                $sys->run_calendar_notifications($now);
                $sys->run_meals_maintenance($now);
                $sys->run_room_reminders($now);
                $sys->run_chore_reminders($now);
                $sys->run_weather_maintenance($now);

                # Nightly Normalization Gate (3:00 AM)
                if ($now->hour == 3 && $now->minute == 0) {
                    $sys->run_notes_znorm_maintenance();
                }

                # Asynchronous Emoji Task: Correct lock release chain
                $sys->run_emoji_maintenance_p()->then(sub {
                    my $emoji_stats = shift;
                    if ($emoji_stats->{processed} > 0) {
                        $c->log->info(sprintf(
                            "Emoji Maintenance: Processed %d items (AI Hits: %d, Dict Hits: %d). System sync complete.",
                            $emoji_stats->{processed},
                            $emoji_stats->{ai_hits} // 0,
                            $emoji_stats->{dict_hits} // 0
                        ));
                    } else {
                        $c->log->debug("Emoji Maintenance: No new items found this cycle.");
                    }
                })->catch(sub {
                    my $err = shift;
                    $c->log->error("Emoji Maintenance Failed: $err");
                })->finally(sub {
                    # RELEASE LOCK only after the async part is fully done or failed
                    $c->db->{dbh}->do("SELECT RELEASE_LOCK('mojo_maintenance')");
                    $c->log->info("Background maintenance: Lock released.");
                });
            };

            if ($@) {
                $c->log->error("Background maintenance critical failure: $@");
                $c->db->{dbh}->do("SELECT RELEASE_LOCK('mojo_maintenance')");
            }
        }
    );

    # Start the Native Background Poller
    # 1. Trigger immediate first run
    Mojo::IOLoop->next_tick(sub { $self->run_maintenance() });

    # 2. Schedule recurring runs (Every 60 seconds)
    Mojo::IOLoop->recurring(60 => sub {
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
    $r->get('/api/user_icons')->to('root#api_user_icons');
    $r->get('/system/api/file_map')->to('root#file_map_json');
    $r->get('/quick')->to('root#quick');
    $auth->get('/chelsea')->to('chelsea#index');
    $admin->get('/restart')->to('system#restart');

    # --- Menu Management Routes ---
    $admin->get('/menu')->to('menu#manage');
    $admin->get('/menu/api/state')->to('menu#api_state');
    $admin->post('/menu/api/add')->to('menu#api_add');
    $admin->post('/menu/api/update')->to('menu#api_update');
    $admin->post('/menu/api/delete')->to('menu#api_delete');
    $admin->post('/menu/api/reorder')->to('menu#api_reorder');
    $r->get('/menu/api/menubar')->to('menu#get_state');
    
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
    $admin->post('/users/api/add')->to('admin#api_user_add');
    $admin->post('/users/toggle_role')->to('admin#toggle_role');
    $admin->post('/users/delete/:id')->to('admin#delete_user');
    $admin->post('/users/approve/:id')->to('admin#approve_user');
    $admin->post('/users/update/:id')->to('admin#edit_user');

    # --- Notification History Routes ---
    $admin->get('/notifications')->to('notifications#index');
    $admin->get('/notifications/api/state')->to('notifications#api_state');
    $admin->post('/notifications/api/delete/:id')->to('notifications#api_delete');
    $admin->post('/notifications/api/prune')->to('notifications#api_prune');

    # --- Reminders Administration Routes ---
    $family->get('/reminders')->to('reminders#index');
    $family->get('/reminders/api/state')->to('reminders#api_state');
    $family->post('/reminders/api/add')->to('reminders#api_add');
    $family->post('/reminders/api/update/:id')->to('reminders#api_update');
    $family->post('/reminders/api/delete/:id')->to('reminders#api_delete');
    $family->post('/reminders/api/toggle/:id')->to('reminders#api_toggle');
    $family->post('/reminders/api/toggle_day')->to('reminders#api_toggle_day');
    
    # --- Imposter Game Routes ---
    $family->get('/imposter')->to('imposter#index');
    $family->get('/imposter/api/state')->to('imposter#api_state');
    $family->post('/imposter/api/add_player')->to('imposter#api_add_player');
    $family->post('/imposter/api/edit_player')->to('imposter#api_edit_player');
    $family->post('/imposter/api/remove_player')->to('imposter#api_remove_player');
    $family->post('/imposter/api/clear_lobby')->to('imposter#api_reset');
    $family->post('/imposter/api/start')->to('imposter#api_start');
    $family->post('/imposter/api/toggle_view')->to('imposter#api_toggle_view');
    $family->post('/imposter/api/set_lang')->to('imposter#api_set_lang');
    $family->post('/imposter/api/next_player')->to('imposter#api_next_player');
    $family->post('/imposter/api/end_game_early')->to('imposter#api_end_early');
    $family->post('/imposter/api/reveal')->to('imposter#api_reveal');
    $family->post('/imposter/api/play_again')->to('imposter#api_reset');
    
    # --- Swear Jar Routes ---
    $family->get('/swear')->to('swear#index');
    $family->get('/swear/api/state')->to('swear#api_state');
    $family->post('/swear/api/add')->to('swear#add_fine');
    $family->post('/swear/api/pay')->to('swear#pay_debt');
    $family->post('/swear/api/spend')->to('swear#spend');
    $family->post('/swear/api/member/add')->to('swear#add_member');
    $family->post('/swear/api/member/delete')->to('swear#delete_member');
    
    # --- Birthday Calendar Routes ---
    $family->get('/birthdays')->to('birthdays#index');
    $family->get('/birthdays/api/state')->to('birthdays#api_state');
    $admin->post('/birthdays/api/add')->to('birthdays#api_add');
    $admin->post('/birthdays/api/edit/:id')->to('birthdays#api_edit');
    $admin->post('/birthdays/api/delete/:id')->to('birthdays#api_delete');

    # --- Admin Settings Routes ---
    $admin->get('/settings')->to('settings#index');
    $admin->get('/settings/api/state')->to('settings#api_state');
    $admin->post('/settings/update')->to('settings#update');

    # --- Points Management Routes ---
    $admin->get('/points')->to('points#index');
    $admin->get('/points/api/state')->to('points#api_state');
    $admin->post('/points/api/add')->to('points#api_add');

    # --- Emoji Management Routes ---
    $admin->get('/emojis')->to('emoji#index');
    $admin->get('/emojis/api/state')->to('emoji#api_state');
    $admin->get('/emojis/api/list')->to('emoji#api_list');
    $admin->post('/emojis/api/update')->to('emoji#api_update');
    $admin->post('/emojis/api/delete')->to('emoji#api_delete');
    $admin->post('/emojis/api/test')->to('emoji#api_test');

    # --- File Management Routes ---
    $r->get('/files/serve/:id')->to('files#serve');
    $admin->get('/files')->to('files#index');
    $admin->get('/files/api/state')->to('files#api_state');
    $admin->post('/files/api/upload')->to('files#api_upload');
    $admin->post('/files/api/delete/:id')->to('files#api_delete');
    $admin->post('/files/api/permissions/:id')->to('files#api_permissions');
    # --- Shopping List Routes ---
    $family->get('/shopping')->to('shopping#index');
    $family->get('/shopping/api/state')->to('shopping#api_state');
    $family->post('/shopping/api/add')->to('shopping#api_add');
    $family->post('/shopping/api/toggle/:id')->to('shopping#api_toggle');
    $family->post('/shopping/api/delete/:id')->to('shopping#api_delete');
    $family->post('/shopping/api/clear')->to('shopping#api_clear');
    $family->post('/shopping/api/edit/:id')->to('shopping#api_edit');

    # --- Todo List Routes ---
    $auth->get('/todo')->to('todo#index');
    $auth->get('/todo/api/state')->to('todo#api_state');
    $auth->post('/todo/api/add')->to('todo#api_add');
    $auth->post('/todo/api/toggle/:id')->to('todo#api_toggle');
    $auth->post('/todo/api/delete/:id')->to('todo#api_delete');
    $auth->post('/todo/api/edit/:id')->to('todo#api_edit');
    $auth->post('/todo/api/clear')->to('todo#api_clear');

    # --- Google Cloud API Routes ---
    $auth->post('/tts/api/synthesize')->to('TTS#synthesize');
    $auth->post('/translation/api/translate')->to('Translation#translate');

    # --- Connect 4 Routes ---
    $auth->get('/connect4')->to('connect4#index');
    $auth->get('/connect4/play/:id')->to('connect4#index');
    $auth->get('/connect4/api/lobby')->to('connect4#api_lobby');
    $auth->post('/connect4/api/create')->to('connect4#api_create');
    $auth->post('/connect4/api/join')->to('connect4#api_join');
    $auth->get('/connect4/api/game/:id')->to('connect4#api_game');
    $auth->post('/connect4/api/move')->to('connect4#api_move');
    $auth->post('/connect4/api/restart')->to('connect4#api_restart');

    # --- UNO Routes ---
    $auth->get('/uno')->to('uno#index');
    $auth->get('/uno/play/:id')->to('uno#index');
    $auth->get('/uno/api/lobby')->to('uno#api_lobby');
    $auth->post('/uno/api/create')->to('uno#api_create');
    $auth->post('/uno/api/join')->to('uno#api_join');
    $auth->get('/uno/api/game/:id')->to('uno#api_game');
    $auth->post('/uno/api/ready')->to('uno#api_ready');
    $auth->post('/uno/api/start')->to('uno#api_start');
    $auth->post('/uno/api/play_card')->to('uno#api_play_card');
    $auth->post('/uno/api/draw_card')->to('uno#api_draw_card');
    $auth->post('/uno/api/shout')->to('uno#api_shout');

    # --- Calendar Routes ---
    $family->get('/calendar')->to('calendar#index');
    $family->get('/calendar/api/state')->to('calendar#api_state');
    $family->get('/calendar/api/events')->to('calendar#api_events');
    $family->post('/calendar/api/add')->to('calendar#api_add');
    $family->post('/calendar/api/edit')->to('calendar#api_edit');
    $family->post('/calendar/api/delete')->to('calendar#api_delete');
    $family->get('/calendar/manage')->to('calendar#manage');

    # --- Timer Routes ---
    $family->get('/timers')->to('timers#dashboard');
    $family->get('/timers/api/state')->to('timers#api_state');
    $family->post('/timers/api/start')->to('timers#start_timer');
    $family->post('/timers/api/stop')->to('timers#stop_timer');
    $family->post('/timers/api/pause')->to('timers#toggle_pause');
    $family->post('/timers/api/redeem')->to('timers#api_redeem');
    $family->post('/timers/api/transfer')->to('timers#api_transfer');
    
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
    $r->get('/quiz/api/questions')->to('quiz#get_questions');

    # --- Go Links Routes ---
    $r->get('/g/:keyword')->to('go#resolve');
    $admin->get('/go')->to('go#index');
    $admin->get('/go/api/state')->to('go#api_state');
    $admin->post('/go/api/add')->to('go#api_add');
    $admin->post('/go/api/edit')->to('go#api_edit');
    $admin->post('/go/api/delete')->to('go#api_delete');

    # --- Receipts Management Routes ---
    $family->get('/receipts')->to('receipts#index');
    $family->get('/receipts/api/state')->to('receipts#api_state');
    $family->get('/receipts/api/list')->to('receipts#api_list');
    $family->post('/receipts/api/upload')->to('receipts#upload');
    $family->post('/receipts/api/update/:id')->to('receipts#api_update');
    $family->post('/receipts/api/delete/:id')->to('receipts#api_delete');
    $family->get('/receipts/serve/:id')->to('receipts#serve');
    $family->post('/receipts/api/crop/:id')->to('receipts#api_crop');
    $family->post('/receipts/api/ocr/:id')->to('receipts#api_ocr');
    $family->post('/receipts/api/ai_analyze/:id')->to('receipts#api_ai_analyze');

    # --- Notes Whiteboard Routes ---
    $auth->get('/notes')->to('notes#index');
    $auth->get('/notes/api/state')->to('notes#api_state');
    $auth->get('/notes/api/search')->to('notes#api_search');
    $auth->post('/notes/api/save')->to('notes#api_save');
    $auth->post('/notes/api/geometry')->to('notes#api_save_geometry');
    $auth->post('/notes/api/delete')->to('notes#api_delete');
    $auth->post('/notes/api/upload')->to('notes#api_upload');
    $auth->post('/notes/api/viewport')->to('notes#api_save_viewport');
    $auth->get('/notes/serve/:note_id')->to('notes#serve_blob');
    $auth->get('/notes/attachment/serve/:blob_id')->to('notes#serve_attachment_blob');
    
    # Multi-Canvas & Collaborative Switching
    $auth->post('/notes/api/canvases/create')->to('notes#api_canvas_create');
    $auth->post('/notes/api/canvases/delete')->to('notes#api_canvas_delete');
    $auth->post('/notes/api/canvases/rename')->to('notes#api_canvas_rename');
    $auth->post('/notes/api/canvases/reorder')->to('notes#api_canvas_reorder');
    $auth->post('/notes/api/canvases/share')->to('notes#api_canvas_share');
    $auth->get('/notes/api/users/search')->to('notes#api_user_search');
    $auth->post('/notes/api/notes/copy')->to('notes#api_copy_note');
    $auth->get('/notes/api/bin')->to('notes#api_bin');
    $auth->post('/notes/api/restore')->to('notes#api_restore');
    $auth->post('/notes/api/purge')->to('notes#api_purge');
    $auth->post('/notes/api/attachment/delete')->to('notes#api_attachment_delete');
    $auth->post('/notes/api/attachment/rename')->to('notes#api_attachment_rename');
    $auth->post('/notes/api/layer/rename')->to('notes#api_layer_rename');
    $auth->post('/notes/api/layers/move')->to('notes#api_move_layer');

    # Real-Time Synchronization 
    # Mutation Heartbeat for cross-session/cross-worker consistency
    $auth->get('/notes/api/heartbeat/:canvas_id')->to('notes#api_heartbeat');

    # --- Room Tracker Routes ---
    $family->get('/room')->to('room#index');
    $family->get('/room/api/state')->to('room#api_state');
    $family->post('/room/api/upload')->to('room#api_upload');
    $family->get('/room/serve/:id')->to('room#serve');
    $admin->post('/room/api/update_status')->to('room#api_update_status');
    $family->post('/room/api/delete/:id')->to('room#api_delete');
    $admin->post('/room/api/save_config')->to('room#api_save_config');
    $admin->post('/room/api/trim')->to('room#api_trim');
    $admin->post('/room/api/add_blackout')->to('room#api_add_blackout');
    $admin->post('/room/api/delete_blackout')->to('room#api_delete_blackout');

    # --- Medication Tracker Routes ---
    $family->get('/medication')->to('medication#index');
    $family->get('/medication/api/state')->to('medication#api_state');
    $family->post('/medication/api/add')->to('medication#add');
    $family->post('/medication/api/edit/:id')->to('medication#edit');
    $family->post('/medication/api/reset/:id')->to('medication#reset');
    $family->post('/medication/api/delete/:id')->to('medication#delete');
    $admin->post('/medication/api/manage/update/:id')->to('medication#update_registry');
    $admin->post('/medication/api/manage/delete/:id')->to('medication#delete_registry');

    # --- Meal Planner Routes ---
    $family->get('/meals')->to('meals#index');
    $family->get('/meals/api/state')->to('meals#api_state');
    $family->post('/meals/api/suggest')->to('meals#api_suggest');
    $family->post('/meals/api/vote')->to('meals#api_vote');
    $family->post('/meals/api/edit_suggestion')->to('meals#api_edit_suggestion');
    $family->post('/meals/api/delete_suggestion')->to('meals#api_delete_suggestion');
    $admin->post('/meals/api/admin/lock')->to('meals#api_admin_lock');
    $admin->get('/meals/api/vault')->to('meals#api_get_vault_data');
    $admin->post('/meals/api/vault/add')->to('meals#api_add_meal_to_vault');
    $admin->post('/meals/api/vault/update')->to('meals#api_update_meal_in_vault');
    $admin->post('/meals/api/vault/delete')->to('meals#api_delete_meal_from_vault');

    # --- Broadcast Routes ---
    $family->get('/broadcast')->to('broadcast#index');
    $family->post('/broadcast/api/send')->to('broadcast#api_send');

    # --- Family Pulse AI Routes ---
    $family->get('/ai')->to('AI#index');
    $family->get('/ai/api/state')->to('AI#api_state');
    $family->post('/ai/api/chat')->to('AI#chat');
    $family->post('/ai/api/clear')->to('AI#clear');

    # --- Chess Routes ---
    $auth->get('/chess')->to('chess#index');
    $auth->get('/chess/play/:id')->to('chess#index');
    $auth->get('/chess/api/lobby')->to('chess#api_lobby');
    $auth->post('/chess/api/create')->to('chess#api_create');
    $auth->post('/chess/api/join')->to('chess#api_join');
    $auth->get('/chess/api/game/:id')->to('chess#api_game');
    $auth->post('/chess/api/move')->to('chess#api_move');
    $auth->post('/chess/api/offer_draw/:id')->to('chess#api_offer_draw');
    $auth->post('/chess/api/respond_draw/:id')->to('chess#api_respond_draw');

    # --- Chores Modules Routes ---
    $family->get('/chores')->to('chores#index');
    $family->get('/chores/api/state')->to('chores#api_state');
    $family->post('/chores/api/complete')->to('chores#api_complete');
    $admin->post('/chores/api/add')->to('chores#api_add');
    $admin->post('/chores/api/revoke')->to('chores#api_revoke');
    $admin->post('/chores/api/delete')->to('chores#api_delete');

    # --- Weather Board Routes ---
    $auth->get('/weather')->to('weather#index');
    $auth->post('/weather/api/state')->to('weather#api_state');
    $admin->post('/weather/api/geocode')->to('weather#api_geocode');
    $admin->post('/weather/api/add')->to('weather#api_add');
    $admin->post('/weather/api/update/:id')->to('weather#api_update');
    $admin->post('/weather/api/delete/:id')->to('weather#api_delete');
    $admin->post('/weather/api/reorder')->to('weather#api_reorder');
}

1;
