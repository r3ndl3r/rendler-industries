# /lib/MyApp/Controller/Receipts.pm

package MyApp::Controller::Receipts;

use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(b64_encode trim);
use Mojo::JSON qw(decode_json encode_json);
use OCR;

# Controller for Receipt management and AI-powered digitization.
# Features:
#   - Binary upload and persistent storage of receipt images
#   - Metadata tagging (Store, Date, Total) with OCR assistance
#   - AJAX-powered pagination for large ledgers
#   - Gemini 2.0 AI integration for high-fidelity electronic receipts
#   - Client-side image cropping and refinement
# Integration points:
#   - Restricted to family members via router bridge
#   - Depends on DB::Receipts for binary and structured storage
#   - Leverages global Gemini API configuration from Settings

# Renders the main receipt ledger with spending summaries.
# Route: GET /receipts
# Parameters: None
# Returns:
#   Rendered HTML template 'receipts/index' with:
#     - receipts: Initial 10 metadata records
#     - summary: Weekly/Monthly/Yearly spend totals
#     - breakdown: Top store spending lists
sub index {
    my $c = shift;
    
    # Fetch initial 10 receipts for instant load
    my $receipts = $c->db->get_all_receipts_metadata(10, 0);
    my $store_names = $c->db->get_unique_store_names();
    
    # Fetch spending summaries for dashboard tiles
    my $summary   = $c->db->get_spending_summary();
    my $breakdown = $c->db->get_store_spending_breakdown(3);
    
    $c->render('receipts/index', 
        receipts    => $receipts, 
        store_names => $store_names,
        summary     => $summary,
        breakdown   => $breakdown
    );
}

# API endpoint for lazy-loading receipt metadata via AJAX.
# Route: GET /api/receipts/list
# Parameters:
#   offset: Number of records to skip
# Returns:
#   JSON: { success, receipts, current_user, is_admin }
sub api_list {
    my $c = shift;
    my $offset = int($c->param('offset') // 0);
    my $limit  = 10;
    
    my $receipts = $c->db->get_all_receipts_metadata($limit, $offset);
    
    $c->render(json => {
        success  => 1,
        receipts => $receipts,
        current_user => $c->session('user'),
        is_admin     => $c->is_admin
    });
}

# Renders the receipt upload interface.
# Route: GET /receipts/upload
sub upload_form {
    my $c = shift;
    my $store_names = $c->db->get_unique_store_names();
    $c->render('receipts/upload', store_names => $store_names);
}

# Processes a new receipt upload with automated OCR suggestion.
# Route: POST /receipts
# Parameters:
#   file: Binary upload object
#   store_name, receipt_date, total_amount, description: Form fields
sub upload {
    my $c = shift;
    
    my $upload = $c->param('file');
    unless ($upload) { return $c->render_error("No file uploaded", 400); }
    
    my $original_filename = $upload->filename;
    my $file_size = $upload->size || 0;
    my $mime_type = $upload->headers->content_type || 'application/octet-stream';

    if ($file_size > 1024 * 1024 * 1024) {
        return $c->render_error("File too large (Max 1GB)", 413);
    }
    
    my $file_data = $upload->asset->slurp;
    my $store_name   = $c->param('store_name') ? trim($c->param('store_name')) : undef;
    my $receipt_date = $c->param('receipt_date') || undef;
    my $total_amount = $c->param('total_amount') || undef;
    my $description  = $c->param('description') ? trim($c->param('description')) : undef;
    my $username = $c->session('user');

    # Attempt OCR for metadata suggestion ONLY if fields are blank
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
    
    if ($@) {
        return $c->render_error("Database failure: $@", 500);
    }
    
    $c->flash(message => "Receipt successfully uploaded.");
    return $c->redirect_to('/receipts');
}

# Updates metadata for an existing receipt.
# Route: POST /receipts/update/:id
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
    
    if ($@) { return $c->render_error("Database failure: $@", 500); }
    
    $c->flash(message => "Receipt details updated.");
    return $c->redirect_to('/receipts');
}

# Processes a client-side cropped image update via AJAX.
# Route: POST /receipts/crop/:id
sub crop {
    my $c = shift;
    my $id = $c->param('id');
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render(json => { success => 0, error => "Receipt not found" }, status => 404) unless $receipt;
    
    unless ($c->session('user') eq $receipt->{uploaded_by} || $c->is_admin) {
        return $c->render(json => { success => 0, error => "Access Denied" }, status => 403);
    }

    my $upload = $c->param('cropped_image');
    return $c->render(json => { success => 0, error => "No data received" }, status => 400) unless $upload;

    my $file_data = $upload->asset->slurp;
    my $file_size = $upload->size;

    eval { $c->db->update_receipt_binary($id, $file_data, $file_size); };
    if ($@) { return $c->render(json => { success => 0, error => "Database failure" }, status => 500); }

    $c->flash(message => "Receipt image successfully refined.");
    return $c->render(json => { success => 1 });
}

# Permanently deletes a receipt and its associated metadata.
# Route: POST /receipts/delete/:id
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

# Serves raw binary content with correct MIME headers.
# Route: GET /receipts/serve/:id
sub serve {
    my $c = shift;
    my $id = $c->param('id');
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render_error("Receipt not found", 404) unless $receipt;
    $c->res->headers->content_type($receipt->{mime_type});
    $c->res->headers->content_disposition("inline; filename=\"" . $receipt->{original_filename} . "\"");
    return $c->render(data => $receipt->{file_data});
}

# API Endpoint: Manual OCR Scan - Extracts basic metadata from an existing image.
# Route: POST /receipts/ocr/:id
# Parameters:
#   - id: Unique receipt ID.
# Returns:
#   JSON: { success, store_name, receipt_date, total_amount, raw_text }
sub trigger_ocr {
    my $c = shift;
    my $id = $c->param('id');
    
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render(json => { success => 0, error => "Receipt not found" }, status => 404) unless $receipt;
    
    if ($receipt->{mime_type} !~ /^image/) {
        return $c->render(json => { success => 0, error => "Only images supported for OCR" });
    }

    eval {
        my $ocr_data = OCR->process_receipt($receipt->{file_data});
        # Only update if we found something useful
        if ($ocr_data->{store_name} || $ocr_data->{total_amount}) {
            $c->db->update_receipt_data(
                $id, 
                $ocr_data->{store_name} || $receipt->{store_name}, 
                $ocr_data->{receipt_date} || $receipt->{receipt_date}, 
                $ocr_data->{total_amount} || $receipt->{total_amount}, 
                $receipt->{notes} || $receipt->{description},
                $receipt->{ai_json}
            );
        }
        
        $c->render(json => {
            success      => 1,
            store_name   => $ocr_data->{store_name},
            receipt_date => $ocr_data->{receipt_date},
            total_amount => $ocr_data->{total_amount},
            notes        => $receipt->{notes} || $receipt->{description},
            raw_text     => $ocr_data->{raw_text}
        });
    };
    
    if ($@) {
        $c->app->log->error("OCR Trigger Failed for receipt $id: $@");
        $c->render(json => { success => 0, error => "OCR engine failed." });
    }
}

# AJAX: AI-powered structured receipt extraction and electronic generation.
# Route: POST /receipts/ai_analyze/:id
# Returns: JSON object with cached or fresh deep analysis data
sub ai_analyze {
    my $c = shift;
    my $id = $c->param('id');
    my $force = $c->param('force') || 0;
    
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render(json => { success => 0, error => "Receipt not found" }, status => 404) unless $receipt;

    # 1. Reuse existing valid JSON if not forcing rescan
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

    # 2. Dispatch to Gemini 2.0
    my $api_key = $c->db->get_gemini_key();
    my $active_model = $c->db->get_gemini_active_model();
    unless ($api_key) { return $c->render(json => { success => 0, error => "AI key missing" }); }

    my $endpoint = "https://generativelanguage.googleapis.com/v1beta/models/$active_model:generateContent";
    my $system_prompt = "You are a professional receipt digitizer. Analyze the image and extract data into a JSON object. Include: store_name, location, date, time, items (array of {desc, qty, unit_price, line_total}), total_amount, currency, payment_method. ONLY return valid JSON.";

    my $ua = Mojo::UserAgent->new->request_timeout(45);
    my $tx = $ua->post("$endpoint?key=$api_key" => json => {
        contents => [{
            role => 'user',
            parts => [{ text => "Digitize this receipt accurately." }, { inlineData => { mimeType => $receipt->{mime_type}, data => b64_encode($receipt->{file_data}, '') } }]
        }],
        system_instruction => { parts => [{ text => $system_prompt }] },
        generationConfig => { temperature => 0.1, response_mime_type => "application/json" }
    });

    # 3. Process Response
    my $res = $tx->res;
    my $data = $res->json;
    if ($data && $data->{candidates} && @{$data->{candidates}}) {
        my $json_text = $data->{candidates}[0]{content}{parts}[0]{text};
        
        # Strip markdown wrapping if present
        if ($json_text =~ /```json\s*(.*?)\s*```/s) { $json_text = $1; }
        elsif ($json_text =~ /^\s*(\{.*?\})\s*$/s) { $json_text = $1; }

        my $extracted;
        eval { $extracted = decode_json($json_text); };
        
        if ($extracted && ref($extracted) eq 'HASH') {
            # Update ai_json column only; metadata columns remain untouched
            eval { $c->db->update_receipt_ai_json($id, $json_text); };
            return $c->render(json => { success => 1, cached => 0, data => $extracted });
        }
    }

    $c->app->log->error("AI Parsing Failed. Status: " . ($res->code // 0) . ". Body: " . $res->body);
    return $c->render(json => { success => 0, error => "AI failed to parse image." });
}

1;
