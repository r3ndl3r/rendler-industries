# /lib/MyApp/Plugin/Helpers.pm

package MyApp::Plugin::Helpers;

use utf8;
use Mojo::Base 'Mojolicious::Plugin';
use DB;
use Path::Iterator::Rule;
use DateTime;

sub register {
    my (undef, $self) = @_;

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

    # Helper: Check if current user is a Family Member (or Admin/Parent/Child)
    # Parameters: None (Uses session)
    # Returns: Boolean (1 if family/admin/parent/child, 0 otherwise)
    $self->helper(
        is_family => sub {
            my $c = shift;
            return 0 unless $c->session('user');
            my $username = $c->session('user');
            return 1 if $c->db->is_admin($username);
            return 1 if $c->db->is_parent($username);
            return 1 if $c->db->is_child($username);
            return $c->db->is_family($username);
        }
    );

    # Helper: Check if current user has Parent privileges (Admin or Parent)
    # Parameters: None (Uses session)
    # Returns: Boolean (1 if admin/parent, 0 otherwise)
    $self->helper(
        is_parent => sub {
            my $c = shift;
            return 0 unless $c->session('user');
            my $username = $c->session('user');
            return 1 if $c->db->is_admin($username);
            return $c->db->is_parent($username);
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
            return if defined($c->app->config('maintenance')) && $c->app->config('maintenance') == 0;

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
                $sys->run_notes_lock_maintenance();
                $sys->run_weather_maintenance($now);
                $sys->run_brief_notification($now);
                $sys->cleanup_stale_uno_sessions();
                $sys->run_notification_queue();

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
}

1;
