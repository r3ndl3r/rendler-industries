# /lib/MyApp/Controller/Receipts.pm

package MyApp::Controller::Receipts;

use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(b64_encode trim);
use Mojo::JSON qw(decode_json encode_json);

# Controller for Receipt management and AI-powered digitization.
# Features:
#   - Binary upload and persistent storage of receipt images
#   - Metadata tagging (Store, Date, Total) with OCR assistance
#   - Pagination for large ledgers
#   - Gemini 2.0 AI integration for high-fidelity electronic receipts
#   - Client-side image cropping and refinement
# Integration points:
#   - Restricted to family members via router bridge
#   - Depends on DB::Receipts for binary and structured storage
#   - Leverages global Gemini API configuration from Settings

# Renders the main receipt ledger skeleton.
# Route: GET /receipts
# Parameters: None
# Returns: Rendered HTML template 'receipts'.
sub index {
    shift->render('receipts');
}

# Returns the consolidated state for the module.
# Route: GET /receipts/api/state
# Parameters:
#   store, days, search, min_amount, ai_status, uploader : Filter params.
# Returns: JSON object { receipts, store_names, uploaders, summary, breakdown, is_admin, current_user }
sub api_state {
    my $c = shift;
    
    my $f = {
        store      => $c->param('store'),
        days       => $c->param('days'),
        search     => $c->param('search'),
        min_amount => $c->param('min_amount'),
        ai_status  => $c->param('ai_status'),
        uploader   => $c->param('uploader')
    };

    my $state = {
        receipts    => $c->db->get_all_receipts_metadata(10, 0, $f),
        store_names => $c->db->get_unique_store_names(),
        uploaders   => $c->db->get_all_users(),
        summary     => $c->db->get_spending_summary(),
        breakdown   => $c->db->get_store_spending_breakdown(3),
        is_admin    => $c->is_admin ? 1 : 0,
        current_user => $c->session('user') // '',
        success     => 1
    };

    $c->render(json => $state);
}

# Lazy-loads receipt metadata for pagination.
# Route: GET /receipts/api/list
# Parameters:
#   offset : Integer pagination pointer.
#   store, days, search, min_amount, ai_status, uploader : Filter params.
# Returns: JSON object { success, receipts, has_more }
sub api_list {
    my $c = shift;
    my $offset = int($c->param('offset') // 0);
    my $limit  = 10;
    
    my $f = {
        store      => $c->param('store'),
        days       => $c->param('days'),
        search     => $c->param('search'),
        min_amount => $c->param('min_amount'),
        ai_status  => $c->param('ai_status'),
        uploader   => $c->param('uploader')
    };

    my $receipts = $c->db->get_all_receipts_metadata($limit, $offset, $f);
    
    $c->render(json => {
        success  => 1,
        receipts => $receipts,
        has_more => (scalar @$receipts == $limit) ? 1 : 0
    });
}

# Processes a new binary receipt upload.
# Route: POST /receipts/api/upload
# Parameters:
#   file : Multipart binary object (Max 1GB).
#   store_name, receipt_date, total_amount, description : Metadata fields.
# Returns: JSON object { success, message, receipt, summary, breakdown }
sub upload {
    my $c = shift;
    
    my $upload = $c->param('file');
    unless ($upload) { return $c->render(json => { success => 0, error => "No file uploaded" }); }
    
    my $original_filename = $upload->filename;
    my $file_size = $upload->size || 0;
    my $mime_type = $upload->headers->content_type || 'application/octet-stream';

    if ($file_size > 1024 * 1024 * 1024) {
        return $c->render(json => { success => 0, error => "File too large (Max 1GB)" });
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
            $c->render_later;
            $c->ocr_process($file_data)->then(sub {
                my $ocr_data = shift;
                $store_name   ||= $ocr_data->{store_name};
                $receipt_date ||= $ocr_data->{receipt_date};
                $total_amount ||= $ocr_data->{total_amount};
                _finalize_upload($c, $original_filename, $mime_type, $file_size, $file_data, $username, $store_name, $receipt_date, $total_amount, $description);
            })->catch(sub {
                my $err = shift;
                $c->app->log->error("OCR process failed during upload: $err");
                _finalize_upload($c, $original_filename, $mime_type, $file_size, $file_data, $username, $store_name, $receipt_date, $total_amount, $description);
            });
            return;
        }
    }

    _finalize_upload($c, $original_filename, $mime_type, $file_size, $file_data, $username, $store_name, $receipt_date, $total_amount, $description);
}

sub _finalize_upload {
    my ($c, $original_filename, $mime_type, $file_size, $file_data, $username, $store_name, $receipt_date, $total_amount, $description) = @_;

    unless ($receipt_date) {
        require DateTime;
        $receipt_date = DateTime->now(time_zone => 'Australia/Melbourne')->strftime('%Y-%m-%d');
    }

    eval {
        my $id = $c->db->store_receipt(
            $original_filename, $original_filename, $mime_type, $file_size, $file_data,
            $username, $store_name, $receipt_date, $total_amount, $description
        );
        
        # Fetch the newly created row for instant client UI update
        my $new_row = $c->db->get_all_receipts_metadata(1, 0, { id => $id })->[0];
        
        $c->render(json => { 
            success => 1, 
            message => "Receipt successfully uploaded.",
            receipt => $new_row,
            summary => $c->db->get_spending_summary(),
            breakdown => $c->db->get_store_spending_breakdown(3)
        });
    };
    
    if ($@) {
        $c->app->log->error("Receipt Upload Failed: $@");
        return $c->render(json => { success => 0, error => "Database failure" });
    }
}

# Updates metadata for an existing receipt record.
# Route: POST /receipts/api/update/:id
# Parameters:
#   id : Unique Receipt ID.
#   store_name, receipt_date, total_amount, description : Metadata fields.
# Returns: JSON object { success, message, receipt, summary, breakdown }
sub update {
    my $c = shift;
    my $id = $c->param('id');
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render(json => { success => 0, error => "Receipt not found" }) unless $receipt;
    
    unless ($c->session('user') eq $receipt->{uploaded_by} || $c->is_admin) {
        return $c->render(json => { success => 0, error => "Access Denied" });
    }
    
    my $store_name   = $c->param('store_name') ? trim($c->param('store_name')) : undef;
    my $receipt_date = $c->param('receipt_date') || undef;
    my $total_amount = $c->param('total_amount') || undef;
    my $description  = $c->param('description') ? trim($c->param('description')) : undef;
    
    eval {
        $c->db->update_receipt_data($id, $store_name, $receipt_date, $total_amount, $description, $receipt->{ai_json});
    };
    
    if ($@) { 
        return $c->render(json => { success => 0, error => "Database failure: $@" });
    }
    
    my $updated = $c->db->get_all_receipts_metadata(1, 0, { id => $id })->[0];
    
    return $c->render(json => {
        success => 1,
        message => "Receipt details updated.",
        receipt => $updated,
        summary => $c->db->get_spending_summary(),
        breakdown => $c->db->get_store_spending_breakdown(3)
    });
}

# Processes a client-side cropped image update.
# Route: POST /receipts/api/crop/:id
# Parameters:
#   id : Unique Receipt ID.
#   cropped_image : Binary file object.
# Returns: JSON object { success }
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

    return $c->render(json => { success => 1, message => "Receipt image successfully refined." });
}

# Permanently removes a receipt resource.
# Route: POST /receipts/api/delete/:id
# Parameters:
#   id : Unique Receipt ID.
# Returns: JSON object { success, message, summary, breakdown }
sub delete {
    my $c = shift;
    my $id = $c->param('id');
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render(json => { success => 0, error => "Receipt not found" }) unless $receipt;
    
    unless ($c->session('user') eq $receipt->{uploaded_by} || $c->is_admin) {
        return $c->render(json => { success => 0, error => "Access Denied" });
    }
    
    eval {
        $c->db->delete_receipt_record($id);
    };
    if ($@) { return $c->render(json => { success => 0, error => "Delete failed" }); }

    return $c->render(json => { 
        success => 1, 
        message => "Receipt permanently deleted.",
        summary => $c->db->get_spending_summary(),
        breakdown => $c->db->get_store_spending_breakdown(3)
    });
}

# Serves raw binary content with correct MIME headers.
# Route: GET /receipts/serve/:id
# Parameters:
#   id : Unique Receipt ID.
# Returns: Binary stream.
sub serve {
    my $c = shift;
    my $id = $c->param('id');
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render_error("Receipt not found", 404) unless $receipt;
    $c->res->headers->content_type($receipt->{mime_type});
    $c->res->headers->content_disposition("inline; filename=\"" . $receipt->{original_filename} . "\"");
    return $c->render(data => $receipt->{file_data});
}

# Extracts metadata from an existing image via AI OCR.
# Route: POST /receipts/api/ocr/:id
# Parameters:
#   id : Unique Receipt ID.
# Returns: JSON object { success, store_name, receipt_date, total_amount, raw_text }
sub trigger_ocr {
    my $c = shift;
    my $id = $c->param('id');
    
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render(json => { success => 0, error => "Receipt not found" }, status => 404) unless $receipt;
    
    if ($receipt->{mime_type} !~ /^image/) {
        return $c->render(json => { success => 0, error => "Only images supported for OCR" });
    }

    $c->render_later;

    $c->ocr_process($receipt->{file_data})->then(sub {
        my $ocr_data = shift;
        
        eval {
            # Only update if we found something useful
            if ($ocr_data->{store_name} || $ocr_data->{total_amount}) {
                $c->db->update_receipt_data(
                    $id, 
                    $ocr_data->{store_name} || $receipt->{store_name}, 
                    $ocr_data->{receipt_date} || $receipt->{receipt_date}, 
                    $ocr_data->{total_amount} || $receipt->{total_amount}, 
                    $receipt->{description},
                    $receipt->{ai_json}
                );
            }
            
            # Cleanup: Don't return binary in response
            delete $receipt->{file_data};

            $c->render(json => {
                success      => 1,
                message      => "OCR extraction complete.",
                store_name   => $ocr_data->{store_name},
                receipt_date => $ocr_data->{receipt_date},
                total_amount => $ocr_data->{total_amount},
                description  => $receipt->{description},
                raw_text     => $ocr_data->{raw_text}
            });
        };
        if ($@) {
            $c->app->log->error("OCR Trigger DB Failed for receipt $id: $@");
            $c->render(json => { success => 0, error => "Database update failed." });
        }
    })->catch(sub {
        my $err = shift;
        $c->app->log->error("OCR Trigger Failed for receipt $id: $err");
        $c->render(json => { success => 0, error => "OCR engine failed." });
    });
}

# Performs AI-powered structured receipt digitization.
# Route: POST /receipts/api/ai_analyze/:id
# Parameters:
#   id    : Unique Receipt ID.
#   force : Force rescan (Boolean).
# Returns: JSON object { success, cached, data }
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

    $c->render_later;

    $c->ua->request_timeout(60)->post_p("$endpoint?key=$api_key" => json => {
        contents => [{
            role => 'user',
            parts => [{ text => "Digitize this receipt accurately." }, { inlineData => { mimeType => $receipt->{mime_type}, data => b64_encode($receipt->{file_data}, '') } }]
        }],
        system_instruction => { parts => [{ text => $system_prompt }] },
        generationConfig => { temperature => 0.1, response_mime_type => "application/json" }
    })->then(sub {
        my $tx = shift;

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
                $c->render(json => { success => 1, message => "AI Digitization successful.", cached => 0, data => $extracted });
                return;
            }
        }

        $c->app->log->error("AI Parsing Failed. Status: " . ($res->code // 0) . ". Body: " . $res->body);
        $c->render(json => { success => 0, error => "AI failed to parse image." });
    })->catch(sub {
        my $err = shift;
        $c->app->log->error("Receipt AI Exception: $err");
        $c->render(json => { success => 0, error => "AI API connection failed" });
    });
}

1;
