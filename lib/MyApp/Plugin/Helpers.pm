# /lib/MyApp/Plugin/Helpers.pm

package MyApp::Plugin::Helpers;

use utf8;
use Mojo::Base 'Mojolicious::Plugin';
use DB;
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
            return $c->db->add_user_points($user_id, $amount, $reason, $c->current_user_id);
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
            } elsif ($c->is_parent) {
                $permission = 'parent';
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

            eval {
                my $now   = $c->now;
                my $epoch = time();
                my $tasks = $c->db->get_maintenance_task_configs();

                require MyApp::Controller::System;
                my $sys = MyApp::Controller::System->new(app => $c->app, tx => $c->tx);

                my @async_promises;
                my $ran = 0;
                my $skipped = 0;

                my @normal_tasks   = grep { !$_->{run_last} } @$tasks;
                my @deferred_tasks = grep {  $_->{run_last} } @$tasks;
                my $enabled_count  = grep { $_->{is_enabled} } @$tasks;

                my $run_task = sub {
                    my $task = shift;
                    if ($task->{last_run_epoch}
                        && ($epoch - $task->{last_run_epoch}) < ($task->{interval_minutes} * 60)) {
                        $skipped++;
                        return;
                    }
                    my $fn   = $task->{function_name};
                    my $name = $task->{name};
                    if ($task->{is_async}) {
                        $c->db->mark_maintenance_task_ran($name);
                        push @async_promises, $sys->$fn($now)->catch(sub {
                            $c->log->error("Async task [$name] failed: $_[0]");
                        });
                        $ran++;
                    } else {
                        eval { $sys->$fn($now) };
                        if ($@) { $c->log->error("Maintenance task [$name] failed: $@"); }
                        else     { $c->db->mark_maintenance_task_ran($name); $ran++; }
                    }
                };

                foreach my $task (@normal_tasks) {
                    next unless $task->{is_enabled};
                    $run_task->($task);
                }
                foreach my $task (@deferred_tasks) {
                    next unless $task->{is_enabled};
                    $run_task->($task);
                }

                $c->log->info(sprintf(
                    "Background maintenance: ran %d/%d tasks%s.",
                    $ran, $enabled_count,
                    $skipped ? " ($skipped skipped)" : ''
                ));

                if (@async_promises) {
                    Mojo::Promise->all(@async_promises)->finally(sub {
                        $c->db->{dbh}->do("SELECT RELEASE_LOCK('mojo_maintenance')");
                        $c->log->info("Background maintenance: Lock released.");
                    });
                } else {
                    $c->db->{dbh}->do("SELECT RELEASE_LOCK('mojo_maintenance')");
                    $c->log->info("Background maintenance: Lock released.");
                }
            };

            if ($@) {
                $c->log->error("Background maintenance critical failure: $@");
                $c->db->{dbh}->do("SELECT RELEASE_LOCK('mojo_maintenance')");
            }
        }
    );
}

1;
