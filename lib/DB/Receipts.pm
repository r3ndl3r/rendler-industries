# /lib/DB/Receipts.pm

package DB::Receipts;

use strict;
use warnings;
use DBI qw(:sql_types);

# Database helper for binary receipt storage and management.
# Features:
#   - BLOB storage for receipt images/PDFs
#   - Metadata management (Store, Date, Total)
#   - Structured AI JSON storage
#   - Integration with family-level access control

# Stores a new receipt and its metadata in the database.
sub DB::store_receipt {
    my ($self, $filename, $original_filename, $mime_type, $file_size, $file_data, $uploaded_by, $store_name, $receipt_date, $total_amount, $description) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare(
        "INSERT INTO receipts (filename, original_filename, mime_type, file_size, file_data, uploaded_by, store_name, receipt_date, total_amount, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    
    $sth->bind_param(1, $filename);
    $sth->bind_param(2, $original_filename);
    $sth->bind_param(3, $mime_type);
    $sth->bind_param(4, $file_size);
    $sth->bind_param(5, $file_data, SQL_BLOB);
    $sth->bind_param(6, $uploaded_by);
    $sth->bind_param(7, $store_name);
    $sth->bind_param(8, $receipt_date);
    $sth->bind_param(9, $total_amount);
    $sth->bind_param(10, $description);
    
    $sth->execute();
    
    return $self->{dbh}->last_insert_id(undef, undef, 'receipts', 'id');
}

# Retrieves full receipt record by ID.
sub DB::get_receipt_by_id {
    my ($self, $id) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("SELECT * FROM receipts WHERE id = ?");
    $sth->execute($id);
    return $sth->fetchrow_hashref();
}

# Retrieves metadata for all receipts with optional pagination.
sub DB::get_all_receipts_metadata {
    my ($self, $limit, $offset) = @_;
    $self->ensure_connection;
    
    my $sql = "SELECT id, filename, original_filename, mime_type, file_size, uploaded_by, uploaded_at, store_name, receipt_date, 
               DATE_FORMAT(receipt_date, '%d-%m-%Y') as formatted_date, total_amount, description, notes, ai_json
               FROM receipts ORDER BY receipt_date DESC, uploaded_at DESC";
               
    if (defined $limit) {
        $sql .= " LIMIT " . int($limit);
        if (defined $offset) {
            $sql .= " OFFSET " . int($offset);
        }
    }

    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute();
    return $sth->fetchall_arrayref({});
}

# Retrieves a unique list of all previously entered store names.
sub DB::get_unique_store_names {
    my ($self) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("SELECT DISTINCT store_name FROM receipts WHERE store_name IS NOT NULL AND store_name != '' ORDER BY store_name ASC");
    $sth->execute();
    return [ map { $_->[0] } @{$sth->fetchall_arrayref()} ];
}

# Updates the metadata for a receipt.
sub DB::update_receipt_data {
    my ($self, $id, $store_name, $receipt_date, $total_amount, $notes, $ai_json) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("UPDATE receipts SET store_name = ?, receipt_date = ?, total_amount = ?, notes = ?, ai_json = ? WHERE id = ?");
    $sth->execute($store_name, $receipt_date, $total_amount, $notes, $ai_json, $id);
}

# Updates structured AI JSON only.
sub DB::update_receipt_ai_json {
    my ($self, $id, $json) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("UPDATE receipts SET ai_json = ? WHERE id = ?");
    $sth->execute($json, $id);
}

# Updates the raw binary data for a receipt (Used by Cropper).
sub DB::update_receipt_binary {
    my ($self, $id, $file_data, $file_size) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("UPDATE receipts SET file_data = ?, file_size = ? WHERE id = ?");
    $sth->bind_param(1, $file_data, SQL_BLOB);
    $sth->bind_param(2, $file_size);
    $sth->bind_param(3, $id);
    $sth->execute();
}

# Permanently removes a receipt record.
sub DB::delete_receipt_record {
    my ($self, $id) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("DELETE FROM receipts WHERE id = ?");
    $sth->execute($id);
}

# Calculates spending aggregates for the dashboard tiles.
sub DB::get_spending_summary {
    my ($self) = @_;
    $self->ensure_connection;
    my $sql = <<'SQL';
        SELECT 
            COALESCE(SUM(CASE WHEN receipt_date >= DATE_SUB(CURDATE(), INTERVAL (WEEKDAY(CURDATE())) DAY) THEN total_amount ELSE 0 END), 0) as week_total,
            COALESCE(SUM(CASE WHEN receipt_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN total_amount ELSE 0 END), 0) as month_total,
            COALESCE(SUM(CASE WHEN receipt_date >= DATE_FORMAT(CURDATE(), '%Y-01-01') THEN total_amount ELSE 0 END), 0) as year_total
        FROM receipts
SQL
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute();
    return $sth->fetchrow_hashref() // { week_total => 0, month_total => 0, year_total => 0 };
}

# Retrieves top stores by spending for each period.
sub DB::get_store_spending_breakdown {
    my ($self, $limit) = @_;
    $limit //= 5;
    $self->ensure_connection;
    my %breakdown = ( week => [], month => [], year => [] );
    my $queries = {
        week  => "receipt_date >= DATE_SUB(CURDATE(), INTERVAL (WEEKDAY(CURDATE())) DAY)",
        month => "receipt_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')",
        year  => "receipt_date >= DATE_FORMAT(CURDATE(), '%Y-01-01')"
    };
    for my $period (keys %$queries) {
        my $sql = "SELECT store_name, SUM(total_amount) as total 
                   FROM receipts 
                   WHERE $queries->{$period} AND store_name IS NOT NULL AND store_name != ''
                   GROUP BY TRIM(LOWER(store_name)) 
                   ORDER BY total DESC 
                   LIMIT ?";
        my $sth = $self->{dbh}->prepare($sql);
        $sth->execute($limit);
        $breakdown{$period} = $sth->fetchall_arrayref({});
    }
    return \%breakdown;
}

1;
