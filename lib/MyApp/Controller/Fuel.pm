# /lib/MyApp/Controller/Fuel.pm

package MyApp::Controller::Fuel;

use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);
use Mojo::JSON qw(decode_json encode_json);
use Mojo::Promise;

# Controller for vehicle fuel logging and AI-assisted extraction.
#
# Features:
#   - Dual image upload for odometer and pump or receipt photos.
#   - AI extraction with manual review fallback.
#   - Vehicle management through the primary fuel interface.
#   - State-driven ledger payloads for spending and economy analytics.
#
# Integration Points:
#   - Restricted to family members via the route bridge.
#   - Depends on DB::Fuel for persistence and efficiency calculations.
#   - Uses centralized AI helpers for structured extraction.

# Renders the main fuel ledger skeleton.
# Route: GET /fuel
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family;
    $c->render('fuel');
}

# Returns the consolidated fuel module state.
# Route: GET /fuel/api/state
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in && $c->is_family;

    my $user = $c->session('user');
    my $f = {
        vehicle_id => $c->param('vehicle_id'),
        days       => $c->param('days'),
        search     => $c->param('search'),
        ai_status  => $c->param('ai_status'),
        uploader   => $c->param('uploader')
    };

    my $logs = $c->db->get_all_fuel_logs(20, 0, $f, $user);

    $c->render(json => {
        success       => 1,
        logs          => $logs,
        vehicles      => $c->db->get_all_fuel_vehicles(),
        active_vehicles => $c->db->get_active_fuel_vehicles(),
        station_names => $c->db->get_unique_fuel_station_names(),
        uploaders     => $c->db->get_all_users(),
        summary       => $c->db->get_fuel_summary($f->{vehicle_id}),
        current_user  => $user // '',
        is_admin      => $c->is_admin ? 1 : 0
    });
}

# Processes a dual-image upload and attempts AI extraction.
# Route: POST /fuel/api/upload
sub api_upload {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in && $c->is_family;

    my $vehicle_id = $c->param('vehicle_id');
    return $c->render(json => { success => 0, error => 'Vehicle is required' }) unless $vehicle_id && $vehicle_id =~ /^\d+$/;

    my $image1 = $c->param('image1');
    my $image2 = $c->param('image2');
    return $c->render(json => { success => 0, error => 'Two images are required' }) unless $image1 && $image2;

    my $prepared1 = _prepare_upload($c, $image1, 'image1');
    return $c->render(json => { success => 0, error => $prepared1->{error} }) if $prepared1->{error};

    my $prepared2 = _prepare_upload($c, $image2, 'image2');
    return $c->render(json => { success => 0, error => $prepared2->{error} }) if $prepared2->{error};

    my $fill_type = ($c->param('fill_type') // 'full') eq 'partial' ? 'partial' : 'full';
    my $description = trim($c->param('description') // '');
    my $discount = _non_negative_decimal($c->param('discount_per_litre')) // 0;
    my $log_date = $c->param('log_date') || $c->now->strftime('%Y-%m-%d');
    $log_date = $c->now->strftime('%Y-%m-%d') unless $log_date =~ /^\d{4}-\d{2}-\d{2}$/;

    my $id;
    eval {
        $id = $c->db->store_fuel_log({
            vehicle_id => $vehicle_id,
            uploaded_by => $c->session('user'),
            log_date => $log_date,
            fill_type => $fill_type,
            description => $description || undef,
            discount_per_litre => $discount,
            %$prepared1,
            %$prepared2
        });
    };

    if ($@ || !$id) {
        $c->app->log->error("Fuel upload failure: $@");
        return $c->render(json => { success => 0, error => 'Database write error' });
    }

    $c->render_later;
    _analyze_and_update_log($c, $id)->then(sub {
        my $log = $c->db->get_all_fuel_logs(1, 0, { id => $id }, $c->session('user'))->[0];
        $c->render(json => {
            success => 1,
            log     => $log,
            summary => $c->db->get_fuel_summary(),
            message => $log->{needs_review} ? 'Uploaded for review' : 'Fuel log captured'
        });
    })->catch(sub {
        my $err = shift;
        $c->app->log->error("Fuel AI extraction failure: $err");
        _mark_ai_failure($c, $id, ["AI extraction failed"]);
        my $log = $c->db->get_all_fuel_logs(1, 0, { id => $id }, $c->session('user'))->[0];
        $c->render(json => {
            success => 1,
            log     => $log,
            summary => $c->db->get_fuel_summary(),
            message => 'Uploaded for manual review'
        });
    });
}

# Creates a complete manual fuel log without source images.
# Route: POST /fuel/api/manual
sub api_manual {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in && $c->is_family;

    my ($data, $reasons) = _extract_manual_create_payload($c);
    return $c->render(json => { success => 0, error => join(', ', @$reasons) }) if @$reasons;

    my $id;
    eval {
        $id = $c->db->store_manual_fuel_log({
            %$data,
            uploaded_by => $c->session('user'),
            review_reasons => encode_json([])
        });
    };

    if ($@ || !$id) {
        $c->app->log->error("Fuel manual entry failure: $@");
        return $c->render(json => { success => 0, error => 'Manual entry could not be saved' });
    }

    my $log = $c->db->get_all_fuel_logs(1, 0, { id => $id }, $c->session('user'))->[0];
    $c->render(json => {
        success => 1,
        log     => $log,
        summary => $c->db->get_fuel_summary(),
        message => 'Manual fuel log saved'
    });
}

# Updates fuel log metadata from the review editor.
# Route: POST /fuel/api/update/:id
sub api_update {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in && $c->is_family;

    my $id = $c->stash('id');
    my $existing = $c->db->get_fuel_log_by_id($id);
    return $c->render(json => { success => 0, error => 'Record not found' }) unless $existing;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless (($existing->{uploaded_by} // '') eq ($c->session('user') // '') || $c->is_admin);

    my ($data, $reasons) = _extract_manual_payload($c, $existing);
    return $c->render(json => { success => 0, error => join(', ', @$reasons) }) if @$reasons;

    eval { $c->db->update_fuel_log_data($id, $data); };
    if ($@) {
        $c->app->log->error("Fuel update failure: $@");
        return $c->render(json => { success => 0, error => 'Update failed' });
    }

    my $updated = $c->db->get_all_fuel_logs(1, 0, { id => $id }, $c->session('user'))->[0];
    $c->render(json => {
        success => 1,
        log     => $updated,
        summary => $c->db->get_fuel_summary(),
        message => 'Fuel log updated'
    });
}

# Soft-removes a fuel log and its image data from the active ledger.
# Route: POST /fuel/api/delete/:id
sub api_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in && $c->is_family;

    my $id = $c->stash('id');
    my $existing = $c->db->get_fuel_log_by_id($id);
    return $c->render(json => { success => 0, error => 'Record not found' }) unless $existing;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless (($existing->{uploaded_by} // '') eq ($c->session('user') // '') || $c->is_admin);

    $c->db->delete_fuel_log_record($id);
    $c->render(json => {
        success => 1,
        summary => $c->db->get_fuel_summary(),
        message => 'Fuel log removed'
    });
}

# Serves a stored fuel image for thumbnails and review.
# Route: GET /fuel/serve/:id/:image
sub serve {
    my $c = shift;
    return $c->render(text => 'Unauthorized', status => 403) unless $c->is_logged_in && $c->is_family;

    my $id = $c->stash('id');
    my $image = $c->stash('image') || '1';
    my $log = $c->db->get_fuel_log_by_id($id);
    return $c->render(text => 'Not found', status => 404) unless $log;

    my $prefix = $image eq '2' ? 'image2' : 'image1';
    my $mime = $log->{"${prefix}_mime_type"} || 'application/octet-stream';
    my $data = $log->{"${prefix}_file_data"};
    return $c->render(text => 'Not found', status => 404) unless defined $data;

    $c->res->headers->content_type($mime);
    $c->render(data => $data);
}

# Runs or re-runs AI extraction for an existing log.
# Route: POST /fuel/api/ai_analyze/:id
sub api_ai_analyze {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in && $c->is_family;

    my $id = $c->stash('id');
    my $log = $c->db->get_fuel_log_by_id($id);
    return $c->render(json => { success => 0, error => 'Record not found' }) unless $log;
    return $c->render(json => { success => 0, error => 'No photos available to scan' })
        unless $log->{image1_file_data} && $log->{image2_file_data};

    $c->render_later;
    _analyze_and_update_log($c, $id)->then(sub {
        my $updated = $c->db->get_all_fuel_logs(1, 0, { id => $id }, $c->session('user'))->[0];
        my $data = {};
        eval { $data = decode_json($updated->{ai_json} || '{}'); };
        $c->render(json => { success => 1, data => $data, log => $updated });
    })->catch(sub {
        my $err = shift;
        $c->app->log->error("Fuel AI scan failure: $err");
        _mark_ai_failure($c, $id, ["AI extraction failed"]);
        $c->render(json => { success => 0, error => 'AI extraction failed' });
    });
}

# Creates a vehicle profile for future logs.
# Route: POST /fuel/api/vehicles/add
sub api_vehicle_add {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in && $c->is_family;

    my ($name, $make, $model, $year, $is_active, $err) = _vehicle_payload($c);
    return $c->render(json => { success => 0, error => $err }) if $err;

    eval { $c->db->create_fuel_vehicle($name, $make, $model, $year, $is_active); };
    if ($@) {
        $c->app->log->error("Fuel vehicle create failure: $@");
        return $c->render(json => { success => 0, error => 'Vehicle could not be saved' });
    }

    $c->render(json => { success => 1, vehicles => $c->db->get_all_fuel_vehicles(), message => 'Vehicle saved' });
}

# Updates a vehicle profile.
# Route: POST /fuel/api/vehicles/update/:id
sub api_vehicle_update {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in && $c->is_family;

    my $id = $c->stash('id');
    return $c->render(json => { success => 0, error => 'Invalid vehicle' }) unless $id && $id =~ /^\d+$/;

    my ($name, $make, $model, $year, $is_active, $err) = _vehicle_payload($c);
    return $c->render(json => { success => 0, error => $err }) if $err;

    eval { $c->db->update_fuel_vehicle($id, $name, $make, $model, $year, $is_active); };
    if ($@) {
        $c->app->log->error("Fuel vehicle update failure: $@");
        return $c->render(json => { success => 0, error => 'Vehicle could not be updated' });
    }

    $c->render(json => { success => 1, vehicles => $c->db->get_all_fuel_vehicles(), message => 'Vehicle updated' });
}

# Archives a vehicle profile.
# Route: POST /fuel/api/vehicles/delete/:id
sub api_vehicle_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in && $c->is_family;

    my $id = $c->stash('id');
    return $c->render(json => { success => 0, error => 'Invalid vehicle' }) unless $id && $id =~ /^\d+$/;

    $c->db->archive_fuel_vehicle($id);
    $c->render(json => { success => 1, vehicles => $c->db->get_all_fuel_vehicles(), message => 'Vehicle archived' });
}

# Builds a consistent metadata hash from an uploaded file.
sub _prepare_upload {
    my ($c, $upload, $prefix) = @_;

    my $max_size = 5 * 1024 * 1024;
    my $original = $upload->filename || "${prefix}.jpg";
    my $size = $upload->size || 0;
    my $mime = $upload->headers->content_type || 'application/octet-stream';
    return { error => 'Photo is too large. Please retry image processing or use manual entry.' } if $size > $max_size;

    my $data = $upload->asset->slurp;
    return { error => 'Only image uploads are supported' } unless _looks_like_image($data, $mime);

    my $filename = time . "_${prefix}_" . $original;
    $filename =~ s/[^a-zA-Z0-9._-]/_/g;

    return {
        "${prefix}_filename" => $filename,
        "${prefix}_original_filename" => $original,
        "${prefix}_mime_type" => $mime,
        "${prefix}_file_size" => $size,
        "${prefix}_file_data" => $data
    };
}

# Checks common image signatures before storing user-provided binary data.
sub _looks_like_image {
    my ($data, $mime) = @_;
    return 0 unless defined $data && length($data) >= 8;
    return 1 if $data =~ /^\xFF\xD8\xFF/s;
    return 1 if $data =~ /^\x89PNG\r\n\x1A\n/s;
    return 1 if $data =~ /^GIF8[79]a/s;
    return 1 if $data =~ /^RIFF.{4}WEBP/s;
    return 1 if substr($data, 4, 8) =~ /^ftyp(heic|heix|hevc|hevx|mif1|msf1)/;
    return (($mime // '') =~ m{^image/}) ? 1 : 0;
}

# Executes AI extraction and persists the normalized result.
sub _analyze_and_update_log {
    my ($c, $id) = @_;

    my $log = $c->db->get_fuel_log_by_id($id);
    return Mojo::Promise->reject('Record not found') unless $log;

    return $c->ai_analyze_fuel(
        $log->{image1_file_data}, $log->{image1_mime_type},
        $log->{image2_file_data}, $log->{image2_mime_type}
    )->then(sub {
        my $response = shift;
        my $json_text = _candidate_json_text($response);
        my $ai_data = $c->ai_decode_json($json_text);
        return Mojo::Promise->reject('Invalid AI JSON') unless $ai_data && ref($ai_data) eq 'HASH';
        delete $ai_data->{price_per_litre};
        delete $ai_data->{confidence}{price_per_litre} if ref($ai_data->{confidence}) eq 'HASH';

        my ($normalized, $reasons) = _normalize_ai_payload($c, $log, $ai_data);
        $normalized->{ai_json} = encode_json($ai_data);
        $normalized->{ai_status} = @$reasons ? 'needs_review' : 'complete';
        $normalized->{needs_review} = @$reasons ? 1 : 0;
        $normalized->{review_reasons} = encode_json($reasons);

        $c->db->update_fuel_log_data($id, $normalized);
        return $normalized;
    });
}

# Extracts the first structured text candidate from a normalized AI response.
sub _candidate_json_text {
    my ($data) = @_;
    return undef unless $data && $data->{candidates} && @{$data->{candidates}};
    my $text = $data->{candidates}[0]{content}{parts}[0]{text};
    return $text;
}

# Converts AI values into database-safe fields and review reasons.
sub _normalize_ai_payload {
    my ($c, $log, $ai) = @_;

    my @reasons;
    my $odometer = _positive_int($ai->{odometer});
    my $litres = _positive_decimal($ai->{litres});
    my $total = _positive_decimal($ai->{total_amount});
    my $discount = _non_negative_decimal($ai->{discount_per_litre});
    $discount = _non_negative_decimal($log->{discount_per_litre}) // 0 unless defined $discount;
    my $price = (defined $litres && $litres > 0 && defined $total)
        ? sprintf('%.3f', $total / $litres) + 0
        : undef;
    my $date = ($ai->{date} && $ai->{date} =~ /^\d{4}-\d{2}-\d{2}$/) ? $ai->{date} : ($log->{log_date} || $c->now->strftime('%Y-%m-%d'));

    push @reasons, 'missing odometer' unless defined $odometer;
    push @reasons, 'missing litres' unless defined $litres;
    push @reasons, 'missing total amount' unless defined $total;

    if ($ai->{needs_review}) {
        push @reasons, 'AI requested manual review';
    }

    if ($ai->{review_reasons} && ref($ai->{review_reasons}) eq 'ARRAY') {
        push @reasons, grep { defined $_ && $_ ne '' } @{$ai->{review_reasons}};
    }

    return ({
        vehicle_id => $log->{vehicle_id},
        log_date => $date,
        odometer => $odometer,
        litres => $litres,
        price_per_litre => $price,
        discount_per_litre => $discount,
        total_amount => $total,
        station_name => trim($ai->{station_name} // '') || undef,
        fill_type => (($log->{fill_type} // 'full') eq 'partial') ? 'partial' : 'full',
        description => $log->{description},
        ai_json => undef,
        ai_status => 'pending',
        needs_review => 1,
        review_reasons => undef
    }, \@reasons);
}

# Converts editor fields into database-safe values.
sub _extract_manual_payload {
    my ($c, $existing) = @_;

    my @reasons;
    my $vehicle_id = $c->param('vehicle_id');
    push @reasons, 'vehicle is required' unless $vehicle_id && $vehicle_id =~ /^\d+$/;

    my $log_date = $c->param('log_date') || $c->now->strftime('%Y-%m-%d');
    push @reasons, 'date is invalid' unless $log_date =~ /^\d{4}-\d{2}-\d{2}$/;

    my $odometer = _positive_int($c->param('odometer'));
    my $litres = _positive_decimal($c->param('litres'));
    my $discount = _non_negative_decimal($c->param('discount_per_litre'));
    my $total = _positive_decimal($c->param('total_amount'));
    my $price = (defined $litres && $litres > 0 && defined $total)
        ? sprintf('%.3f', $total / $litres) + 0
        : undef;
    push @reasons, 'odometer is required' unless defined $odometer;
    push @reasons, 'litres is required' unless defined $litres;
    push @reasons, 'discount is invalid' unless defined $discount;
    push @reasons, 'total amount is required' unless defined $total;

    my $fill_type = ($c->param('fill_type') // 'full') eq 'partial' ? 'partial' : 'full';
    my $description = trim($c->param('description') // '') || undef;
    my $station = trim($c->param('station_name') // '') || undef;

    return ({
        vehicle_id => $vehicle_id,
        log_date => $log_date,
        odometer => $odometer,
        litres => $litres,
        price_per_litre => $price,
        discount_per_litre => $discount,
        total_amount => $total,
        station_name => $station,
        fill_type => $fill_type,
        description => $description,
        ai_json => $existing->{ai_json},
        ai_status => 'complete',
        needs_review => 0,
        review_reasons => encode_json([])
    }, \@reasons);
}

# Converts manual entry fields into database-safe values.
sub _extract_manual_create_payload {
    my ($c) = @_;

    my @reasons;
    my $vehicle_id = $c->param('vehicle_id');
    push @reasons, 'vehicle is required' unless $vehicle_id && $vehicle_id =~ /^\d+$/;

    my $log_date = $c->param('log_date');
    push @reasons, 'date is required' unless defined $log_date && $log_date ne '';
    push @reasons, 'date is invalid' if defined $log_date && $log_date ne '' && $log_date !~ /^\d{4}-\d{2}-\d{2}$/;

    my $odometer = _positive_int($c->param('odometer'));
    my $litres = _positive_decimal($c->param('litres'));
    my $discount = _non_negative_decimal($c->param('discount_per_litre'));
    my $total = _positive_decimal($c->param('total_amount'));
    my $price = (defined $litres && $litres > 0 && defined $total)
        ? sprintf('%.3f', $total / $litres) + 0
        : undef;
    my $station = trim($c->param('station_name') // '');
    push @reasons, 'odometer is required' unless defined $odometer;
    push @reasons, 'litres is required' unless defined $litres;
    push @reasons, 'discount is invalid' unless defined $discount;
    push @reasons, 'total amount is required' unless defined $total;
    push @reasons, 'station is required' unless $station;

    my $fill_type = ($c->param('fill_type') // 'full') eq 'partial' ? 'partial' : 'full';
    my $description = trim($c->param('description') // '') || undef;

    return ({
        vehicle_id => $vehicle_id,
        log_date => $log_date,
        odometer => $odometer,
        litres => $litres,
        price_per_litre => $price,
        discount_per_litre => $discount,
        total_amount => $total,
        station_name => $station || undef,
        fill_type => $fill_type,
        description => $description
    }, \@reasons);
}

# Marks a log as requiring manual review after extraction failure.
sub _mark_ai_failure {
    my ($c, $id, $reasons) = @_;
    my $log = $c->db->get_fuel_log_by_id($id);
    return unless $log;
    $c->db->update_fuel_log_data($id, {
        vehicle_id => $log->{vehicle_id},
        log_date => $log->{log_date},
        odometer => $log->{odometer},
        litres => $log->{litres},
        price_per_litre => $log->{price_per_litre},
        discount_per_litre => $log->{discount_per_litre} // 0,
        total_amount => $log->{total_amount},
        station_name => $log->{station_name},
        fill_type => $log->{fill_type},
        description => $log->{description},
        ai_json => $log->{ai_json},
        ai_status => 'failed',
        needs_review => 1,
        review_reasons => encode_json($reasons || [])
    });
}

# Extracts validated vehicle fields from request parameters.
sub _vehicle_payload {
    my ($c) = @_;
    my $name = trim($c->param('name') // '');
    return (undef, undef, undef, undef, undef, 'Vehicle name is required') unless $name;

    my $make = trim($c->param('make') // '') || undef;
    my $model = trim($c->param('model') // '') || undef;
    my $year = $c->param('year');
    $year = undef unless defined $year && $year =~ /^\d{4}$/;
    my $is_active = (($c->param('is_active') // 1) eq '0') ? 0 : 1;

    return ($name, $make, $model, $year, $is_active, undef);
}

# Returns a positive integer or undef.
sub _positive_int {
    my ($value) = @_;
    return undef unless defined $value && $value =~ /^\d+$/;
    return int($value) > 0 ? int($value) : undef;
}

# Returns a positive decimal or undef.
sub _positive_decimal {
    my ($value) = @_;
    return undef unless defined $value && $value =~ /^\d+(?:\.\d+)?$/;
    return $value > 0 ? sprintf('%.3f', $value) + 0 : undef;
}

# Returns a zero-or-positive decimal or undef.
sub _non_negative_decimal {
    my ($value) = @_;
    return undef unless defined $value && $value =~ /^\d+(?:\.\d+)?$/;
    return $value >= 0 ? sprintf('%.3f', $value) + 0 : undef;
}

sub register_routes {
    my ($class, $r) = @_;
    $r->{family}->get('/fuel')->to('fuel#index');
    $r->{family}->get('/fuel/api/state')->to('fuel#api_state');
    $r->{family}->post('/fuel/api/upload')->to('fuel#api_upload');
    $r->{family}->post('/fuel/api/manual')->to('fuel#api_manual');
    $r->{family}->post('/fuel/api/update/:id')->to('fuel#api_update');
    $r->{family}->post('/fuel/api/delete/:id')->to('fuel#api_delete');
    $r->{family}->get('/fuel/serve/:id/:image')->to('fuel#serve');
    $r->{family}->post('/fuel/api/ai_analyze/:id')->to('fuel#api_ai_analyze');
    $r->{family}->post('/fuel/api/vehicles/add')->to('fuel#api_vehicle_add');
    $r->{family}->post('/fuel/api/vehicles/update/:id')->to('fuel#api_vehicle_update');
    $r->{family}->post('/fuel/api/vehicles/delete/:id')->to('fuel#api_vehicle_delete');
}

1;
