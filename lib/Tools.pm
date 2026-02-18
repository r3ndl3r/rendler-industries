# /lib/Tools.pm
package Tools;

use strict;
use warnings;
use DateTime;
use Exporter qw(import);

# Exportable helper functions.
# Note: 'rUp' was removed from export list as it is not defined in this module.
our @EXPORT = qw( howOld source );

# General Utility Module.
# Features:
#   - Date/Time calculations (Age from DOB)
#   - File system reading helpers
# Integration points:
#   - Used by Root.pm for dashboard stats
#   - Depends on DateTime for timezone-aware calculations

# Calculates the elapsed time since a specific date (Age).
# Parameters:
#   string : Date string in format "DD/MM/YYYY HH:MM:SS"
# Returns:
#   List containing:
#     1. Formatted string (e.g., "5 years, 2 months and 3 days")
#     2. Total seconds elapsed (Epoch delta)
# Note:
#   - Hardcoded to compare against 'Australia/Melbourne' timezone
sub howOld {
    # Parse input string "DD/MM/YYYY HH:MM:SS"
    my ($date, $time) = split ' ', shift;
    my ($hh, $mm, $ss) = split ':', $time;
    my ($d, $m, $y)    = split '/', $date;

    # Construct DateTime object for origin date
    my $dob = DateTime->new(
        year   => $y,
        month  => $m,
        day    => $d,
        hour   => $hh,
        minute => $mm,
        second => $ss,
    );
    
    # Get current time in local timezone
    my $now = DateTime->now(time_zone => 'Australia/Melbourne');

    # Calculate duration (Years/Months/Days logic)
    my $dur = $now->delta_md($dob);

    my $years  = int($dur->delta_months / 12);
    my $months = $dur->delta_months % 12;
    my $days   = $dur->delta_days;

    # Build human-readable output string
    my @age = "$years years";

    # Append months if applicable
    if ($days >= 1 and $months > 0) {
        push @age, sprintf ", %i %s ", $months, ($months >= 2  ? 'months' : 'month');
    } elsif (!$days and $months > 0) {
        push @age, sprintf " and %i %s ", $months, ($months >= 2  ? 'months' : 'month');
    }

    # Append days if applicable
    if ($days > 0) {
        push @age, sprintf " and %i %s", $days, ($days >= 2  ? 'days' : 'day');
    }

    # Return formatted string and raw epoch difference
    return join('', @age), ($now->epoch - $dob->epoch);
}

# Reads the raw content of a file.
# Parameters:
#   file : System path to the file
# Returns:
#   String containing file content, or error string on failure
# Security Warning:
#   - Does not validate path traversal. Ensure input is sanitized before calling.
sub source {
    my $file = shift;
    my $text;

    # Validate file existence
    unless (-f $file) {
        return "Error: File not found.";
    }

    # Slurp file content
    open FH, $file or return "Error: $!";
    $text .= $_ while <FH>;
    close FH;

    return $text;
}

1;