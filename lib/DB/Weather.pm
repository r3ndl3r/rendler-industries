# /lib/DB/Weather.pm

package DB::Weather;

use strict;
use warnings;

# DB Helper module managing Weather Location metadata and Observations.
# Integrates with the OpenWeatherMap One Call 3.0 API via raw JSON storage.

# Retrieves all configured weather tracking locations.
sub DB::get_weather_locations {
    my ($self, $only_active) = @_;
    $self->ensure_connection();

    my $query = "SELECT * FROM weather_locations";
    $query .= " WHERE is_active = 1" if $only_active;
    $query .= " ORDER BY sort_order ASC, name ASC";

    my $sth = $self->{dbh}->prepare($query);
    $sth->execute();
    
    my @locations;
    while (my $row = $sth->fetchrow_hashref()) {
        push @locations, $row;
    }
    return \@locations;
}

# Identifies locations that are due for a refresh via OpenWeatherMap.
sub DB::get_due_weather_locations {
    my ($self) = @_;
    $self->ensure_connection();

    my $query = qq{
        SELECT * FROM weather_locations 
        WHERE is_active = 1 
        AND (last_updated_at IS NULL OR last_updated_at <= DATE_SUB(NOW(), INTERVAL update_interval_mins MINUTE))
    };

    my $sth = $self->{dbh}->prepare($query);
    $sth->execute();
    
    my @due;
    while (my $row = $sth->fetchrow_hashref()) {
        push @due, $row;
    }
    return \@due;
}

# Saves the raw OWM One Call JSON payload to the database.
sub DB::save_weather_observation {
    my ($self, $location_id, $json_str, $observed_at) = @_;
    $self->ensure_connection();

    my $sth = $self->{dbh}->prepare(
        "REPLACE INTO weather_observations (location_id, data_json, observed_at) VALUES (?, ?, ?)"
    );
    $sth->execute($location_id, $json_str, $observed_at);

    # Update heartbeat
    my $upd = $self->{dbh}->prepare("UPDATE weather_locations SET last_updated_at = NOW() WHERE id = ?");
    $upd->execute($location_id);

    return $self->{dbh}->last_insert_id(undef, undef, 'weather_observations', undef);
}

# Retrieves the latest high-fidelity OWM JSON for all active locations.
sub DB::get_latest_weather_data {
    my ($self) = @_;
    $self->ensure_connection();

    my $query = qq{
        SELECT l.id as location_id, l.name, l.lat, l.lon, o.data_json, o.observed_at
        FROM weather_locations l
        LEFT JOIN weather_observations o ON l.id = o.location_id
        WHERE l.is_active = 1
        ORDER BY l.sort_order ASC, l.name ASC
    };

    my $sth = $self->{dbh}->prepare($query);
    $sth->execute();
    
    my @data;
    while (my $row = $sth->fetchrow_hashref()) {
        push @data, $row;
    }
    return \@data;
}

# Administrative: Adds a new geographic tracking point.
sub DB::add_weather_location {
    my ($self, $name, $lat, $lon, $interval) = @_;
    $self->ensure_connection();

    my $sth = $self->{dbh}->prepare(
        "INSERT INTO weather_locations (name, lat, lon, update_interval_mins) VALUES (?, ?, ?, ?)"
    );
    $sth->execute($name, $lat, $lon, $interval || 60);
    return $self->{dbh}->last_insert_id(undef, undef, 'weather_locations', undef);
}

# Administrative: Updates location configuration.
sub DB::update_weather_location {
    my ($self, $id, $name, $lat, $lon, $interval, $is_active) = @_;
    $self->ensure_connection();

    my $sth = $self->{dbh}->prepare(
        "UPDATE weather_locations SET name = ?, lat = ?, lon = ?, update_interval_mins = ?, is_active = ? WHERE id = ?"
    );
    $sth->execute($name, $lat, $lon, $interval, $is_active, $id);
    return 1;
}

# Administrative: Updates location sort order.
sub DB::update_weather_location_order {
    my ($self, $id, $order) = @_;
    $self->ensure_connection();

    my $sth = $self->{dbh}->prepare("UPDATE weather_locations SET sort_order = ? WHERE id = ?");
    $sth->execute($order, $id);
    return 1;
}

# Administrative: Removes a location and all its weather records.
sub DB::delete_weather_location {
    my ($self, $id) = @_;
    $self->ensure_connection();
    my $sth = $self->{dbh}->prepare("DELETE FROM weather_locations WHERE id = ?");
    $sth->execute($id);
    return 1;
}

# Key Management: Stores the OWM API Key in app_secrets.
sub DB::save_owm_api_key {
    my ($self, $key) = @_;
    $self->ensure_connection();
    my $sth = $self->{dbh}->prepare("INSERT INTO app_secrets (key_name, secret_value) VALUES ('owm_api_key', ?) ON DUPLICATE KEY UPDATE secret_value = ?");
    $sth->execute($key, $key);
}

# Key Management: Retrieves the OWM API Key.
sub DB::get_owm_api_key {
    my ($self) = @_;
    $self->ensure_connection();
    my $sth = $self->{dbh}->prepare("SELECT secret_value FROM app_secrets WHERE key_name = 'owm_api_key'");
    $sth->execute();
    my ($key) = $sth->fetchrow_array();
    return $key;
}

1;
