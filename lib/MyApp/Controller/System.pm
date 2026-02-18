# /lib/MyApp/Controller/System.pm

package MyApp::Controller::System;
use Mojo::Base 'Mojolicious::Controller';

# Controller for System-level operations and maintenance.
# Features:
#   - Service lifecycle management (Hot Restart)
# Integration points:
#   - Restricted to Admin-level users via `is_admin` helper
#   - Interacts directly with the operating system shell
#   - Controls the Hypnotoad application server process

# Initiates a hot restart of the application server.
# Route: POST /system/restart (or GET depending on router config)
# Parameters: None
# Returns:
#   Text confirmation if command initiated successfully
#   HTTP 500 if the system process fork fails
# Behavior:
#   - Forks a background process to avoid blocking the HTTP response
#   - Executes 'hypnotoad -s' (hot deployment) followed by a start command
#   - Changes working directory to app home to ensure relative paths resolve
sub restart {
    my $c = shift;
    
    # Enforce Admin Access Control
    return $c->redirect_to('/noperm') unless $c->is_admin;
    
    # Fork a child process to handle the blocking system command
    my $pid = fork();
    my $base_path = $c->app->home; 

    if ($pid == 0) {
        # Child Process: Execute shell command sequence
        # 1. Navigate to app root
        # 2. Hot deploy/Stop (-s)
        # 3. Start fresh instance
        my $cmd = "cd $base_path && hypnotoad -s mojo.pl && hypnotoad mojo.pl";

        exec('sh', '-c', $cmd) or die "Failed to execute shell command: $!";
    } elsif ($pid > 0) {
        # Parent Process: Return immediate success response to user
        $c->render(text => 'Service restart command initiated.');
    } else {
        # Handle Fork Failure
        $c->render(text => 'Failed to initiate restart command.', status => 500);
    }
}

1;