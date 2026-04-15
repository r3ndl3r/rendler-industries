# /lib/DB.pm

package DB;

use strict;
use warnings;
use DBI;
use File::Basename;
use File::Find;

# Central Database Handler and Module Loader.
# Features:
#   - Manages the primary DBI connection to MariaDB
#   - Handles connection settings via Environment Variables
#   - Provides connection health checks and auto-reconnect
#   - Dynamically loads helper modules (DB::*) to extend functionality
# Integration points:
#   - Relies on ENV{DB_USER}, ENV{DB_PASS}, etc.
#   - Serves as the base object for all DB::* helper packages

# Constructor: Initializes the database object and establishes connection.
# Parameters:
#   %args : Optional configuration overrides
# Returns:
#   Blessed DB object instance
sub new {
    my ($class, %args) = @_;
    
    my ($authDbUser, $authDbPass, $db_host);
    
    # Retrieve credentials from Environment Variables (Preferred)
    if ($ENV{DB_USER} && $ENV{DB_PASS}) {
        $authDbUser = $ENV{DB_USER};
        $authDbPass = $ENV{DB_PASS};
        $db_host = $ENV{DB_HOST} || 'localhost';
        print "Using environment variables for DB connection\n" if $ENV{DEBUG};
    } else {
        die "Database credentials not found. Set DB_USER/DB_PASS environment variables.";
    }
    
    my $db_name = $ENV{DB_NAME} || 'www';
    my $db_port = $ENV{DB_PORT} || '3306';
    
    # Construct Data Source Name (DSN) based on host configuration
    my $dsn;
    if ($db_host eq 'localhost' && $db_port eq '3306') {
        # Standard local socket connection
        $dsn = "DBI:MariaDB:$db_name:$db_host";
    } elsif ($db_host eq 'localhost') {
        # Localhost with custom port
        $dsn = "DBI:MariaDB:database=$db_name;host=$db_host;port=$db_port";
    } else {
        # Remote connection
        $dsn = "DBI:MariaDB:database=$db_name;host=$db_host;port=$db_port";
    }
    
    print "DSN: $dsn\n" if $ENV{DEBUG};
    
    my $self = bless {
        dsn => $dsn,
        dbUser => $authDbUser,
        dbPass => $authDbPass,
        timezone => $args{timezone} || 'UTC',
        %args
    }, $class;
    
    # Establish initial connection
    $self->connect();
    
    return $self;
}

# Establishes the physical database connection via DBI.
# Parameters: None
# Returns:
#   Void (Dies on failure)
sub connect {
    my ($self) = @_;
    
    # Connect with Error Raising enabled for safety
    $self->{dbh} = DBI->connect($self->{dsn}, $self->{dbUser}, $self->{dbPass}, {
        PrintError => 0,
        RaiseError => 1
    }) or die $DBI::errstr;

    # Ensure the session uses utf8mb4 for full emoji support
    $self->{dbh}->do("SET NAMES utf8mb4");
}

# Checks connection health and reconnects if necessary.
# Parameters: None
# Returns: Void
# Behavior:
#   - Executes a lightweight 'SELECT 1' to verify connectivity
#   - Automatically triggers connect() if the ping fails
sub ensure_connection {
    my ($self) = @_;
    
    # Attempt simple query to test connection
    eval {
        $self->{dbh}->do('SELECT 1');
    };
    
    # Reconnect if exception occurred (broken pipe/timeout)
    if ($@) {
        warn "Database connection lost, reconnecting: $@";
        $self->connect();
    }
}

# Dynamic Module Loader (Plugin System).
# Behavior:
#   - Recursively locates all .pm files under the 'DB/' subdirectory tree
#   - Converts each relative file path to a fully-qualified package name
#     (e.g. DB/Notifications/Logs.pm -> DB::Notifications::Logs)
#   - Dynamically imports them to inject helper methods into the DB namespace
BEGIN {
    # Root of the sub-module tree mirrors this file's basename without extension
    my $db_dir = __FILE__;
    $db_dir =~ s/\.pm$//;

    my @module_files;
    File::Find::find(
        sub { push @module_files, $File::Find::name if /\.pm$/ },
        $db_dir
    );

    foreach my $module_file (sort @module_files) {
        # Derive the package name from the path relative to the DB root
        (my $pkg = $module_file) =~ s{^\Q$db_dir/\E}{};
        $pkg =~ s/\.pm$//;
        $pkg =~ s{/}{::}g;
        # Import module, warning on failure but allowing execution to continue
        eval "use DB::$pkg; 1" or warn "Failed to load DB::$pkg: $@";
    }
}

1;