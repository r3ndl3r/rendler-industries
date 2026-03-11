# /lib/MyApp/Plugin/AI.pm

package MyApp::Plugin::AI;
use Mojo::Base 'Mojolicious::Plugin';
use Mojo::Util qw(trim b64_encode);
use Mojo::Promise;

# Centralized AI Service for Rendler Industries.
# Features:
#   - Unified Gemini API communication layer
#   - Dynamic API Versioning (v1 vs v1beta) based on model
#   - Specialized wrappers for Chat, Receipts, and Emojis
#   - Centralized non-blocking error handling
# Integration points:
#   - Registered as a standard Mojolicious Plugin
#   - Provides $c->gemini_* helpers to all controllers

sub register {
    my ($self, $app) = @_;

    # Core Workhorse: The Low-Level API Handler
    $app->helper(gemini_prompt => sub {
        my ($c, %args) = @_;
        
        my $api_key      = $c->db->get_gemini_key();
        my $active_model = $args{model} || $c->db->get_gemini_active_model();
        
        unless ($api_key) {
            return Mojo::Promise->reject("AI Key Missing");
        }

        # Determine API version: Stable models use v1, Preview use v1beta
        my $api_version = ($active_model =~ /preview|exp|2\.[05]|3\./) ? 'v1beta' : 'v1';
        my $endpoint = "https://generativelanguage.googleapis.com/$api_version/models/$active_model:generateContent?key=$api_key";

        # Build standard Gemini payload
        my $payload = {
            contents => $args{contents} || [],
            generationConfig => {
                temperature      => $args{temp} // 0.7,
                maxOutputTokens  => $args{max_tokens} // 2048,
                response_mime_type => $args{response_format} // 'text/plain'
            }
        };

        # Add optional tools (e.g., google_search)
        $payload->{tools} = $args{tools} if $args{tools};

        # Add System Instructions if provided
        if ($args{system}) {
            $payload->{system_instruction} = { parts => [{ text => $args{system} }] };
        }

        # Execute Non-Blocking Request
        return $c->ua->request_timeout($args{timeout} || 30)->post_p($endpoint => json => $payload)
            ->then(sub {
                my $tx = shift;
                if (my $res = $tx->result) {
                    if ($res->is_success) {
                        return $res->json;
                    } else {
                        my $err = $res->json->{error} || {};
                        $c->app->log->error("Gemini API Error [" . $res->code . "]: " . ($err->{message} // 'Unknown'));
                        return Mojo::Promise->reject($err->{message} || "API Error " . $res->code);
                    }
                }
                return Mojo::Promise->reject("Network connection failure");
            });
    });

    # Specialized: Chat Interface
    $app->helper(gemini_chat => sub {
        my ($c, $history, $message) = @_;
        
        my @contents;
        # Map DB history to Gemini content format
        foreach my $h (@$history) {
            push @contents, { role => 'user',  parts => [{ text => $h->{user_message} }] };
            push @contents, { role => 'model', parts => [{ text => $h->{ai_response} }] };
        }
        push @contents, { role => 'user', parts => [{ text => $message }] };

        return $c->gemini_prompt(
            contents => \@contents,
            system   => "You are the Rendler Family Assistant. Be helpful, concise, and professional."
        );
    });

    # Specialized: Receipt Analysis (Restored Old Style)
    # Parameters: Binary image data, MIME type
    # Returns: Promise (JSON payload following the legacy extraction schema)
    $app->helper(gemini_analyze_receipt => sub {
        my ($c, $image, $mime) = @_;
        
        my $system = "You are a professional receipt digitizer. Analyze the image and extract data into a JSON object. Include: store_name, location, date, time, items (array of {desc, qty, unit_price, line_total}), total_amount, currency, payment_method. CRITICAL: In the 'desc' field, provide ONLY the item name. EXCLUDE any SKU numbers, internal item codes, or long numeric prefixes. ONLY return valid JSON.";

        return $c->gemini_analyze_image(
            image  => $image,
            mime   => $mime,
            system => $system,
            prompt => "Digitize this receipt accurately."
        );
    });

    # Specialized: Generic Image Analysis
    $app->helper(gemini_analyze_image => sub {
        my ($c, %args) = @_;
        
        my $payload_contents = [{
            role => 'user',
            parts => [
                { text => $args{prompt} || "Digitize this image." },
                { inlineData => { 
                    mimeType => $args{mime}, 
                    data     => b64_encode($args{image}, '') 
                }}
            ]
        }];

        return $c->gemini_prompt(
            contents        => $payload_contents,
            system          => $args{system},
            response_format => 'application/json',
            temp            => 0.1,
            timeout         => 60
        );
    });

    # Specialized: Single Emoji Generation (Sync-friendly wrapper)
    # Note: Returns a promise, but optimized for background speed
    $app->helper(gemini_generate_emoji => sub {
        my ($c, $text) = @_;
        
        return $c->gemini_prompt(
            contents   => [{ role => 'user', parts => [{ text => $text }] }],
            system     => "Respond ONLY with one emoji character.",
            temp       => 0.1,
            max_tokens => 10,
            timeout    => 10
        );
    });
}

1;
