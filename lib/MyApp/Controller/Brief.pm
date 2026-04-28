# /lib/MyApp/Controller/Brief.pm

package MyApp::Controller::Brief;
use Mojo::Base 'Mojolicious::Controller';
# Controller for the personal daily brief dashboard.
#
# Features:
#   - Aggregates all data sources into a single state payload.
#   - Filters reminders to today's day-of-week and birthdays within 14 days.
#
# Integration Points:
#   - DB::Weather, DB::Calendar, DB::Chores, DB::Reminders, DB::Points, DB::Birthdays

# Renders the daily brief page skeleton.
# Route: GET /brief
# Returns: Template (brief.html.ep)
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render('brief');
}

# Returns consolidated state for all brief data sources.
# Route: GET /brief/api/state
# Returns: JSON { weather, calendar, chores, reminders, points, birthdays, is_admin, success }
sub api_state {
    my $c = shift;

    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_logged_in;

    my $user_id  = $c->current_user_id;
    my $is_admin = $c->is_admin ? 1 : 0;
    my $now      = $c->now;
    my $today    = $now->strftime('%Y-%m-%d');
    my $tomorrow = $now->clone->add(days => 1)->strftime('%Y-%m-%d');

    # Weather: first location by sort order (manually maintained in the weather app)
    my $raw_weather = $c->db->get_latest_weather_data();
    my $weather = {};
    if (my $loc = $raw_weather->[0]) {
        $weather = {
            name        => $loc->{name},
            data        => $loc->{data_json},
            observed_at => $loc->{observed_at} // '',
        };
    }

    # Calendar: today's and tomorrow's events as separate arrays
    my ($calendar_today)    = $c->db->get_calendar_events($user_id, $is_admin, $today,    $today);
    my ($calendar_tomorrow) = $c->db->get_calendar_events($user_id, $is_admin, $tomorrow, $tomorrow);

    # Chores: active chores assigned to this user or unassigned
    my $chores = $c->db->get_active_chores($user_id, $is_admin);

    # Reminders: filtered to today's day-of-week and current user as recipient (all for admins)
    my $today_dow     = $now->day_of_week; # 1=Mon, 7=Sun
    my $all_reminders = $c->db->get_all_reminders();
    my @reminders = grep {
        my $days       = $_->{days_of_week} // '';
        my $active_day = grep { $_ == $today_dow } split(/,/, $days);
        my $recipient  = $is_admin || grep { $_ == $user_id } split(/,/, $_->{recipient_ids} // '');
        $active_day && $recipient;
    } @$all_reminders;

    # Points: balance and last 5 transactions for this user
    my $points_total   = $c->db->get_user_points($user_id);
    my $points_history = $c->db->get_point_history($user_id);
    my @recent_points  = @{$points_history}[0 .. ($#$points_history < 4 ? $#$points_history : 4)];

    # Birthdays: next upcoming within 14 days, sorted ascending by days_until
    my @all_birthdays = $c->db->get_all_birthdays();
    my $today_dt = $now->clone->truncate(to => 'day');
    my @birthdays;
    for my $b (@all_birthdays) {
        my ($bm, $bd) = ($b->{birth_date} =~ /^\d{4}-(\d{2})-(\d{2})$/);
        next unless $bm && $bd;
        my $next = eval {
            my $dt = DateTime->new(
                year      => $today_dt->year,
                month     => int($bm),
                day       => int($bd),
                time_zone => $today_dt->time_zone,
            );
            $dt->add(years => 1) if $dt < $today_dt;
            $dt;
        };
        next unless $next;
        my $days_until = $next->delta_days($today_dt)->delta_days;
        next if $days_until > 14;
        push @birthdays, { %$b, days_until => $days_until };
    }
    @birthdays = sort { $a->{days_until} <=> $b->{days_until} } @birthdays;

    $c->render(json => {
        success           => 1,
        weather           => $weather,
        calendar_today    => $calendar_today,
        calendar_tomorrow => $calendar_tomorrow,
        chores            => $chores,
        reminders         => \@reminders,
        points            => { total => $points_total, recent => \@recent_points },
        birthdays         => \@birthdays,
        users             => $c->db->get_family_users(),
        is_admin          => $is_admin,
        server_hour       => $now->hour,
    });
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{auth}->get('/brief')->to('brief#index');
    $r->{auth}->get('/brief/api/state')->to('brief#api_state');
}

1;
