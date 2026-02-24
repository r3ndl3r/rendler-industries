# /lib/DB/Receipts.pm

package DB::Receipts;

use strict;
use warnings;
use DBI qw(:sql_types);

# Database helper for binary receipt storage and management.
# Features:
#   - BLOB storage for receipt images/PDFs
#   - Metadata management (Store, Date, Total)
#   - Manual tagging support (pre-OCR capability)
#   - Integration with family-level access control

# Stores a new receipt and its metadata in the database.
# Parameters:
#   filename          : Unique system filename
#   original_filename : Original name uploaded by user
#   mime_type         : MIME type string
#   file_size         : Size in bytes
#   file_data         : Binary content (BLOB)
#   uploaded_by       : Username of uploader
#   store_name        : Name of the merchant
#   receipt_date      : Date on the receipt (YYYY-MM-DD)
#   total_amount      : Total currency value
#   description       : Optional text description
# Returns:
#   Integer ID of the newly inserted record
sub DB::store_receipt {
    my ($self, $filename, $original_filename, $mime_type, $file_size, $file_data, $uploaded_by, $store_name, $receipt_date, $total_amount, $description, $raw_text) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare(
        "INSERT INTO receipts (filename, original_filename, mime_type, file_size, file_data, uploaded_by, store_name, receipt_date, total_amount, description, raw_text)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
    $sth->bind_param(11, $raw_text);
    
    $sth->execute();
    
    return $self->{dbh}->last_insert_id(undef, undef, 'receipts', 'id');
}

# Retrieves full receipt record by ID.
# Parameters:
#   id : Unique ID of the receipt
# Returns:
#   HashRef containing all fields including binary data, or undef if not found
sub DB::get_receipt_by_id {
    my ($self, $id) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT * FROM receipts WHERE id = ?");
    $sth->execute($id);
    
    return $sth->fetchrow_hashref();
}

# Retrieves metadata for all receipts.
# Parameters: None
# Returns:
#   ArrayRef of HashRefs containing receipt details (excluding binary content)
sub DB::get_all_receipts_metadata {
    my ($self) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare(
        "SELECT id, filename, original_filename, mime_type, file_size, uploaded_by, uploaded_at, store_name, receipt_date, 
        DATE_FORMAT(receipt_date, '%d-%m-%Y') as formatted_date, total_amount, description
        FROM receipts ORDER BY receipt_date DESC, uploaded_at DESC"
    );
    
    $sth->execute();
    
    return $sth->fetchall_arrayref({});
}

# Retrieves a unique list of all previously entered store names.
# Parameters: None
# Returns:
#   ArrayRef of strings (sorted alphabetically)
sub DB::get_unique_store_names {
    my ($self) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("SELECT DISTINCT store_name FROM receipts WHERE store_name IS NOT NULL AND store_name != '' ORDER BY store_name ASC");
    $sth->execute();
    return [ map { $_->[0] } @{$sth->fetchall_arrayref()} ];
}

# Updates the manual/OCR data for a receipt.
# Parameters:
#   id           : Unique ID of the receipt
#   store_name   : Updated store name
#   receipt_date : Updated date
#   total_amount : Updated total
#   raw_text     : OCR extracted text (if available)
# Returns:
#   Result of execute() (true on success)
sub DB::update_receipt_data {
    my ($self, $id, $store_name, $receipt_date, $total_amount, $raw_text) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("UPDATE receipts SET store_name = ?, receipt_date = ?, total_amount = ?, raw_text = ? WHERE id = ?");
    $sth->execute($store_name, $receipt_date, $total_amount, $raw_text, $id);
}

# Permanently removes a receipt record.
# Parameters:
#   id : Unique ID of the receipt
# Returns:
#   Result of execute() (true on success)
sub DB::delete_receipt_record {
    my ($self, $id) = @_;
    
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("DELETE FROM receipts WHERE id = ?");
    $sth->execute($id);
}

# Calculates spending aggregates for the dashboard tiles.
# Returns: HashRef with week, month, year totals
sub DB::get_spending_summary {
    my ($self) = @_;
    $self->ensure_connection;

    # Weekly: Sum since most recent Monday
    # Monthly: Sum since 1st of current month
    # Yearly: Sum since Jan 1st of current year
    my $sql = <<'SQL';
        SELECT 
            SUM(CASE WHEN receipt_date >= DATE_SUB(CURDATE(), INTERVAL (WEEKDAY(CURDATE())) DAY) THEN total_amount ELSE 0 END) as week_total,
            SUM(CASE WHEN receipt_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN total_amount ELSE 0 END) as month_total,
            SUM(CASE WHEN receipt_date >= DATE_FORMAT(CURDATE(), '%Y-01-01') THEN total_amount ELSE 0 END) as year_total
        FROM receipts
SQL

    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute();
    return $sth->fetchrow_hashref() // { week_total => 0, month_total => 0, year_total => 0 };
}

# Retrieves top stores by spending for each period.
# Parameters:
#   limit : Max number of stores to return per period (Default: 5)
# Returns: HashRef with arrays for week, month, year
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
                   GROUP BY store_name 
                   ORDER BY total DESC 
                   LIMIT ?";
        my $sth = $self->{dbh}->prepare($sql);
        $sth->execute($limit);
        $breakdown{$period} = $sth->fetchall_arrayref({});
    }

    return \%breakdown;
}

1;
