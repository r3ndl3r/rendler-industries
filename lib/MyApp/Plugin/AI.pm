# /lib/MyApp/Plugin/AI.pm

package MyApp::Plugin::AI;
use Mojo::Base 'Mojolicious::Plugin';
use Mojo::Util qw(trim b64_encode);
use Mojo::JSON qw(decode_json);
use Mojo::Promise;
use Mojo::UserAgent;

# Centralized AI Service for Rendler Industries.
# Features:
#   - Unified AI provider communication layer
#   - Dynamic API Versioning (v1 vs v1beta) based on model
#   - Specialized wrappers for Chat, Receipts, and Emojis
#   - Centralized non-blocking error handling
# Integration points:
#   - Registered as a standard Mojolicious Plugin
#   - Provides $c->ai_* helpers to all controllers

sub ai_decode_json_text {
    my ($text) = @_;
    return undef unless defined $text;

    $text =~ s/^\s*```(?:json)?\s*//i;
    $text =~ s/\s*```\s*$//;
    my $decoded = eval { decode_json($text) };
    return $decoded if !$@ && defined $decoded;

    if ($text =~ /(\{.*\})/s) {
        $decoded = eval { decode_json($1) };
        return $decoded if !$@ && defined $decoded;
    }
    if ($text =~ /(\[.*\])/s) {
        $decoded = eval { decode_json($1) };
        return $decoded if !$@ && defined $decoded;
    }

    return undef;
}

sub _has_gemini_only_parts {
    my ($args) = @_;
    return 1 if $args->{tools};

    foreach my $content (@{$args->{contents} || []}) {
        foreach my $part (@{$content->{parts} || []}) {
            return 1 if exists $part->{inlineData};
        }
    }

    return 0;
}

sub _extract_text {
    my ($parts) = @_;
    return join "\n", map { $_->{text} // '' } grep { exists $_->{text} } @{$parts || []};
}

sub _opencode_messages {
    my (%args) = @_;
    my @messages;
    push @messages, { role => 'system', content => $args{system} } if $args{system};
    foreach my $content (@{$args{contents} || []}) {
        my $role = ($content->{role} || 'user') eq 'model' ? 'assistant' : ($content->{role} || 'user');
        push @messages, { role => $role, content => _extract_text($content->{parts}) };
    }
    return \@messages;
}

sub _opencode_payload {
    my (%args) = @_;
    my $max_tokens = $args{max_tokens} // 2048;
    $max_tokens = 128 if $max_tokens < 128;

    my $payload = {
        model       => $args{model},
        messages    => _opencode_messages(%args),
        temperature => $args{temp} // 0.7,
        max_tokens  => $max_tokens
    };

    if (($args{response_format} // '') eq 'application/json') {
        $payload->{response_format} = { type => 'json_object' };
    }
    $payload->{web_search_options} = {} if $args{web_search};

    return $payload;
}

sub _opencode_payload_without_json_mode {
    my ($payload) = @_;
    my %copy = %$payload;
    delete $copy{response_format};
    my @messages = @{$copy{messages} || []};
    my $json_instruction = 'Return only valid JSON. Do not include markdown fences or explanatory text.';
    if (@messages && $messages[0]{role} eq 'system') {
        $messages[0] = { %{$messages[0]}, content => $messages[0]{content} . "\n$json_instruction" };
    } else {
        unshift @messages, { role => 'system', content => $json_instruction };
    }
    $copy{messages} = \@messages;
    return \%copy;
}

sub _opencode_payload_without_web_search {
    my ($payload) = @_;
    my %copy = %$payload;
    delete $copy{web_search_options};
    return \%copy;
}

sub _opencode_text {
    my ($json) = @_;
    return '' unless ref $json eq 'HASH';
    my $choices = $json->{choices};
    return '' unless ref $choices eq 'ARRAY' && @$choices;
    my $choice = $choices->[0];
    return '' unless ref $choice eq 'HASH';
    my $message = $choice->{message};
    return $message->{content} if ref $message eq 'HASH' && defined $message->{content};
    return $choice->{text} // '';
}

sub _api_error_message {
    my ($res, $fallback) = @_;
    return $fallback unless $res;

    my $json = eval { $res->json } || {};
    if (ref $json eq 'HASH') {
        my $err = $json->{error};
        return $err->{message} if ref $err eq 'HASH' && defined $err->{message};
        return $err if defined $err && !ref $err;
    }

    return $res->message || $fallback;
}

sub _gemini_endpoint {
    my ($model, $api_key) = @_;
    my $api_version = ($model =~ /preview|exp|2\.[05]|3\./) ? 'v1beta' : 'v1';
    return "https://generativelanguage.googleapis.com/$api_version/models/$model:generateContent?key=$api_key";
}

sub gemini_models_sync {
    my (%args) = @_;
    my @fallback = ('gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-pro');
    my $api_key = $args{api_key} || '';
    return (\@fallback, 'Gemini API key missing') unless $api_key;

    my $ua = $args{ua} || Mojo::UserAgent->new;
    $ua->request_timeout($args{timeout} || 5);

    my $tx = $ua->get("https://generativelanguage.googleapis.com/v1beta/models?key=$api_key");
    my $res = $tx->result;
    unless ($res && $res->is_success) {
        return (\@fallback, 'Could not fetch live Gemini models');
    }

    my $json = $res->json || {};
    my $models = $json->{models};
    unless (ref $models eq 'ARRAY') {
        return (\@fallback, 'Gemini model response was not recognized');
    }

    my @ids = grep { defined $_ && length $_ } map {
        my $name = ref $_ eq 'HASH' ? ($_->{name} // '') : '';
        my $methods = ref $_ eq 'HASH' && ref $_->{supportedGenerationMethods} eq 'ARRAY' ? $_->{supportedGenerationMethods} : [];
        my $can_generate = grep { $_ eq 'generateContent' } @$methods;
        $name =~ s{\Amodels/}{};
        $can_generate ? $name : undef;
    } @$models;

    return (@ids ? (\@ids, '') : (\@fallback, 'Gemini returned no generateContent models'));
}

sub opencode_models_sync {
    my (%args) = @_;
    my $ua = $args{ua} || Mojo::UserAgent->new;
    $ua->request_timeout($args{timeout} || 5);

    my @fallback = ('big-pickle', 'deepseek-v4-flash-free', 'mimo-v2.5-free', 'qwen3.6-plus-free', 'minimax-m3-free', 'nemotron-3-super-free');
    my $tx = $ua->get('https://opencode.ai/zen/v1/models');
    my $res = $tx->result;
    unless ($res && $res->is_success) {
        return (\@fallback, 'Could not fetch live OpenCode models');
    }

    my $json = $res->json || {};
    my $data = $json->{data};
    unless (ref $data eq 'ARRAY') {
        return (\@fallback, 'OpenCode model response was not recognized');
    }

    my @models = grep { defined $_ && length $_ } map { ref $_ eq 'HASH' ? $_->{id} : undef } @$data;
    return (@models ? (\@models, '') : (\@fallback, 'OpenCode returned no models'));
}

sub ai_prompt_sync {
    my (%args) = @_;
    my $ua = $args{ua} || Mojo::UserAgent->new;
    my $timeout = $args{timeout} || 30;
    $ua->request_timeout($timeout)->inactivity_timeout($timeout);

    my $provider = $args{provider} || 'gemini';
    my $model = $args{model}
        || ($provider eq 'opencode' ? $args{opencode_model}
            : $provider eq 'local' ? 'local'
            : $args{gemini_model})
        || '';
    my $debug = $args{debug};
    my $log = sub { warn "[AI] @_\n" if $debug };

    $log->("Sync request provider=$provider model=$model system=" . ($args{system} // '') . " contents=" . substr(($args{contents}[0]{parts}[0]{text} // ''), 0, 200));

    if ($provider eq 'opencode' && !_has_gemini_only_parts(\%args)) {
        die "OpenCode AI key missing" unless $args{opencode_key};
        my $payload = _opencode_payload(%args, model => $model);
        my $tx = $ua->post('https://opencode.ai/zen/v1/chat/completions' => {
            Authorization => "Bearer $args{opencode_key}"
        } => json => $payload);
        my $res = $tx->result;
        die "Network connection failure" unless $res;
        if (!$res->is_success && $args{web_search}) {
            $tx = $ua->post('https://opencode.ai/zen/v1/chat/completions' => {
                Authorization => "Bearer $args{opencode_key}"
            } => json => _opencode_payload_without_web_search($payload));
            $res = $tx->result;
            die "Network connection failure" unless $res;
        }
        if (!$res->is_success && ($args{response_format} // '') eq 'application/json') {
            $tx = $ua->post('https://opencode.ai/zen/v1/chat/completions' => {
                Authorization => "Bearer $args{opencode_key}"
            } => json => _opencode_payload_without_json_mode($payload));
            $res = $tx->result;
            die "Network connection failure" unless $res;
        }
        die _api_error_message($res, 'OpenCode API error') unless $res->is_success;
        my $text = _opencode_text($res->json || {});
        $log->("Sync response text=" . substr($text, 0, 500));
        return {
            candidates => [{
                content => { parts => [{ text => $text }] }
            }]
        };
    }

    if ($provider eq 'local' && !_has_gemini_only_parts(\%args)) {
        my $payload = _opencode_payload(%args, model => $model);
        my $endpoint = $args{local_ai_url} || '';
        die "Local LLM URL missing" unless $endpoint;
        my $tx = $ua->post($endpoint => json => $payload);
        my $res = $tx->result;
        die "Network connection failure" unless $res;
        die _api_error_message($res, 'Local LLM API error') unless $res->is_success;
        my $text = _opencode_text($res->json || {});
        $log->("Sync response text=" . substr($text, 0, 500));
        return {
            candidates => [{
                content => { parts => [{ text => $text }] }
            }]
        };
    }

    die "Gemini AI key missing" unless $args{gemini_key};
    $model = $args{model} || $args{gemini_model};
    my $payload = {
        contents => $args{contents} || [],
        generationConfig => {
            temperature        => $args{temp} // 0.7,
            maxOutputTokens    => $args{max_tokens} // 2048,
            response_mime_type => $args{response_format} // 'text/plain'
        }
    };
    $payload->{tools} = [{ google_search => {} }] if $args{web_search};
    $payload->{tools} = $args{tools} if $args{tools};
    $payload->{system_instruction} = { parts => [{ text => $args{system} }] } if $args{system};

    my $tx = $ua->post(_gemini_endpoint($model, $args{gemini_key}) => json => $payload);
    my $res = $tx->result;
    die "Network connection failure" unless $res;
    die _api_error_message($res, 'Gemini API error') unless $res->is_success;
    my $json = $res->json;
    $log->("Sync response text=" . substr(($json->{candidates}[0]{content}{parts}[0]{text} // ''), 0, 500));
    return $json;
}

sub _gemini_prompt {
    my ($c, %args) = @_;

    my $api_key      = $c->db->get_gemini_key();
    my $active_model = $args{model} || $c->db->get_gemini_active_model();

    unless ($api_key) {
        return Mojo::Promise->reject("Gemini AI key missing");
    }

    my $endpoint = _gemini_endpoint($active_model, $api_key);

    my $payload = {
        contents => $args{contents} || [],
        generationConfig => {
            temperature        => $args{temp} // 0.7,
            maxOutputTokens    => $args{max_tokens} // 2048,
            response_mime_type => $args{response_format} // 'text/plain'
        }
    };

    $payload->{tools} = $args{tools} if $args{tools};
    $payload->{tools} = [{ google_search => {} }] if $args{web_search};
    if ($args{system}) {
        $payload->{system_instruction} = { parts => [{ text => $args{system} }] };
    }

    my $timeout = $args{timeout} || 30;
    my $ua = $c->ua->request_timeout($timeout)->inactivity_timeout($timeout);

    return $ua->post_p($endpoint => json => $payload)
        ->then(sub {
            my $tx = shift;
            if (my $res = $tx->result) {
                if ($res->is_success) {
                    return $res->json;
                } else {
                    my $msg = _api_error_message($res, 'Unknown');
                    $c->app->log->error("Gemini API Error [" . $res->code . "]: " . $msg);
                    return Mojo::Promise->reject($msg || "API Error " . $res->code);
                }
            }
            return Mojo::Promise->reject("Network connection failure");
        });
}

sub _opencode_prompt {
    my ($c, %args) = @_;

    my $api_key = $c->db->get_opencode_key();
    my $model   = $args{model} || $c->db->get_opencode_active_model();

    unless ($api_key) {
        return Mojo::Promise->reject("OpenCode AI key missing");
    }

    my $payload = _opencode_payload(%args, model => $model);

    my $headers = { Authorization => "Bearer $api_key" };
    my $timeout = $args{timeout} || 30;
    my $ua = $c->ua->request_timeout($timeout)->inactivity_timeout($timeout);

    return $ua->post_p(
        'https://opencode.ai/zen/v1/chat/completions' => {
            Authorization => "Bearer $api_key"
        } => json => $payload
    )->then(sub {
        my $tx = shift;
        if (my $res = $tx->result) {
            if ($res->is_success) {
                my $json = $res->json || {};
                my $text = _opencode_text($json);
                return {
                    candidates => [{
                        content => {
                            parts => [{ text => $text }]
                        }
                    }]
                };
            } elsif ($args{web_search}) {
                return $ua->post_p('https://opencode.ai/zen/v1/chat/completions' => $headers => json => _opencode_payload_without_web_search($payload))
                    ->then(sub {
                        my $retry_tx = shift;
                        if (my $retry_res = $retry_tx->result) {
                            if ($retry_res->is_success) {
                                my $json = $retry_res->json || {};
                                my $text = _opencode_text($json);
                                return {
                                    candidates => [{
                                        content => {
                                            parts => [{ text => $text }]
                                        }
                                    }]
                                };
                            }
                            my $msg = _api_error_message($retry_res, 'Unknown');
                            $c->app->log->error("OpenCode API Error [" . $retry_res->code . "]: " . $msg);
                            return Mojo::Promise->reject($msg || "API Error " . $retry_res->code);
                        }
                        return Mojo::Promise->reject("Network connection failure");
                    });
            } elsif (($args{response_format} // '') eq 'application/json') {
                return $ua->post_p('https://opencode.ai/zen/v1/chat/completions' => $headers => json => _opencode_payload_without_json_mode($payload))
                    ->then(sub {
                        my $retry_tx = shift;
                        if (my $retry_res = $retry_tx->result) {
                            if ($retry_res->is_success) {
                                my $json = $retry_res->json || {};
                                my $text = _opencode_text($json);
                                return {
                                    candidates => [{
                                        content => {
                                            parts => [{ text => $text }]
                                        }
                                    }]
                                };
                            }
                            my $msg = _api_error_message($retry_res, 'Unknown');
                            $c->app->log->error("OpenCode API Error [" . $retry_res->code . "]: " . $msg);
                            return Mojo::Promise->reject($msg || "API Error " . $retry_res->code);
                        }
                        return Mojo::Promise->reject("Network connection failure");
                    });
            } else {
                my $msg = _api_error_message($res, 'Unknown');
                $c->app->log->error("OpenCode API Error [" . $res->code . "]: " . $msg);
                return Mojo::Promise->reject($msg || "API Error " . $res->code);
            }
        }
        return Mojo::Promise->reject("Network connection failure");
    });
}

sub _local_prompt {
    my ($c, %args) = @_;

    my $model    = $args{model} || 'local';
    my $endpoint = $c->db->get_local_ai_url();
    return Mojo::Promise->reject("Local LLM URL missing") unless $endpoint;

    my $payload = _opencode_payload(%args, model => $model);

    my $timeout = $args{timeout} || 300;
    my $ua = $c->ua->request_timeout($timeout)->inactivity_timeout($timeout);

    return $ua->post_p($endpoint => json => $payload)
        ->then(sub {
            my $tx = shift;
            if (my $res = $tx->result) {
                if ($res->is_success) {
                    my $json = $res->json || {};
                    my $text = _opencode_text($json);
                    return {
                        candidates => [{
                            content => {
                                parts => [{ text => $text }]
                            }
                        }]
                    };
                } else {
                    my $msg = _api_error_message($res, 'Unknown');
                    $c->app->log->error("Local LLM API Error [" . $res->code . "]: " . $msg);
                    return Mojo::Promise->reject($msg || "API Error " . $res->code);
                }
            }
            return Mojo::Promise->reject("Network connection failure");
        });
}

sub register {
    my ($self, $app) = @_;

    # Debug logging helper for AI calls (gated by config debug flag).
    $app->helper(ai_debug => sub {
        my ($c, @msg) = @_;
        return unless $c->app->config->{debug};
        $c->app->log->info("[AI] @msg");
    });

    # Core Workhorse: provider-neutral AI prompt router.
    $app->helper(ai_prompt => sub {
        my ($c, %args) = @_;

        my $profile_key = $args{app_profile} || $args{ai_profile} || $args{app_context} || '';
        my $profile = length $profile_key ? $c->db->get_ai_model_profile($profile_key) : {};
        my $requires_gemini = _has_gemini_only_parts(\%args);
        my $provider = $args{provider} || $profile->{provider} || $c->db->get_ai_provider();
        $provider = 'gemini' if $requires_gemini;
        my $model = $args{model};
        $model ||= $profile->{model} if !$requires_gemini && ($profile->{provider} || '') eq $provider;
        $model ||= $provider eq 'opencode' ? $c->db->get_opencode_active_model()
                : $provider eq 'local'    ? 'local'
                :                           $c->db->get_gemini_active_model();
        $args{model} = $model;
        $args{web_search} = 0 unless $provider eq 'gemini' || $provider eq 'opencode';
        $c->ai_debug("Request provider=$provider model=", $model,
            " system=", ($args{system} // ''), " contents=", substr(($args{contents}[0]{parts}[0]{text} // ''), 0, 200));

        my $promise;
        if ($provider eq 'opencode' && !$requires_gemini) {
            $promise = _opencode_prompt($c, %args);
        } elsif ($provider eq 'local' && !$requires_gemini) {
            $promise = _local_prompt($c, %args);
        } else {
            $promise = _gemini_prompt($c, %args);
        }

        return $promise->then(sub {
            my $data = shift;
            my $text = $data->{candidates}[0]{content}{parts}[0]{text} // '';
            $c->ai_debug("Response text=", substr($text, 0, 500));
            return $data;
        })->catch(sub {
            my $err = shift;
            $c->ai_debug("Error: $err");
            return Mojo::Promise->reject($err);
        });
    });

    $app->helper(ai_decode_json => sub {
        my ($c, $text) = @_;
        return ai_decode_json_text($text);
    });

    $app->helper(ai_gemini_models => sub {
        my ($c) = @_;
        return gemini_models_sync(
            ua      => $c->ua,
            api_key => $c->db->get_gemini_key()
        );
    });

    $app->helper(ai_opencode_models => sub {
        my ($c) = @_;
        return opencode_models_sync(ua => $c->ua);
    });

    # Specialized: Chat Interface
    $app->helper(ai_chat => sub {
        my ($c, $history, $message) = @_;
        
        my @contents;
        # Map DB history to the normalized provider content format
        foreach my $h (@$history) {
            push @contents, { role => 'user',  parts => [{ text => $h->{user_message} }] };
            push @contents, { role => 'model', parts => [{ text => $h->{ai_response} }] };
        }
        push @contents, { role => 'user', parts => [{ text => $message }] };

        return $c->ai_prompt(
            contents => \@contents,
            system   => "You are the Rendler Family Assistant. Be helpful, concise, and professional.",
            app_profile => 'ai_chat'
        );
    });

    # Specialized: Receipt Analysis (Restored Old Style)
    # Parameters: Binary image data, MIME type
    # Returns: Promise (JSON payload following the legacy extraction schema)
    $app->helper(ai_analyze_receipt => sub {
        my ($c, $image, $mime) = @_;
        
        my $now = $c->now->strftime('%Y-%m-%d');
        my $system = "You are a professional receipt digitizer. Current system date: $now. Use this to help resolve ambiguous characters and verify plausibility. "
                   . "Analyze the image and extract data into a JSON object. "
                   . "Include: store_name, location, date (formatted as YYYY-MM-DD), time, items (array of {desc, qty, unit_price, line_total}), total_amount, currency, payment_method. "
                   . "CRITICAL: The 'date' field MUST be in YYYY-MM-DD format. "
                   . "In the 'desc' field, provide ONLY the item name. EXCLUDE any SKU numbers, internal item codes, or long numeric prefixes. "
                   . "ONLY return valid JSON.";

        return $c->ai_analyze_image(
            image  => $image,
            mime   => $mime,
            system => $system,
            prompt => "Digitize this receipt accurately.",
            app_profile => 'receipts'
        );
    });

    # Specialized: Generic Image Analysis
    $app->helper(ai_analyze_image => sub {
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

        return $c->ai_prompt(
            contents        => $payload_contents,
            system          => $args{system},
            response_format => 'application/json',
            temp            => 0.1,
            timeout         => 60,
            app_profile     => $args{app_profile}
        );
    });

    # Specialized: Fuel Log Analysis
    # Parameters: Two unordered image blobs and their MIME types.
    # Returns: Promise (JSON payload with extracted fuel log fields and image roles).
    $app->helper(ai_analyze_fuel => sub {
        my ($c, $image1, $mime1, $image2, $mime2) = @_;

        my $today = $c->now->strftime('%Y-%m-%d');
        my $system = "You extract vehicle fuel log data from two images. Current system date: $today. "
                   . "The images may be in any order. First classify each image as odometer, petrol_pump, fuel_receipt, or unknown. "
                   . "Extract odometer, litres, total_amount, station_name, and date. "
                   . "Return only valid JSON. Use null for uncertain values and do not guess. "
                   . "Set needs_review true when required numeric values are missing, confidence is low, images are duplicated, or litres and total_amount are inconsistent.";

        my $prompt = q{
Return only valid JSON using this exact shape:
{
  "odometer": null,
  "litres": null,
  "total_amount": null,
  "station_name": null,
  "date": null,
  "image_roles": {
    "image_1": "unknown",
    "image_2": "unknown"
  },
  "confidence": {
    "odometer": 0,
    "litres": 0,
    "total_amount": 0,
    "station_name": 0,
    "date": 0
  },
  "needs_review": true,
  "review_reasons": []
}
Image 1 follows, then image 2.
};

        my $contents = [{
            role => 'user',
            parts => [
                { text => $prompt },
                { inlineData => { mimeType => $mime1, data => b64_encode($image1, '') } },
                { text => "Image 2 follows." },
                { inlineData => { mimeType => $mime2, data => b64_encode($image2, '') } }
            ]
        }];

        return $c->ai_prompt(
            contents        => $contents,
            system          => $system,
            response_format => 'application/json',
            temp            => 0.1,
            timeout         => 60,
            app_profile     => 'fuel'
        );
    });

    # Specialized: Single Emoji Generation (Sync-friendly wrapper)
    # Note: Returns a promise, but optimized for background speed
    $app->helper(ai_generate_emoji => sub {
        my ($c, $text) = @_;
        
        return $c->ai_prompt(
            contents   => [{ role => 'user', parts => [{ text => $text }] }],
            system     => "Respond ONLY with one emoji character.",
            temp       => 0.1,
            max_tokens => 2048,
            timeout    => 10,
            app_profile => 'emoji_lookup'
        );
    });

}

1;
