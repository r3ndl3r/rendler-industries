# /lib/MyApp/Controller/Chelsea.pm

package MyApp::Controller::Chelsea;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::UserAgent;
use Mojo::JSON qw(decode_json);
use Time::Piece;

# Chelsea Weather Controller
# Handles scraping, interpolation, and formatting of Chelsea forecast data.
# Features:
#   - Real-time scraping of Windfinder GFS data
#   - Row-based data synchronization (Temp, Rain, Icons)
#   - Linear interpolation for 2-hour granular viewing
#   - Color-coded wind and temperature thresholds

# Main entry point for the Chelsea weather dashboard.
# Fetches external data and prepares a 96-hour interpolated forecast.
# Parameters: None
# Returns: 
#   Renders 'chelsea' template with an array ref of daily-grouped forecast rows.
sub index {
    my $self = shift;

    my $url = 'https://www.windfinder.com/forecast/chelsea';
    my $ua  = Mojo::UserAgent->new;
    $ua->transactor->name('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    # 1. Fetch Remote Content
    my $tx = $ua->get($url);
    return $self->render(template => 'chelsea', forecast => []) if $tx->result->is_error;

    my $html = $tx->result->body;
    my $weather_data = [];

    # 2. Extract Base Wind/Wave JSON (fcData)
    if ($html =~ /fcData\s*:\s*(\[\{.*?\}\])\s*,/s) {
        $weather_data = eval { decode_json($1) } // [];
    }

    # 3. Synchronize HTML-specific data (Row-by-Row parsing)
    # Extracts individual table rows to prevent array offset errors for Rain and Temp.
    my @html_rows = ($html =~ /<div class="weathertable__row.*?>(.*?)<\/div>\s+<span class="ws-gradient"><\/span>/gs);

    for my $i (0 .. $#$weather_data) {
        my $row_content = $html_rows[$i] // '';
        
        # Extract Temperature
        my ($temp) = ($row_content =~ /<span class="units-at">(-?\d+)<\/span>/);
        $weather_data->[$i]{temp} = $temp // 0;

        # Extract Rainfall (Defaults to 0.0 if tag is missing in current row)
        my ($rain) = ($row_content =~ /<span class="units-pr">([\d\.]+)<\/span>/);
        $weather_data->[$i]{rain} = $rain // '0.0';

        # Extract Condition Icon class
        my ($icon) = ($row_content =~ /class="data-cover__symbol\s+(icon-[nd]-[a-z0-9]+)/);
        $weather_data->[$i]{icon} = $icon // 'skc';
        
        # Sanitize ISO8601 offset for Time::Piece compatibility (+11:00 -> +1100)
        if (my $dt = $weather_data->[$i]{dtl}) {
            $dt =~ s/(\+\d{2}):(\d{2})$/$1$2/;
            $weather_data->[$i]{dtl_fixed} = $dt;
        }
    }

    # 4. Prepare Interpolated Dataset
    my $interpolated = _process_forecast($weather_data);

    $self->render(
        template => 'chelsea',
        forecast => $interpolated
    );
}

# Helper: Performs linear interpolation and grouping for the forecast data.
# Parameters:
#   raw_data : ArrayRef of hashes containing the 3-hour source points.
# Returns:
#   ArrayRef of days, each containing a list of 2-hour interpolated points.
sub _process_forecast {
    my $raw = shift;
    return [] unless @$raw;

    my %days;
    my @day_order;
    my %icon_map = (
        'skc'=>'☀️','clr'=>'☀️','few'=>'🌤️','sct'=>'⛅','bkn'=>'🌥️',
        'ovc'=>'☁️','ra'=>'🌧️','sh'=>'🌦️','ts'=>'⛈️'
    );

    my $start_time = Time::Piece->strptime($raw->[0]{dtl_fixed}, "%Y-%m-%dT%H:%M:%S%z");
    
    for (my $h = 0; $h < 96; $h += 2) {
        my $target_epoch = $start_time->epoch + ($h * 3600);
        
        my ($p0, $p1);
        for (my $i = 0; $i < $#$raw; $i++) {
            my $t0 = Time::Piece->strptime($raw->[$i]{dtl_fixed}, "%Y-%m-%dT%H:%M:%S%z")->epoch;
            my $t1 = Time::Piece->strptime($raw->[$i+1]{dtl_fixed}, "%Y-%m-%dT%H:%M:%S%z")->epoch;
            if ($target_epoch >= $t0 && $target_epoch <= $t1) {
                $p0 = { %{$raw->[$i]}, epoch => $t0 };
                $p1 = { %{$raw->[$i+1]}, epoch => $t1 };
                last;
            }
        }
        
        $p0 //= { %{$raw->[0]}, epoch => $start_time->epoch };
        $p1 //= $p0;

        my $target_time = localtime($target_epoch);
        my $day_label = $target_time->strftime("%A, %d %B %Y");
        
        if (!$days{$day_label}) {
            push @day_order, $day_label;
            $days{$day_label} = [];
        }

        my $cur_ws   = _lerp($target_epoch, $p0->{epoch}, $p1->{epoch}, $p0->{ws}, $p1->{ws});
        my $cur_temp = _lerp($target_epoch, $p0->{epoch}, $p1->{epoch}, $p0->{temp}, $p1->{temp});

        my $icon_code = ($p0->{icon} =~ /icon-[nd]-([a-z0-9]+)/) ? $1 : 'skc';
        
        push @{$days{$day_label}}, {
            time    => $target_time->strftime("%l:%M %p"),
            temp    => sprintf("%.0f", $cur_temp),
            ws_kmh  => sprintf("%.1f", $cur_ws * 1.852),
            wg_kmh  => sprintf("%.1f", $p0->{wg} * 1.852),
            wh      => sprintf("%.1f", $p0->{wh}),
            rain    => $p0->{rain},
            icon    => $icon_map{$icon_code} // '☀️',
            w_class => _get_wind_style($cur_ws * 1.852),
            t_class => _get_temp_style($cur_temp)
        };
    }

    return [ map { { label => $_, rows => $days{$_} } } @day_order ];
}

# Helper: Standard Linear Interpolation
sub _lerp {
    my ($t, $t0, $t1, $v0, $v1) = @_;
    return $v0 if $t0 == $t1;
    return $v0 + ($v1 - $v0) * (($t - $t0) / ($t1 - $t0));
}

# Helper: Assigns CSS classes based on wind intensity (KM/H)
sub _get_wind_style {
    my $v = shift;
    return 'wind-vlow' if $v < 15;
    return 'wind-low'  if $v < 25;
    return 'wind-med'  if $v < 35;
    return 'wind-high' if $v < 45;
    return 'wind-extreme';
}

# Helper: Assigns CSS classes based on temperature levels (Celsius)
sub _get_temp_style {
    my $t = shift;
    return 'temp-cool' if $t < 18;
    return 'temp-mild' if $t < 23;
    return 'temp-warm' if $t < 28;
    return 'temp-hot'  if $t < 33;
    return 'temp-vhot';
}

1;