# /lib/MyApp/Plugin/Tools.pm

package MyApp::Plugin::Tools;

use Mojo::Base 'Mojolicious::Plugin';
use DateTime;
use strict;
use warnings;
use utf8;
use Mojo::JSON qw(to_json);
use Time::Piece;

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
        my $now = $c->now;
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

    # --- Reminder Edit Data Serializer ---
    $app->helper(reminder_json => sub {
        my ($c, $r) = @_;
        return Mojo::JSON::to_json({
            id            => $r->{id},
            title         => $r->{title},
            description   => $r->{description} // '',
            reminder_time => $r->{reminder_time},
            days_of_week  => $r->{days_of_week} // '',
            recipient_ids => $r->{recipient_ids} // '',
            is_one_off    => $r->{is_one_off}    // 0,
            is_active     => $r->{is_active}     // 1,
        });
    });

    # --- High-Fidelity DateTime Formatter ---
    # Formats a SQL datetime string into a user-friendly display string.
    $app->helper(format_datetime => sub {
        my ($c, $dt, $all_day) = @_;
        return '' unless $dt;
        
        my $t;
        eval {
            if ($dt =~ /^\d{4}-\d{2}-\d{2}$/) {
                $t = Time::Piece->strptime($dt, "%Y-%m-%d");
            } else {
                # Normalize seconds if missing or partial
                my $clean_dt = $dt;
                $clean_dt .= ":00" if $dt =~ /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
                $t = Time::Piece->strptime($clean_dt, "%Y-%m-%d %H:%M:%S");
            }
        };
        return $dt if $@ || !$t;

        my $day = $t->mday;
        my $suffix = 'th';
        if ($day !~ /^1[123]$/) {
            my $last_digit = $day % 10;
            $suffix = 'st' if $last_digit == 1;
            $suffix = 'nd' if $last_digit == 2;
            $suffix = 'rd' if $last_digit == 3;
        }

        if ($all_day) {
            return sprintf("%s, %d%s %s %d (All day)", $t->fullday, $day, $suffix, $t->fullmonth, $t->year);
        }

        my $h = $t->hour;
        my $ampm = $h >= 12 ? 'PM' : 'AM';
        $h = $h % 12;
        $h = 12 if $h == 0;
        
        return sprintf("%s, %d%s %s %d - %02d:%02d%s", 
            $t->fullday, $day, $suffix, $t->fullmonth, $t->year,
            $h, $t->min, $ampm
        );
    });
}

1;
