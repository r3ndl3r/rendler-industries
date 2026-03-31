# /lib/MyApp/Controller/Receipts.pm

package MyApp::Controller::Receipts;

use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(b64_encode trim);
use Mojo::JSON qw(decode_json encode_json);

# Controller for Receipt management and AI-powered digitization.
#
# Features:
#   - Binary upload and persistent storage of receipt images.
#   - Metadata tagging (Store, Date, Total) with OCR assistance.
#   - Pagination for large ledgers.
#   - Gemini AI integration for high-fidelity electronic receipts.
#   - Client-side image cropping and refinement.
#
# Integration Points:
#   - Restricted to family members via router bridge.
#   - Depends on DB::Receipts for binary and structured storage.
#   - Leverages global AI service helpers ($c->gemini_*).

# Renders the main receipt ledger skeleton.
# Route: GET /receipts
# Description: Serves the SPA skeleton with standard loading components.
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family;
    $c->render('receipts');
}

# Returns the consolidated state for the module.
# Route: GET /receipts/api/state
# Parameters: store, days, search, min_amount, ai_status, uploader (Optional filters)
# Description: Single Source of Truth handshake for initial SPA load.
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $user = $c->session('user');
    my $f = {
        store      => $c->param('store'),
        days       => $c->param('days'),
        search     => $c->param('search'),
        min_amount => $c->param('min_amount'),
        ai_status  => $c->param('ai_status'),
        uploader   => $c->param('uploader'),
        personal_only => $c->param('personal_only') || 0
    };

    my $state = {
        receipts    => $c->db->get_all_receipts_metadata(10, 0, $f, $user),
        store_names => $c->db->get_unique_store_names(),
        uploaders   => $c->db->get_all_users(),
        summary     => $c->db->get_spending_summary(),
        breakdown   => $c->db->get_store_spending_breakdown(3),
        is_admin    => $c->is_admin ? 1 : 0,
        current_user => $user // '',
        success     => 1
    };

    $c->render(json => $state);
}

# Lazy-loads receipt metadata for pagination.
# Route: GET /receipts/api/list
# Parameters: offset, store, days, search, min_amount, ai_status, uploader
# Description: Appends subsequent pages of metadata to the active ledger.
sub api_list {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

    my $user   = $c->session('user');
    my $offset = int($c->param('offset') // 0);
    my $limit  = 10;
    
    my $f = {
        store      => $c->param('store'),
        days       => $c->param('days'),
        search     => $c->param('search'),
        min_amount => $c->param('min_amount'),
        ai_status  => $c->param('ai_status'),
        uploader   => $c->param('uploader'),
        personal_only => $c->param('personal_only') || 0
    };

    my $receipts = $c->db->get_all_receipts_metadata($limit, $offset, $f, $user);
    
    $c->render(json => {
        success  => 1,
        receipts => $receipts,
        has_more => (scalar @$receipts == $limit) ? 1 : 0
    });
}

# Processes a new binary receipt upload.
# Route: POST /receipts/api/upload
# Parameters: file (Binary), store_name, receipt_date, total_amount, description
# Description: Handles multipart uploads and initiates OCR extraction for suggested metadata.
sub upload {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
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
    
    # Generate unique filename for persistent storage
    my $filename = time . "_" . $original_filename;
    $filename =~ s/[^a-zA-Z0-9._-]/_/g;

    # Suggest metadata via OCR if fields are missing
    if (!$store_name || !$receipt_date || !$total_amount) {
        if ($mime_type =~ /^image/) {
            $c->render_later;
            $c->ocr_process($file_data)->then(sub {
                my $ocr_data = shift;
                $store_name   ||= $ocr_data->{store_name};
                $receipt_date ||= $ocr_data->{receipt_date};
                $total_amount ||= $ocr_data->{total_amount};
                _finalize_upload($c, $filename, $original_filename, $mime_type, $file_size, $file_data, $username, $store_name, $receipt_date, $total_amount, $description);
            })->catch(sub {
                my $err = shift;
                $c->app->log->error("OCR suggest failed during upload: $err");
                _finalize_upload($c, $filename, $original_filename, $mime_type, $file_size, $file_data, $username, $store_name, $receipt_date, $total_amount, $description);
            });
            return;
        }
    }

    _finalize_upload($c, $filename, $original_filename, $mime_type, $file_size, $file_data, $username, $store_name, $receipt_date, $total_amount, $description);
}

# Helper to complete the upload persistence and UI response.
sub _finalize_upload {
    my ($c, $filename, $original_filename, $mime_type, $file_size, $file_data, $username, $store_name, $receipt_date, $total_amount, $description) = @_;

    unless ($receipt_date) {
        require DateTime;
        $receipt_date = $c->now->strftime('%Y-%m-%d');
    }

    eval {
        my $id = $c->db->store_receipt(
            $filename, $original_filename, $mime_type, $file_size, $file_data,
            $username, $store_name, $receipt_date, $total_amount, $description
        );
        
        # Fetch the newly created row for UI reconciliation
        my $new_row = $c->db->get_all_receipts_metadata(1, 0, { id => $id }, $username)->[0];
        
        $c->render(json => { 
            success => 1, 
            receipt => $new_row,
            summary   => $c->db->get_spending_summary(),
            breakdown => $c->db->get_store_spending_breakdown(3)
        });
    };
    if ($@) {
        $c->app->log->error("Receipt upload finalize failure: $@");
        $c->render(json => { success => 0, error => "Database write error" });
    }
}

# Updates metadata for an existing record.
# Route: POST /receipts/api/update/:id
sub api_update {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $id = $c->stash('id');
    my $store_name   = trim($c->param('store_name') // '');
    my $receipt_date = $c->param('receipt_date') || undef;
    my $total_amount = $c->param('total_amount') || 0.00;
    my $description  = trim($c->param('description') // '');

    # Verify ownership or admin status before update
    my $existing = $c->db->get_receipt_by_id($id);
    return $c->render(json => { success => 0, error => "Record not found" }) unless $existing;
    return $c->render(json => { success => 0, error => "Unauthorized" }) unless ($existing->{uploaded_by} eq $c->session('user') || $c->is_admin);

    $c->db->update_receipt_data($id, $store_name, $receipt_date, $total_amount, $description, $existing->{ai_json});
    
    my $updated = $c->db->get_all_receipts_metadata(1, 0, { id => $id }, $c->session('user'))->[0];
    
    $c->render(json => { 
        success => 1, 
        receipt => $updated,
        summary   => $c->db->get_spending_summary(),
        breakdown => $c->db->get_store_spending_breakdown(3)
    });
}

# Permanently removes a receipt and its binary data.
# Route: POST /receipts/api/delete/:id
sub api_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $id = $c->stash('id');
    my $existing = $c->db->get_receipt_by_id($id);
    return $c->render(json => { success => 0, error => "Record not found" }) unless $existing;
    return $c->render(json => { success => 0, error => "Unauthorized" }) unless ($existing->{uploaded_by} eq $c->session('user') || $c->is_admin);

    $c->db->delete_receipt_record($id);
    
    $c->render(json => { 
        success => 1,
        summary   => $c->db->get_spending_summary(),
        breakdown => $c->db->get_store_spending_breakdown(3)
    });
}

# Serves raw binary binary content for rendering.
# Route: GET /receipts/serve/:id
sub serve {
    my $c = shift;
    return $c->render(text => 'Unauthorized', status => 403) unless $c->is_logged_in;
    
    my $id = $c->stash('id');
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render(text => 'Not found', status => 404) unless $receipt;
    
    $c->res->headers->content_type($receipt->{mime_type});
    $c->render(data => $receipt->{file_data});
}

# Orchestrates high-fidelity AI digitization.
# Route: POST /receipts/api/ai_analyze/:id
sub api_ai_analyze {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $id = $c->stash('id');
    my $force = $c->param('force') || 0;
    
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render(json => { success => 0, error => "Record not found" }) unless $receipt;
    
    # Return cached result if available and not forced
    if ($receipt->{ai_json} && !$force) {
        return $c->render(json => { success => 1, data => decode_json($receipt->{ai_json}) });
    }

    $c->render_later;
    
    # Use localized subprocess for heavy AI analysis
    $c->gemini_analyze_receipt($receipt->{file_data}, $receipt->{mime_type})->then(sub {
        my $data = shift;
        
        # Parse Gemini response structure to extract candidate JSON
        if ($data && $data->{candidates} && @{$data->{candidates}}) {
            my $json_text = $data->{candidates}[0]{content}{parts}[0]{text};
            
            # Strip markdown wrapping if present
            if ($json_text =~ /```json\s*(.*?)\s*```/s) { $json_text = $1; }
            elsif ($json_text =~ /^\s*(\{.*?\})\s*$/s) { $json_text = $1; }

            my $extracted;
            eval { $extracted = decode_json($json_text); };
            
            if ($extracted && ref($extracted) eq 'HASH') {
                $c->db->update_receipt_ai_json($id, $json_text);
                $c->render(json => { success => 1, data => $extracted });
                return;
            }
        }

        $c->app->log->error("AI Parsing Failed: Invalid response structure");
        $c->render(json => { success => 0, error => "AI failed to parse image structure." });
    })->catch(sub {
        my $err = shift;
        $c->app->log->error("AI Digitization failure: $err");
        $c->render(json => { success => 0, error => "AI Digitization service failed: $err" });
    });
}

# Updates the raw binary content after image refinement.
# Route: POST /receipts/api/crop/:id
sub api_crop {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $id = $c->stash('id');
    my $upload = $c->param('cropped_image');
    return $c->render(json => { success => 0, error => "No image data" }) unless $upload;

    my $file_data = $upload->slurp;
    my $file_size = $upload->size;
    
    $c->db->update_receipt_binary($id, $file_data, $file_size);
    $c->render(json => { success => 1 });
}

# Initiates a basic OCR metadata scan.
# Route: POST /receipts/api/ocr/:id
sub api_ocr {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $id = $c->stash('id');
    my $receipt = $c->db->get_receipt_by_id($id);
    return $c->render(json => { success => 0, error => "Record not found" }) unless $receipt;

    $c->render_later;
    $c->ocr_process($receipt->{file_data})->then(sub {
        my $ocr_data = shift;
        $c->db->update_receipt_data(
            $id, $ocr_data->{store_name}, $ocr_data->{receipt_date}, 
            $ocr_data->{total_amount}, $receipt->{description}, $receipt->{ai_json}
        );
        $c->render(json => { 
            success => 1, 
            store_name => $ocr_data->{store_name},
            receipt_date => $ocr_data->{receipt_date},
            total_amount => $ocr_data->{total_amount},
            description => $receipt->{description}
        });
    })->catch(sub {
        my $err = shift;
        $c->render(json => { success => 0, error => "OCR scan failed" });
    });
}

1;