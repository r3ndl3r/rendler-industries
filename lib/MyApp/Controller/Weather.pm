# /lib/MyApp/Controller/Weather.pm

package MyApp::Controller::Weather;

use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for the Weather Dashboard.
# Integrates with OpenWeatherMap One Call 3.0 via raw JSON storage.

# Renders the main weather dashboard skeleton.
# Route: GET /weather
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render('weather');
}

# The single-source-of-truth state generator for weather data.
# Route: POST /weather/api/state
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $state = {
        is_admin     => $c->is_admin ? 1 : 0,
        observations => $c->db->get_latest_weather_data(),
        success      => 1
    };

    # Admins get the list of locations for management
    if ($c->is_admin) {
        $state->{locations} = $c->db->get_weather_locations();
    }

    $c->render(json => $state);
}

# Geocoding endpoint to search for cities.
# Route: POST /weather/api/geocode
sub api_geocode {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $query = trim($c->param('q') || '');
    return $c->render(json => { success => 0, error => 'Query required' }) unless $query;

    my $api_key = $c->db->get_owm_api_key();
    unless ($api_key) {
        return $c->render(json => { success => 0, error => 'OWM API Key not configured in Settings' });
    }

    my $url = sprintf(
        "http://api.openweathermap.org/geo/1.0/direct?q=%s&limit=5&appid=%s",
        Mojo::Util::url_escape($query), $api_key
    );

    # Perform non-blocking lookup
    $c->ua->get($url => sub {
        my ($ua, $tx) = @_;
        if (my $res = $tx->result) {
            if ($res->is_success) {
                return $c->render(json => { success => 1, results => $res->json });
            }
            return $c->render(json => { success => 0, error => 'Geocoding service unavailable' });
        }
        $c->render(json => { success => 0, error => 'Geocoding connection failed' });
    });
}

# Administrative hook for adding a new geographic tracking point.
# Route: POST /weather/api/add
sub api_add {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $name     = trim($c->param('name') || '');
    my $lat      = trim($c->param('lat') || '');
    my $lon      = trim($c->param('lon') || '');
    my $interval = int($c->param('update_interval_mins') || 60);

    return $c->render(json => { success => 0, error => 'All fields required' }) unless $name && $lat ne '' && $lon ne '';

    my $new_id = $c->db->add_weather_location($name, $lat, $lon, $interval);
    
    if ($new_id) {
        $c->app->log->info("Weather: Admin " . $c->session('user') . " added location '$name'.");
        
        # Trigger immediate background sync
        require MyApp::Controller::System;
        my $sys = MyApp::Controller::System->new(app => $c->app, tx => $c->tx);
        $sys->run_weather_maintenance($c->now);

        return $c->render(json => { 
            success => 1, 
            message => "$name added" 
        });
    }
    
    $c->render(json => { success => 0, error => 'Database error' });
}

# Administrative hook for updating location metadata.
# Route: POST /weather/api/update/:id
sub api_update {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $id         = $c->param('id');
    my $name       = trim($c->param('name') || '');
    my $lat        = trim($c->param('lat') || '');
    my $lon        = trim($c->param('lon') || '');
    my $interval   = int($c->param('update_interval_mins') || 60);
    my $is_active  = int($c->param('is_active') // 1);

    return $c->render(json => { success => 0, error => 'All fields required' }) unless $name && $lat ne '' && $lon ne '';

    $c->db->update_weather_location($id, $name, $lat, $lon, $interval, $is_active);
    $c->app->log->info("Weather: Admin " . $c->session('user') . " updated location '$name'.");
    
    # Trigger immediate background sync
    require MyApp::Controller::System;
    my $sys = MyApp::Controller::System->new(app => $c->app, tx => $c->tx);
    $sys->run_weather_maintenance($c->now);

    $c->render(json => { 
        success => 1, 
        message => "$name updated" 
    });
}

# Administrative hook for deleting a location.
# Route: POST /weather/api/delete/:id
sub api_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $id = $c->param('id');
    $c->db->delete_weather_location($id);
    $c->app->log->info("Weather: Admin " . $c->session('user') . " deleted location ID $id.");
    
    $c->render(json => { 
        success => 1, 
        message => 'Location removed successfully' 
    });
}

# Administrative hook for batch re-ordering.
# Route: POST /weather/api/reorder
sub api_reorder {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    # Strict CSV parsing for standard reorder sequence
    my $raw = $c->param('ids') // '';
    my @ids = split /,/, $raw;
    
    return $c->render(json => { success => 0, error => 'No IDs provided' }) unless @ids;

    my $order = 1;
    for my $id (@ids) {
        $c->db->update_weather_location_order($id, $order++);
    }

    $c->app->log->info("Weather: Admin " . $c->session('user') . " re-ordered " . scalar(@ids) . " locations.");
    $c->render(json => { 
        success => 1, 
        message => 'Sequence updated' 
    });
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{auth}->get('/weather')->to('weather#index');
    $r->{auth}->post('/weather/api/state')->to('weather#api_state');
    $r->{admin}->post('/weather/api/geocode')->to('weather#api_geocode');
    $r->{admin}->post('/weather/api/add')->to('weather#api_add');
    $r->{admin}->post('/weather/api/update/:id')->to('weather#api_update');
    $r->{admin}->post('/weather/api/delete/:id')->to('weather#api_delete');
    $r->{admin}->post('/weather/api/reorder')->to('weather#api_reorder');
}

1;
