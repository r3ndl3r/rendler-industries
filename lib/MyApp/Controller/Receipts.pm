# /lib/MyApp/Controller/Receipts.pm

package MyApp::Controller::Receipts;

use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(b64_encode trim);
use Mojo::JSON qw(decode_json encode_json);
use OCR;

# Controller for Receipt management.
# Features:
#   - Binary upload and storage
#   - Metadata tagging for Store, Date, and Total
#   - AI-powered Electronic Receipt generation (Gemini)
# Integration points:
#   - Uses DB::Receipts for storage and metadata retrieval

# Renders the receipt list dashboard.
sub index {
    my $c = shift;
    my $receipts = $c->db->get_all_receipts_metadata();
    my $store_names = $c->db->get_unique_store_names();
    my $summary   = $c->db->get_spending_summary();
    my $breakdown = $c->db->get_store_spending_breakdown(3);
    
    $c->render('receipts/index', 
        receipts    => $receipts, 
        store_names => $store_names,
        summary     => $summary,
        breakdown   => $breakdown
    );
}

# Renders the receipt upload form.
sub upload_form {
    my $c = shift;
    my $store_names = $c->db->get_unique_store_names();
    $c->render('receipts/upload', store_names => $store_names);
}

# Processes a new receipt upload.
sub upload {
    my $c = shift;
    my $upload = $c->param('file');
    unless ($upload) { return $c->render_error("No file uploaded", 400); }
    
    my $original_filename = $upload->filename;
    my $file_size = $upload->size || 0;
    my $mime_type = $upload->headers->content_type || 'application/octet-stream';
    if ($file_size > 1024 * 1024 * 1024) { return $c->render_error("File too large (Max 1GB)", 413); }
    
    my $file_data = $upload->asset->slurp;
    my $store_name   = $c->param('store_name') ? trim($c->param('store_name')) : undef;
    my $receipt_date = $c->param('receipt_date') || undef;
    my $total_amount = $c->param('total_amount') || undef;
    my $description  = $c->param('description') ? trim($c->param('description')) : undef;
    my $username = $c->session('user');

    # Attempt OCR for metadata suggestion ONLY (do not store raw text anymore)
    if (!$store_name || !$receipt_date || !$total_amount) {
        if ($mime_type =~ /^image/) {
            my $ocr_data = OCR->process_receipt($file_data);
            $store_name   ||= $ocr_data->{store_name};
            $receipt_date ||= $ocr_data->{receipt_date};
            $total_amount ||= $ocr_data->{total_amount};
        }
    }

    unless ($receipt_date) {
        require DateTime;
        $receipt_date = DateTime->now(time_zone => 'Australia/Melbourne')->strftime('%Y-%m-%d');
    }

    eval {
        $c->db->store_receipt(
            $original_filename, $original_filename, $mime_type, $file_size, $file_data,
            $username, $store_name, $receipt_date, $total_amount, $description
        );
    };
    
    if ($@) { return $c->render_error("Database failed to store receipt: $@", 500); }
    
    $c->flash(message => "Receipt successfully uploaded.");
    return $c->redirect_to('/receipts');
}

# Updates metadata for an existing receipt.
sub update {
    my $c = shift;
    my $id = $c->param('id');
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render_error("Receipt not found", 404) unless $receipt;
    
    unless ($c->session('user') eq $receipt->{uploaded_by} || $c->is_admin) {
        return $c->render_error("Access Denied", 403);
    }
    
    my $store_name   = $c->param('store_name') ? trim($c->param('store_name')) : undef;
    my $receipt_date = $c->param('receipt_date') || undef;
    my $total_amount = $c->param('total_amount') || undef;
    my $notes        = $c->param('description') ? trim($c->param('description')) : undef;
    
    eval {
        $c->db->update_receipt_data($id, $store_name, $receipt_date, $total_amount, $notes, $receipt->{ai_json});
    };
    
    if ($@) { return $c->render_error("Database failed to update receipt: $@", 500); }
    
    $c->flash(message => "Receipt details updated.");
    return $c->redirect_to('/receipts');
}

# Processes a client-side cropped image update.
sub crop {
    my $c = shift;
    my $id = $c->param('id');
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render(json => { success => 0, error => "Receipt not found" }, status => 404) unless $receipt;
    
    unless ($c->session('user') eq $receipt->{uploaded_by} || $c->is_admin) {
        return $c->render(json => { success => 0, error => "Access Denied" }, status => 403);
    }

    my $upload = $c->param('cropped_image');
    return $c->render(json => { success => 0, error => "No image data received" }, status => 400) unless $upload;

    my $file_data = $upload->asset->slurp;
    my $file_size = $upload->size;

    eval { $c->db->update_receipt_binary($id, $file_data, $file_size); };
    if ($@) { return $c->render(json => { success => 0, error => "Database failure" }, status => 500); }

    $c->flash(message => "Receipt image successfully cropped.");
    return $c->render(json => { success => 1 });
}

# Permanently deletes a receipt.
sub delete {
    my $c = shift;
    my $id = $c->param('id');
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render_error("Receipt not found", 404) unless $receipt;
    
    unless ($c->session('user') eq $receipt->{uploaded_by} || $c->is_admin) {
        return $c->render_error("Access Denied", 403);
    }
    
    $c->db->delete_receipt_record($id);
    $c->flash(message => "Receipt permanently deleted.");
    return $c->redirect_to('/receipts');
}

# Serves raw binary content.
sub serve {
    my $c = shift;
    my $id = $c->param('id');
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render_error("Receipt not found", 404) unless $receipt;
    $c->res->headers->content_type($receipt->{mime_type});
    $c->res->headers->content_disposition("inline; filename=\"" . $receipt->{original_filename} . "\"");
    return $c->render(data => $receipt->{file_data});
}

# AJAX: Manual OCR trigger for metadata extraction.
sub trigger_ocr {
    my $c = shift;
    my $id = $c->param('id');
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render(json => { error => "Not found" }, status => 404) unless $receipt;
    
    if ($receipt->{mime_type} !~ /^image/) {
        return $c->render(json => { error => "Only images are supported for OCR" }, status => 400);
    }
    
    my $ocr_data = OCR->process_receipt($receipt->{file_data});
    return $c->render(json => {
        success      => 1,
        store_name   => $ocr_data->{store_name},
        receipt_date => $ocr_data->{receipt_date},
        total_amount => $ocr_data->{total_amount},
    });
}

# AJAX: AI-powered structured receipt extraction.
sub ai_analyze {
    my $c = shift;
    my $id = $c->param('id');
    my $force = $c->param('force') || 0;
    
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render(json => { success => 0, error => "Receipt not found" }, status => 404) unless $receipt;

    # Check ai_json column for existing analysis
    if (!$force && $receipt->{ai_json}) {
        eval {
            my $existing = decode_json($receipt->{ai_json});
            if (ref($existing) eq 'HASH' && $existing->{store_name}) {
                return $c->render(json => { success => 1, cached => 1, data => $existing });
            }
        };
    }
    
    if ($receipt->{mime_type} !~ /^image/) {
        return $c->render(json => { success => 0, error => "Only images supported" }, status => 400);
    }

    my $api_key = $c->db->get_gemini_key();
    my $active_model = $c->db->get_gemini_active_model();
    unless ($api_key) { return $c->render(json => { success => 0, error => "AI key missing" }); }

    my $endpoint = "https://generativelanguage.googleapis.com/v1beta/models/$active_model:generateContent";
    my $system_prompt = "You are a professional receipt digitizer. Analyze the image and extract data into a JSON object.
    
    CRITICAL INSTRUCTIONS:
    1. DATE: Be extremely careful. Today is Feb 2026. If you see '23.02.26', the year is 2026. Return as YYYY-MM-DD.
    2. Items: Extract array of {desc, qty, unit_price, line_total}.
    3. Metadata: Extract store_name, location, date (YYYY-MM-DD), time (HH:MM), total_amount, currency, and payment_method.
    4. ONLY return valid JSON.";

    my $ua = Mojo::UserAgent->new->request_timeout(45);
    my $tx = $ua->post("$endpoint?key=$api_key" => json => {
        contents => [{
            role => 'user',
            parts => [{ text => "Digitize this receipt accurately." }, { inlineData => { mimeType => $receipt->{mime_type}, data => b64_encode($receipt->{file_data}, '') } }]
        }],
        system_instruction => { parts => [{ text => $system_prompt }] },
        generationConfig => { temperature => 0.1, response_mime_type => "application/json" }
    });

    my $res = $tx->res;
    if ($res->json && $res->json->{candidates}) {
        my $json_text = $res->json->{candidates}[0]{content}{parts}[0]{text};
        if ($json_text =~ /(\{.*\})/s) { $json_text = $1; }
        my $extracted;
        eval { $extracted = decode_json($json_text); };
        if ($extracted) {
            $c->db->update_receipt_ai_json($id, $json_text);
            return $c->render(json => { success => 1, cached => 0, data => $extracted });
        }
    }
    return $c->render(json => { success => 0, error => "AI failure." });
}

1;
