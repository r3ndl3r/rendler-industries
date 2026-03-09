# /lib/MyApp/Controller/AI.pm

package MyApp::Controller::AI;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::UserAgent;
use Mojo::Util qw(b64_encode trim);
use Mojo::JSON qw(encode_json decode_json);

# Controller for "The Family Pulse AI".
# Features:
#   - Contextual memory (Dashboard state injection)
#   - Multimodal analysis (BLOB image processing from DB)
#   - Conversational persistence via MariaDB
#   - Synchronized message history handshake
# Integration points:
#   - Restricted to 'family' bridge via router
#   - Depends on DB::AI for state aggregation and history
#   - Uses global gemini_api_key from app_secrets

# Renders the message interface.
# Route: GET /ai
sub index {
    shift->render('ai');
}

# Returns the consolidated state for the AI module.
# Route: GET /ai/api/state
# Returns: JSON object { history, username, success }
sub api_state {
    my $c = shift;
    my $user_id = $c->current_user_id;
    my $history = $c->db->get_ai_history($user_id, 20);
    
    $c->render(json => {
        success  => 1,
        history  => $history,
        username => $c->session('user')
    });
}

# Processes a user prompt and returns AI response via AJAX.
# Route: POST /ai/api/chat
sub chat {
    my $c = shift;
    my $user_id = $c->current_user_id;
    my $prompt  = trim($c->param('prompt') // '');
    my $file_id = $c->param('file_id');
    my $file_type = $c->param('file_type') // 'file';

    return $c->render(json => { success => 0, error => "Say something!" }) unless $prompt;

    # 1. Gather Context & Build System Message
    my $snapshot = $c->db->get_dashboard_snapshot();
    my $system_instructions = "You are 'The Family Pulse AI', the central brain of Rendler Industries. 
    You have access to real-time family data and Google Search. 
    If you don't know an answer (like an address or specific detail), use Google Search to find it. 
    Be helpful, concise, and occasionally slightly witty. 
    CURRENT DASHBOARD STATE: " . encode_json($snapshot);

    # 2. Prepare Payload
    my @user_parts = ({ text => $prompt });
    
    if ($file_id) {
        my $attachment = $c->db->get_ai_attachment($file_type, $file_id);
        if ($attachment && $attachment->{data}) {
            push @user_parts, {
                inlineData => { 
                    mimeType => $attachment->{mime},
                    data     => b64_encode($attachment->{data}, '')
                }
            };
        }
    }

    my @contents;
    # History injection (Last 10 turns)
    my $history = $c->db->get_ai_history($user_id, 10);
    foreach my $msg (@$history) {
        push @contents, { role => $msg->{role}, parts => [{ text => $msg->{content} }] };
    }
    # Current turn
    push @contents, { role => 'user', parts => \@user_parts };

    # 3. Dispatch to Gemini
    my $api_key = $c->db->get_gemini_key();
    my $active_model = $c->db->get_gemini_active_model();
    my $endpoint = "https://generativelanguage.googleapis.com/v1beta/models/$active_model:generateContent";

    $c->render_later;

    $c->ua->post_p("$endpoint?key=$api_key" => json => {
        contents => \@contents,
        system_instruction => { parts => [{ text => $system_instructions }] },
        tools => [{ google_search => {} }], 
        generationConfig => {
            temperature => 0.7,
            maxOutputTokens => 1000,
        }
    })->then(sub {
        my $tx = shift;

        # 4. Process Model Output and Persist History
        if (my $res = $tx->result) {
            if ($res->is_success) {
                my $data = $res->json;
                my $ai_text = $data->{candidates}[0]{content}{parts}[0]{text} // "I'm not sure how to respond to that.";
                
                # Persist both user and model turns
                $c->db->save_ai_message($user_id, 'user', $prompt, $file_id ? { file_id => $file_id, file_type => $file_type } : undef);
                $c->db->save_ai_message($user_id, 'model', $ai_text);
                
                $c->render(json => { 
                    success => 1, 
                    content => $ai_text,
                    role    => 'model'
                });
            } else {
                $c->app->log->error("Gemini API Error: " . $res->body);
                $c->render(json => { success => 0, error => "AI service unavailable." });
            }
        } else {
             $c->render(json => { success => 0, error => "Network failure." });
        }
    })->catch(sub {
        my $err = shift;
        $c->app->log->error("Gemini API Exception: $err");
        $c->render(json => { success => 0, error => "Network failure." });
    });
}

# Permanently removes all chat history for the current user.
# Route: POST /ai/api/clear
sub clear {
    my $c = shift;
    $c->db->clear_ai_history($c->current_user_id);
    $c->render(json => { success => 1 });
}

1;
