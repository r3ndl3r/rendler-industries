# /lib/MyApp/Controller/Receipts.pm

package MyApp::Controller::Receipts;

use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);
use OCR;

# Controller for Receipt management.
# Features:
#   - Binary upload and storage
#   - Metadata tagging for Store, Date, and Total
#   - Family-restricted access (via MyApp.pm bridge)
# Integration points:
#   - Uses DB::Receipts for storage and metadata retrieval

# Renders the receipt list dashboard.
# Route: GET /receipts
# Parameters: None
# Returns: Rendered receipts/index.html.ep
sub index {
    my $c = shift;
    
    # Fetch lightweight metadata (excludes heavy BLOB content for performance)
    my $receipts = $c->db->get_all_receipts_metadata();
    my $store_names = $c->db->get_unique_store_names();
    
    # Fetch spending summaries for dashboard tiles
    my $summary   = $c->db->get_spending_summary();
    my $breakdown = $c->db->get_store_spending_breakdown(3); # Limit to top 3 per tile
    
    $c->render('receipts/index', 
        receipts    => $receipts, 
        store_names => $store_names,
        summary     => $summary,
        breakdown   => $breakdown
    );
}

# Renders the receipt upload form.
# Route: GET /receipts/upload
# Parameters: None
# Returns: Rendered receipts/upload.html.ep
sub upload_form {
    my $c = shift;
    my $store_names = $c->db->get_unique_store_names();
    $c->render('receipts/upload', store_names => $store_names);
}

# Processes a new receipt upload.
# Route: POST /receipts
# Parameters:
#   file         : Upload object (Image/PDF)
#   store_name   : Form text input
#   receipt_date : Form date input
#   total_amount : Form decimal input
#   description  : Form text input
# Returns: 
#   Redirects to ledger on success
#   Renders error on validation failure or DB error
sub upload {
    my $c = shift;
    
    # Validate file presence
    my $upload = $c->param('file');
    unless ($upload) {
        return $c->render_error("No file uploaded", 400);
    }
    
    # Extract file metadata
    my $original_filename = $upload->filename;
    my $file_size = $upload->size || 0;
    my $mime_type = $upload->headers->content_type || 'application/octet-stream';

    # Enforce file size limit (1GB)
    if ($file_size > 1024 * 1024 * 1024) {
        return $c->render_error("File too large (Max 1GB)", 413);
    }
    
    # Read file content into memory (Slurp from asset for efficiency)
    my $file_data = $upload->asset->slurp;
    
    # User requested to preserve original filenames
    my $filename = $original_filename;
    
    # Metadata tagging (Normalize empty strings to undef for DB NULL)
    my $store_name   = $c->param('store_name') ? trim($c->param('store_name')) : undef;
    my $receipt_date = $c->param('receipt_date') || undef;
    my $total_amount = $c->param('total_amount') || undef;
    my $description  = $c->param('description') ? trim($c->param('description')) : undef;
    
    my $username = $c->session('user');

    # --- Automated OCR Processing ---
    # Attempt to extract metadata automatically if it's an image
    my $raw_text = undef;
    if ($mime_type =~ /^image/) {
        my $ocr_data = OCR->process_receipt($file_data);
        
        # Merge OCR findings if the user left fields blank
        $store_name   ||= $ocr_data->{store_name};
        $receipt_date ||= $ocr_data->{receipt_date};
        $total_amount ||= $ocr_data->{total_amount};
        $raw_text = $ocr_data->{raw_text};
    }

    # If date is still not found (neither manually entered nor via OCR), use current date
    unless ($receipt_date) {
        require DateTime;
        $receipt_date = DateTime->now(time_zone => 'Australia/Melbourne')->strftime('%Y-%m-%d');
    }

    # Persist receipt to database
    my $id;
    eval {
        $id = $c->db->store_receipt(
            $filename, $original_filename, $mime_type, $file_size, $file_data,
            $username, $store_name, $receipt_date, $total_amount, $description, $raw_text
        );
    };
    
    if ($@) {
        return $c->render_error("Database failed to store receipt: $@", 500);
    }
    
    if ($id) {
        $c->flash(message => "Receipt successfully uploaded.");
        return $c->redirect_to('/receipts');
    } else {
        return $c->render_error("Database failed to assign an ID to the receipt", 500);
    }
}

# Updates metadata for an existing receipt.
# Route: POST /receipts/update/:id
# Parameters:
#   id           : Unique Receipt ID
#   store_name   : Updated merchant name
#   receipt_date : Updated date string
#   total_amount : Updated currency value
#   description  : Updated notes
# Returns:
#   Redirects to ledger on success
sub update {
    my $c = shift;
    my $id = $c->param('id');
    
    # Verify receipt existence before update
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render_error("Receipt not found", 404) unless $receipt;
    
    # PERMISSION: Only uploader or admin can edit
    unless ($c->session('user') eq $receipt->{uploaded_by} || $c->is_admin) {
        return $c->render_error("Access Denied", 403);
    }
    
    # Process metadata updates (Normalize for DB NULL)
    my $store_name   = $c->param('store_name') ? trim($c->param('store_name')) : undef;
    my $receipt_date = $c->param('receipt_date') || undef;
    my $total_amount = $c->param('total_amount') || undef;
    my $description  = $c->param('description') ? trim($c->param('description')) : undef;
    
    # Execute database update
    eval {
        $c->db->update_receipt_data($id, $store_name, $receipt_date, $total_amount, $receipt->{raw_text});
    };
    
    if ($@) {
        return $c->render_error("Database failed to update receipt: $@", 500);
    }
    
    $c->flash(message => "Receipt details updated.");
    return $c->redirect_to('/receipts');
}

# Processes a client-side cropped image update.
# Route: POST /receipts/crop/:id
# Parameters:
#   id            : Unique Receipt ID
#   cropped_image : Multipart binary Blob from Cropper.js
# Returns:
#   JSON: { success => 1/0, error => "..." }
sub crop {
    my $c = shift;
    my $id = $c->param('id');
    
    # Validation
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render(json => { success => 0, error => "Receipt not found" }, status => 404) unless $receipt;
    
    # PERMISSION: Only uploader or admin can edit
    unless ($c->session('user') eq $receipt->{uploaded_by} || $c->is_admin) {
        return $c->render(json => { success => 0, error => "Access Denied" }, status => 403);
    }

    # Get the cropped blob from the request
    my $upload = $c->param('cropped_image');
    return $c->render(json => { success => 0, error => "No image data received" }, status => 400) unless $upload;

    my $file_data = $upload->asset->slurp;
    my $file_size = $upload->size;

    eval {
        $c->db->update_receipt_binary($id, $file_data, $file_size);
    };

    if ($@) {
        $c->app->log->error("Failed to update receipt binary for ID $id: $@");
        return $c->render(json => { success => 0, error => "Database failure" }, status => 500);
    }

    $c->flash(message => "Receipt image successfully cropped.");
    return $c->render(json => { success => 1 });
}

# Permanently deletes a receipt.
# Route: POST /receipts/delete/:id
# Parameters:
#   id : Unique Receipt ID
# Returns:
#   Redirects to ledger on success
sub delete {
    my $c = shift;
    my $id = $c->param('id');
    
    # Verify existence
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render_error("Receipt not found", 404) unless $receipt;
    
    # PERMISSION: Only uploader or admin can delete
    unless ($c->session('user') eq $receipt->{uploaded_by} || $c->is_admin) {
        return $c->render_error("Access Denied", 403);
    }
    
    # Execute removal
    if ($c->db->delete_receipt_record($id)) {
        $c->flash(message => "Receipt permanently deleted.");
    } else {
        $c->flash(error => "Failed to delete receipt.");
    }
    
    return $c->redirect_to('/receipts');
}

# Serves raw binary content with correct headers.
# Route: GET /receipts/serve/:id
# Parameters:
#   id : Unique Receipt ID
# Returns:
#   Binary content with Content-Type and Disposition headers
sub serve {
    my $c = shift;
    my $id = $c->param('id');
    
    # Retrieve record
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render_error("Receipt not found", 404) unless $receipt;
    
    # Set transmission headers
    $c->res->headers->content_type($receipt->{mime_type});
    $c->res->headers->content_disposition("inline; filename=\"" . $receipt->{original_filename} . "\"");
    
    return $c->render(data => $receipt->{file_data});
}

# AJAX: Manual OCR trigger for existing receipts.
# Route: POST /receipts/ocr/:id
# Parameters:
#   id : Unique Receipt ID
# Returns: JSON object with extracted metadata
sub trigger_ocr {
    my $c = shift;
    my $id = $c->param('id');
    
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render(json => { error => "Not found" }, status => 404) unless $receipt;
    
    if ($receipt->{mime_type} !~ /^image/) {
        return $c->render(json => { error => "Only images are supported for OCR" }, status => 400);
    }
    
    my $ocr_data = OCR->process_receipt($receipt->{file_data});
    
    # Optional: Persist the raw text to DB even during manual trigger if not already there
    eval {
        $c->db->update_receipt_data($id, $ocr_data->{store_name} || $receipt->{store_name}, $ocr_data->{receipt_date} || $receipt->{receipt_date}, $ocr_data->{total_amount} || $receipt->{total_amount}, $ocr_data->{raw_text});
    };
    
    return $c->render(json => {
        success      => 1,
        store_name   => $ocr_data->{store_name},
        receipt_date => $ocr_data->{receipt_date},
        total_amount => $ocr_data->{total_amount},
        raw_text     => $ocr_data->{raw_text},
    });
}

1;
