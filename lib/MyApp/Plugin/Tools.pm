# /lib/MyApp/Plugin/Tools.pm

package MyApp::Plugin::Tools;

use Mojo::Base 'Mojolicious::Plugin';
use DateTime;
use strict;
use warnings;
use utf8;

# General Utility Plugin.
# Features:
#   - Date/Time calculations (Age from DOB)
#   - File system reading helpers
#   - Zodiac and Chinese Zodiac emoji detection
#
# Integration points:
#   - Registers global helpers in the Mojolicious app.
#   - Replaces the legacy lib/Tools.pm standalone module.

sub register {
    my ($self, $app, $config) = @_;

    # --- Western Zodiac Emoji ---
    $app->helper(zodiac_emoji => sub {
        my ($c, $month, $day) = @_;
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
        elsif (($month == 9  && $day >= 23) || ($month == 10 && $day <= 22)) { $icon = "Libra"; $icon = "♎"; }
        elsif (($month == 10 && $day >= 23) || ($month == 11 && $day <= 21)) { $icon = "♏"; $label = "Scorpio"; }
        elsif (($month == 11 && $day >= 22) || ($month == 12 && $day <= 21)) { $icon = "♐"; $label = "Sagittarius"; }
        else { $icon = "✨"; $label = "Zodiac"; }

        return qq{<span title="$label">$icon</span>};
    });

    # --- Chinese Zodiac Emoji ---
    $app->helper(chinese_zodiac_emoji => sub {
        my ($c, $year) = @_;
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
    });

    # --- Age Calculator (howOld) ---
    $app->helper(how_old => sub {
        my ($c, $date_str) = @_;
        my ($date, $time) = split ' ', $date_str;
        my ($hh, $mm, $ss) = split ':', $time;
        my ($d, $m, $y)    = split '/', $date;

        my $dob = DateTime->new(
            year => $y, month => $m, day => $d,
            hour => $hh, minute => $mm, second => $ss
        );
        my $now = DateTime->now(time_zone => 'Australia/Melbourne');
        my $dur = $now->delta_md($dob);

        my $years  = int($dur->delta_months / 12);
        my $months = $dur->delta_months % 12;
        my $days   = $dur->delta_days;

        my @age = "$years years";
        if ($days >= 1 and $months > 0) {
            push @age, sprintf ", %i %s ", $months, ($months >= 2 ? 'months' : 'month');
        } elsif (!$days and $months > 0) {
            push @age, sprintf " and %i %s ", $months, ($months >= 2 ? 'months' : 'month');
        }
        if ($days > 0) {
            push @age, sprintf " and %i %s", $days, ($days >= 2 ? 'days' : 'day');
        }

        return (join('', @age), ($now->epoch - $dob->epoch));
    });

    # --- File Reader (source) ---
    $app->helper(source_file => sub {
        my ($c, $file) = @_;
        return "Error: File not found." unless -f $file;
        open my $fh, '<:utf8', $file or return "Error: $!";
        my $text = do { local $/; <$fh> };
        close $fh;
        return $text;
    });
}

1;
