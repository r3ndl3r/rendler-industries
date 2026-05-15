# /lib/DB/Fuel.pm

package DB::Fuel;

use strict;
use warnings;
use DBI qw(:sql_types);

# Database library for vehicle fuel logging and binary image storage.
#
# Features:
#   - Dual image BLOB storage using the same in-table pattern as receipts.
#   - Multi-vehicle ledgers with calculated efficiency metrics.
#   - Review-state tracking for AI-assisted extraction.
#   - Spending, volume, and price aggregates for dashboard tiles.
#
# Integration Points:
#   - Extends the core DB package via package injection.
#   - Provides state payloads for the fuel controller.
#   - Stores structured AI extraction results for manual review.

# Stores a new fuel log with two uploaded source images.
# Returns: Integer identifier for the newly created fuel log.
sub DB::store_fuel_log {
    my ($self, $data) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "INSERT INTO fuel_logs (
            vehicle_id,
            image1_filename, image1_original_filename, image1_mime_type, image1_file_size, image1_file_data,
            image2_filename, image2_original_filename, image2_mime_type, image2_file_size, image2_file_data,
            uploaded_by, log_date, fill_type, description, ai_status, needs_review
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1)"
    );

    $sth->bind_param(1,  $data->{vehicle_id});
    $sth->bind_param(2,  $data->{image1_filename});
    $sth->bind_param(3,  $data->{image1_original_filename});
    $sth->bind_param(4,  $data->{image1_mime_type});
    $sth->bind_param(5,  $data->{image1_file_size});
    $sth->bind_param(6,  $data->{image1_file_data}, SQL_BLOB);
    $sth->bind_param(7,  $data->{image2_filename});
    $sth->bind_param(8,  $data->{image2_original_filename});
    $sth->bind_param(9,  $data->{image2_mime_type});
    $sth->bind_param(10, $data->{image2_file_size});
    $sth->bind_param(11, $data->{image2_file_data}, SQL_BLOB);
    $sth->bind_param(12, $data->{uploaded_by});
    $sth->bind_param(13, $data->{log_date});
    $sth->bind_param(14, $data->{fill_type});
    $sth->bind_param(15, $data->{description});
    $sth->execute();

    return $self->{dbh}->last_insert_id(undef, undef, 'fuel_logs', 'id');
}

# Retrieves a complete fuel log, including image BLOB data.
# Returns: HashRef or undef.
sub DB::get_fuel_log_by_id {
    my ($self, $id) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("SELECT * FROM fuel_logs WHERE id = ? AND deleted_at IS NULL");
    $sth->execute($id);
    return $sth->fetchrow_hashref();
}

# Retrieves fuel log metadata for the ledger.
# Returns: ArrayRef of HashRefs.
sub DB::get_all_fuel_logs {
    my ($self, $limit, $offset, $f, $user) = @_;
    $self->ensure_connection;

    my $sql = "SELECT l.id, l.vehicle_id, v.name AS vehicle_name, v.make, v.model, v.year,
               l.image1_filename, l.image1_original_filename, l.image1_mime_type, l.image1_file_size,
               l.image2_filename, l.image2_original_filename, l.image2_mime_type, l.image2_file_size,
               l.uploaded_by, l.uploaded_at, l.log_date, DATE_FORMAT(l.log_date, '%d-%m-%Y') AS formatted_date,
               l.odometer, l.litres, l.price_per_litre, l.total_amount, l.station_name, l.fill_type,
               l.description, l.ai_json, l.ai_status, l.needs_review, l.review_reasons
               FROM fuel_logs l
               JOIN fuel_vehicles v ON v.id = l.vehicle_id
               WHERE l.deleted_at IS NULL";

    my @params;

    if ($f->{id}) {
        $sql .= " AND l.id = ?";
        push @params, $f->{id};
    }

    if ($f->{vehicle_id} && $f->{vehicle_id} =~ /^\d+$/) {
        $sql .= " AND l.vehicle_id = ?";
        push @params, $f->{vehicle_id};
    }

    if ($f->{days} && $f->{days} =~ /^\d+$/) {
        $sql .= " AND l.log_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)";
        push @params, $f->{days};
    }

    if ($f->{ai_status}) {
        $sql .= " AND l.ai_status = ?";
        push @params, $f->{ai_status};
    }

    if ($f->{uploader}) {
        $sql .= " AND l.uploaded_by = ?";
        push @params, $f->{uploader};
    }

    if ($f->{search}) {
        $sql .= " AND (v.name LIKE ? OR l.station_name LIKE ? OR l.description LIKE ? OR l.image1_original_filename LIKE ? OR l.image2_original_filename LIKE ?)";
        my $term = "%$f->{search}%";
        push @params, ($term, $term, $term, $term, $term);
    }

    $sql .= " ORDER BY l.log_date DESC, l.uploaded_at DESC, l.id DESC";

    if (defined $limit) {
        $sql .= " LIMIT " . int($limit);
        $sql .= " OFFSET " . int($offset) if defined $offset;
    }

    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(@params);
    my $rows = $sth->fetchall_arrayref({});

    foreach my $row (@$rows) {
        my $economy = $self->calculate_fuel_economy($row->{vehicle_id}, $row->{odometer}, $row->{fill_type});
        $row->{distance_km} = $economy->{distance_km};
        $row->{litres_per_100km} = $economy->{litres_per_100km};
        $row->{cost_per_km} = $economy->{cost_per_km};
        $row->{economy_litres} = $economy->{economy_litres};
    }

    return $rows;
}

# Calculates economy for a full-fill log from the previous full-fill odometer.
# Returns: HashRef with nullable distance and efficiency values.
sub DB::calculate_fuel_economy {
    my ($self, $vehicle_id, $current_odometer, $fill_type) = @_;
    $self->ensure_connection;

    return {
        distance_km => undef,
        litres_per_100km => undef,
        cost_per_km => undef,
        economy_litres => undef
    } unless $vehicle_id && $current_odometer && (($fill_type // '') eq 'full');

    my $prev = $self->{dbh}->selectrow_hashref(
        "SELECT id, odometer
         FROM fuel_logs
         WHERE vehicle_id = ? AND deleted_at IS NULL AND fill_type = 'full'
           AND odometer IS NOT NULL AND odometer < ?
         ORDER BY odometer DESC
         LIMIT 1",
        undef,
        $vehicle_id,
        $current_odometer
    );

    return {
        distance_km => undef,
        litres_per_100km => undef,
        cost_per_km => undef,
        economy_litres => undef
    } unless $prev && $prev->{odometer};

    my $distance = int($current_odometer) - int($prev->{odometer});
    return {
        distance_km => undef,
        litres_per_100km => undef,
        cost_per_km => undef,
        economy_litres => undef
    } if $distance <= 0;

    my $totals = $self->{dbh}->selectrow_hashref(
        "SELECT COALESCE(SUM(litres), 0) AS litres, COALESCE(SUM(total_amount), 0) AS total_amount
         FROM fuel_logs
         WHERE vehicle_id = ? AND deleted_at IS NULL
           AND odometer IS NOT NULL AND odometer > ? AND odometer <= ?",
        undef,
        $vehicle_id,
        $prev->{odometer},
        $current_odometer
    ) || {};

    my $litres = $totals->{litres} || 0;
    my $amount = $totals->{total_amount} || 0;

    return {
        distance_km => $distance,
        litres_per_100km => $litres > 0 ? sprintf('%.2f', ($litres / $distance) * 100) : undef,
        cost_per_km => $amount > 0 ? sprintf('%.3f', ($amount / $distance)) : undef,
        economy_litres => $litres > 0 ? sprintf('%.2f', $litres) : undef
    };
}

# Updates extracted or manually entered fuel log metadata.
# Returns: Rows affected.
sub DB::update_fuel_log_data {
    my ($self, $id, $data) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "UPDATE fuel_logs
         SET vehicle_id = ?, log_date = ?, odometer = ?, litres = ?, price_per_litre = ?,
             total_amount = ?, station_name = ?, fill_type = ?, description = ?,
             ai_json = ?, ai_status = ?, needs_review = ?, review_reasons = ?
         WHERE id = ? AND deleted_at IS NULL"
    );

    return $sth->execute(
        $data->{vehicle_id}, $data->{log_date}, $data->{odometer}, $data->{litres},
        $data->{price_per_litre}, $data->{total_amount}, $data->{station_name},
        $data->{fill_type}, $data->{description}, $data->{ai_json}, $data->{ai_status},
        $data->{needs_review}, $data->{review_reasons}, $id
    );
}

# Marks a fuel log as removed while retaining historical audit context.
# Returns: Rows affected.
sub DB::delete_fuel_log_record {
    my ($self, $id) = @_;
    $self->ensure_connection;
    return $self->{dbh}->do("UPDATE fuel_logs SET deleted_at = NOW() WHERE id = ?", undef, $id);
}

# Retrieves all active vehicles for selection.
# Returns: ArrayRef of HashRefs.
sub DB::get_active_fuel_vehicles {
    my ($self) = @_;
    $self->ensure_connection;
    return $self->{dbh}->selectall_arrayref(
        "SELECT id, name, make, model, year, is_active, created_at
         FROM fuel_vehicles
         WHERE is_active = 1
         ORDER BY name ASC",
        { Slice => {} }
    );
}

# Retrieves every vehicle for management.
# Returns: ArrayRef of HashRefs.
sub DB::get_all_fuel_vehicles {
    my ($self) = @_;
    $self->ensure_connection;
    return $self->{dbh}->selectall_arrayref(
        "SELECT id, name, make, model, year, is_active, created_at
         FROM fuel_vehicles
         ORDER BY is_active DESC, name ASC",
        { Slice => {} }
    );
}

# Creates a vehicle profile.
# Returns: Integer identifier.
sub DB::create_fuel_vehicle {
    my ($self, $name, $make, $model, $year, $is_active) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare(
        "INSERT INTO fuel_vehicles (name, make, model, year, is_active) VALUES (?, ?, ?, ?, ?)"
    );
    $sth->execute($name, $make, $model, $year, $is_active);
    return $self->{dbh}->last_insert_id(undef, undef, 'fuel_vehicles', 'id');
}

# Updates a vehicle profile.
# Returns: Rows affected.
sub DB::update_fuel_vehicle {
    my ($self, $id, $name, $make, $model, $year, $is_active) = @_;
    $self->ensure_connection;
    return $self->{dbh}->do(
        "UPDATE fuel_vehicles SET name = ?, make = ?, model = ?, year = ?, is_active = ? WHERE id = ?",
        undef,
        $name, $make, $model, $year, $is_active, $id
    );
}

# Deactivates a vehicle when historical logs reference it.
# Returns: Rows affected.
sub DB::archive_fuel_vehicle {
    my ($self, $id) = @_;
    $self->ensure_connection;
    return $self->{dbh}->do("UPDATE fuel_vehicles SET is_active = 0 WHERE id = ?", undef, $id);
}

# Retrieves unique station names for filters and datalists.
# Returns: ArrayRef of strings.
sub DB::get_unique_fuel_station_names {
    my ($self) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare(
        "SELECT DISTINCT station_name FROM fuel_logs
         WHERE deleted_at IS NULL AND station_name IS NOT NULL AND station_name != ''
         ORDER BY station_name ASC"
    );
    $sth->execute();
    return [ map { $_->[0] } @{$sth->fetchall_arrayref()} ];
}

# Aggregates fuel spending, volume, and current efficiency for dashboard tiles.
# Returns: HashRef of summary values.
sub DB::get_fuel_summary {
    my ($self, $vehicle_id) = @_;
    $self->ensure_connection;

    my $where = "deleted_at IS NULL";
    my @params;
    if ($vehicle_id && $vehicle_id =~ /^\d+$/) {
        $where .= " AND vehicle_id = ?";
        push @params, $vehicle_id;
    }

    my $summary = $self->{dbh}->selectrow_hashref(
        "SELECT
            COALESCE(SUM(CASE WHEN log_date >= DATE_SUB(CURDATE(), INTERVAL (WEEKDAY(CURDATE())) DAY) THEN total_amount ELSE 0 END), 0) AS week_total,
            COALESCE(SUM(CASE WHEN log_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN total_amount ELSE 0 END), 0) AS month_total,
            COALESCE(SUM(CASE WHEN log_date >= DATE_FORMAT(CURDATE(), '%Y-01-01') THEN total_amount ELSE 0 END), 0) AS year_total,
            COALESCE(SUM(CASE WHEN log_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN litres ELSE 0 END), 0) AS month_litres,
            COALESCE(AVG(CASE WHEN log_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN price_per_litre ELSE NULL END), 0) AS current_month_price,
            COALESCE(AVG(CASE WHEN log_date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')
                              AND log_date < DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN price_per_litre ELSE NULL END), 0) AS previous_month_price
         FROM fuel_logs
         WHERE $where",
        undef,
        @params
    ) || {};

    my $latest = $self->{dbh}->selectrow_hashref(
        "SELECT id, vehicle_id, odometer, fill_type
         FROM fuel_logs
         WHERE $where AND fill_type = 'full' AND odometer IS NOT NULL
         ORDER BY log_date DESC, uploaded_at DESC, id DESC
         LIMIT 1",
        undef,
        @params
    );

    if ($latest) {
        my $economy = $self->calculate_fuel_economy($latest->{vehicle_id}, $latest->{odometer}, $latest->{fill_type});
        $summary->{current_l_per_100km} = $economy->{litres_per_100km};
        $summary->{current_cost_per_km} = $economy->{cost_per_km};
        $summary->{current_distance_km} = $economy->{distance_km};
    }

    return $summary;
}

1;
