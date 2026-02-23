# /lib/Tools.pm
package Tools;

use strict;
use warnings;
use utf8;
use DateTime;
use Exporter qw(import);

# Exportable helper functions.
our @EXPORT = qw( howOld source get_zodiac_emoji get_chinese_zodiac_emoji );

# General Utility Module.
# Features:
#   - Date/Time calculations (Age from DOB)
#   - File system reading helpers
#   - Zodiac and Chinese Zodiac emoji detection
# Integration points:
#   - Used by Root.pm and Birthdays.pm
#   - Depends on DateTime for precise date arithmetic

# Returns the Astrological (Western) Zodiac emoji for a given month and day.
sub get_zodiac_emoji {
    my ($month, $day) = @_;
    
    my ($icon, $label);
    if (($month == 1  && $day <= 19) || ($month == 12 && $day >= 22)) { $icon = "♑"; $label = "Capricorn"; }
    elsif (($month == 1  && $day >= 20) || ($month == 2  && $day <= 18)) { $icon = "♒"; $label = "Aquarius"; }
    elsif (($month == 2  && $day >= 19) || ($month == 3  && $day <= 20)) { $icon = "♓"; $label = "Pisces"; }
    elsif (($month == 3  && $day >= 21) || ($month == 4  && $day <= 19)) { $icon = "♈"; $label = "Aries"; }
    elsif (($month == 4  && $day >= 20) || ($month == 5  && $day <= 20)) { $icon = "♉"; $label = "Taurus"; }
    elsif (($month == 5  && $day >= 21) || ($month == 6  && $day <= 20)) { $icon = "♊"; $label = "Gemini"; }
    elsif (($month == 6  && $day >= 21) || ($month == 7  && $day <= 22)) { $icon = "♋"; $label = "Cancer"; }
    elsif (($month == 7  && $day >= 23) || ($month == 8  && $day <= 22)) { $icon = "♌"; $label = "Leo"; }
    elsif (($month == 8  && $day >= 23) || ($month == 9  && $day <= 22)) { $icon = "♍"; $label = "Virgo"; }
    elsif (($month == 9  && $day >= 23) || ($month == 10 && $day <= 22)) { $icon = "♎"; $label = "Libra"; }
    elsif (($month == 10 && $day >= 23) || ($month == 11 && $day <= 21)) { $icon = "♏"; $label = "Scorpio"; }
    elsif (($month == 11 && $day >= 22) || ($month == 12 && $day <= 21)) { $icon = "♐"; $label = "Sagittarius"; }
    else { $icon = "✨"; $label = "Zodiac"; }

    return qq{<span title="$label">$icon</span>};
}

# Returns the Chinese Zodiac emoji for a given year.
sub get_chinese_zodiac_emoji {
    my ($year) = @_;
    
    # 12-year cycle starting with Monkey (year % 12 == 0)
    my @zodiacs = (
        { icon => "🐒", label => "Year of the Monkey" },
        { icon => "🐓", label => "Year of the Rooster" },
        { icon => "🐕", label => "Year of the Dog" },
        { icon => "🐖", label => "Year of the Pig" },
        { icon => "🐀", label => "Year of the Rat" },
        { icon => "🐂", label => "Year of the Ox" },
        { icon => "🐅", label => "Year of the Tiger" },
        { icon => "🐇", label => "Year of the Rabbit" },
        { icon => "🐉", label => "Year of the Dragon" },
        { icon => "🐍", label => "Year of the Snake" },
        { icon => "🐎", label => "Year of the Horse" },
        { icon => "🐐", label => "Year of the Goat" },
    );
    
    my $z = $zodiacs[$year % 12];
    return qq{<span title="$z->{label}">$z->{icon}</span>};
}

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