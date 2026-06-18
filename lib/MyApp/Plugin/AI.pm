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

    my $payload = {
        model       => $args{model},
        messages    => _opencode_messages(%args),
        temperature => $args{temp} // 0.7,
    };

    if (defined $args{max_tokens}) {
        my $max_tokens = $args{max_tokens};
        $max_tokens = 128 if $max_tokens < 128;
        $payload->{max_tokens} = $max_tokens;
    }

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

# Checks whether a registry engine advertises a capability such as image or web_search.
sub _engine_supports {
    my ($engine, $capability) = @_;
    return 0 unless ref $engine eq 'HASH';
    my %caps = map { $_ => 1 } @{$engine->{capabilities} || []};
    return $caps{$capability} ? 1 : 0;
}

# Expands endpoint templates stored in the AI engine registry.
sub _endpoint_from_template {
    my ($template, %vars) = @_;
    $template ||= '';
    $template =~ s/\{([a-z_]+)\}/defined $vars{$1} ? $vars{$1} : ''/ge;
    return $template;
}

# Selects the Gemini API version required by a model id.
sub _gemini_api_version {
    my ($model) = @_;
    return ($model =~ /preview|exp|2\.[05]|3\./) ? 'v1beta' : 'v1';
}

# Builds the Gemini chat endpoint from the registry engine and selected model.
sub _gemini_endpoint {
    my ($engine, $model) = @_;
    my $api_key = $engine->{api_key} || '';
    my $api_version = _gemini_api_version($model);
    return _endpoint_from_template(
        $engine->{chat_endpoint},
        api_version => $api_version,
        model       => $model,
        api_key     => $api_key
    );
}

# Builds a model-list endpoint from a registry engine.
sub _models_endpoint {
    my ($engine) = @_;
    return _endpoint_from_template(
        $engine->{models_endpoint},
        api_key => $engine->{api_key} || ''
    );
}

# Fetches Gemini models for one registry engine, falling back to configured models.
sub gemini_models_sync {
    my (%args) = @_;
    my $engine = $args{engine} || {};
    my @fallback = @{$engine->{fallback_models} || ['gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-pro']};
    my $api_key = $engine->{api_key} || '';
    return (\@fallback, 'Gemini API key missing') unless $api_key;

    my $ua = $args{ua} || Mojo::UserAgent->new;
    $ua->request_timeout($args{timeout} || 5);

    my $endpoint = _models_endpoint({ %$engine, api_key => $api_key });
    return (\@fallback, 'Gemini models endpoint missing') unless $endpoint;
    my $tx = $ua->get($endpoint);
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

# Fetches OpenAI-compatible models for one registry engine, falling back to configured models.
sub opencode_models_sync {
    my (%args) = @_;
    my $engine = $args{engine} || {};
    my $ua = $args{ua} || Mojo::UserAgent->new;
    $ua->request_timeout($args{timeout} || 5);

    my @fallback = @{$engine->{fallback_models} || ['big-pickle', 'deepseek-v4-flash-free', 'mimo-v2.5-free', 'qwen3.6-plus-free', 'minimax-m3-free', 'nemotron-3-super-free']};
    my $endpoint = _models_endpoint($engine);
    return (\@fallback, '') unless $endpoint;

    my $tx = $ua->get($endpoint);
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

# Posts to an OpenAI-compatible async endpoint with an optional bearer token.
sub _openai_post_p {
    my ($ua, $endpoint, $api_key, $payload) = @_;
    return $api_key
        ? $ua->post_p($endpoint => { Authorization => "Bearer $api_key" } => json => $payload)
        : $ua->post_p($endpoint => json => $payload);
}

# Posts to an OpenAI-compatible sync endpoint with an optional bearer token.
sub _openai_post {
    my ($ua, $endpoint, $api_key, $payload) = @_;
    return $api_key
        ? $ua->post($endpoint => { Authorization => "Bearer $api_key" } => json => $payload)
        : $ua->post($endpoint => json => $payload);
}

# Runs a synchronous AI request from a fully resolved registry engine.
sub ai_prompt_sync {
    my (%args) = @_;
    my $ua = $args{ua} || Mojo::UserAgent->new;
    my $timeout = $args{timeout} || 30;
    $ua->request_timeout($timeout)->inactivity_timeout($timeout);

    my $engine = $args{engine};
    die "AI engine missing" unless ref $engine eq 'HASH';
    my $provider = $args{provider} || $engine->{id} || 'gemini';
    my $fallback_models = ref $engine->{fallback_models} eq 'ARRAY' ? $engine->{fallback_models} : [];
    my $model = $args{model} || $engine->{active_model} || $fallback_models->[0] || '';
    my $debug = $args{debug};
    my $log = sub { warn "[AI] @_\n" if $debug };

    $log->("Sync request provider=$provider model=$model system=" . ($args{system} // '') . " contents=" . substr(($args{contents}[0]{parts}[0]{text} // ''), 0, 200));

    if (($engine->{type} || '') eq 'openai_compatible' && !_has_gemini_only_parts(\%args)) {
        my $endpoint = $engine->{chat_endpoint} || '';
        die "$engine->{label} URL missing" unless $endpoint;
        die "$engine->{label} AI key missing" if ($engine->{id} || '') eq 'opencode' && !$engine->{api_key};

        my $payload = _opencode_payload(%args, model => $model);
        my $tx = _openai_post($ua, $endpoint, $engine->{api_key} || '', $payload);
        my $res = $tx->result;
        die "Network connection failure" unless $res;
        if (!$res->is_success && $args{web_search}) {
            $tx = _openai_post($ua, $endpoint, $engine->{api_key} || '', _opencode_payload_without_web_search($payload));
            $res = $tx->result;
            die "Network connection failure" unless $res;
        }
        if (!$res->is_success && ($args{response_format} // '') eq 'application/json') {
            $tx = _openai_post($ua, $endpoint, $engine->{api_key} || '', _opencode_payload_without_json_mode($payload));
            $res = $tx->result;
            die "Network connection failure" unless $res;
        }
        die _api_error_message($res, "$engine->{label} API error") unless $res->is_success;
        my $text = _opencode_text($res->json || {});
        $log->("Sync response text=" . substr($text, 0, 500));
        return {
            candidates => [{
                content => { parts => [{ text => $text }] }
            }]
        };
    }

    die "Gemini AI key missing" unless $engine->{api_key};
    $model = $args{model} || $engine->{active_model};
    my $payload = {
        contents => $args{contents} || [],
        generationConfig => {
            temperature        => $args{temp} // 0.7,
            response_mime_type => $args{response_format} // 'text/plain'
        }
    };
    if (defined $args{max_tokens}) {
        $payload->{generationConfig}{maxOutputTokens} = $args{max_tokens};
    }
    $payload->{tools} = [{ google_search => {} }] if $args{web_search};
    $payload->{tools} = $args{tools} if $args{tools};
    $payload->{system_instruction} = { parts => [{ text => $args{system} }] } if $args{system};

    my $endpoint = _gemini_endpoint($engine, $model);
    die "$engine->{label} endpoint missing" unless $endpoint;

    my $tx = $ua->post($endpoint => json => $payload);
    my $res = $tx->result;
    die "Network connection failure" unless $res;
    die _api_error_message($res, 'Gemini API error') unless $res->is_success;
    my $json = $res->json;
    $log->("Sync response text=" . substr(($json->{candidates}[0]{content}{parts}[0]{text} // ''), 0, 500));
    return $json;
}

# Sends a non-blocking Gemini request using the resolved registry engine.
sub _gemini_prompt {
    my ($c, %args) = @_;

    my $engine = $args{engine} || $c->db->get_ai_engine('gemini');
    my $api_key = $engine->{api_key} || '';
    my $active_model = $args{model} || $engine->{active_model} || $engine->{fallback_models}[0];

    unless ($api_key) {
        return Mojo::Promise->reject("Gemini AI key missing");
    }

    my $endpoint = _gemini_endpoint($engine, $active_model);
    unless ($endpoint) {
        return Mojo::Promise->reject("Gemini endpoint missing");
    }

    my $payload = {
        contents => $args{contents} || [],
        generationConfig => {
            temperature        => $args{temp} // 0.7,
            response_mime_type => $args{response_format} // 'text/plain'
        }
    };
    if (defined $args{max_tokens}) {
        $payload->{generationConfig}{maxOutputTokens} = $args{max_tokens};
    }

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

# Sends a non-blocking OpenAI-compatible request using the resolved registry engine.
sub _opencode_prompt {
    my ($c, %args) = @_;

    my $engine = $args{engine} || $c->db->get_ai_engine($args{provider} || 'opencode');
    my $api_key = $engine->{api_key} || '';
    my $model = $args{model} || $engine->{active_model} || $engine->{fallback_models}[0];
    my $endpoint = $engine->{chat_endpoint} || '';
    my $label = $engine->{label} || 'OpenAI-compatible AI';

    unless ($endpoint) {
        return Mojo::Promise->reject("$label URL missing");
    }
    if (($engine->{id} || '') eq 'opencode' && !$api_key) {
        return Mojo::Promise->reject("$label key missing");
    }

    my $payload = _opencode_payload(%args, model => $model);

    my $timeout = $args{timeout} || 30;
    my $ua = $c->ua->request_timeout($timeout)->inactivity_timeout($timeout);

    return _openai_post_p($ua, $endpoint, $api_key, $payload)->then(sub {
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
                return _openai_post_p($ua, $endpoint, $api_key, _opencode_payload_without_web_search($payload))
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
                            $c->app->log->error("$label API Error [" . $retry_res->code . "]: " . $msg);
                            return Mojo::Promise->reject($msg || "API Error " . $retry_res->code);
                        }
                        return Mojo::Promise->reject("Network connection failure");
                    });
            } elsif (($args{response_format} // '') eq 'application/json') {
                return _openai_post_p($ua, $endpoint, $api_key, _opencode_payload_without_json_mode($payload))
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
                            $c->app->log->error("$label API Error [" . $retry_res->code . "]: " . $msg);
                            return Mojo::Promise->reject($msg || "API Error " . $retry_res->code);
                        }
                        return Mojo::Promise->reject("Network connection failure");
                    });
            } else {
                my $msg = _api_error_message($res, 'Unknown');
                $c->app->log->error("$label API Error [" . $res->code . "]: " . $msg);
                return Mojo::Promise->reject($msg || "API Error " . $res->code);
            }
        }
        return Mojo::Promise->reject("Network connection failure");
    });
}

# Sends a non-blocking local LLM request through the OpenAI-compatible adapter.
sub _local_prompt {
    my ($c, %args) = @_;

    $args{engine} ||= $c->db->get_ai_engine('local');
    $args{provider} ||= 'local';
    return _opencode_prompt($c, %args);
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

        my $registry = $c->db->get_ai_engine_registry();
        my $profile_key = $args{app_profile} || $args{ai_profile} || $args{app_context} || '';
        my $profile = length $profile_key ? $c->db->get_ai_model_profile($profile_key) : {};
        my $requires_gemini = _has_gemini_only_parts(\%args);
        my $provider = $args{provider} || $profile->{provider} || $registry->{default_engine} || 'gemini';
        $provider = $c->db->get_ai_engine_for_capability('image') || 'gemini' if $requires_gemini;
        $provider = $c->db->get_ai_engine_for_capability('text') || 'gemini'
            unless exists $registry->{engines}{$provider} && $registry->{engines}{$provider}{enabled};
        my $engine = $registry->{engines}{$provider};
        my $model = $args{model};
        $model ||= $profile->{model} if !$requires_gemini && ($profile->{provider} || '') eq $provider;
        $model ||= $engine->{active_model} || $engine->{fallback_models}[0] || '';
        $args{model} = $model;
        $args{provider} = $provider;
        $args{engine} = $engine;
        $args{web_search} = 0 unless _engine_supports($engine, 'web_search');
        $c->ai_debug("Request provider=$provider model=", $model,
            " system=", ($args{system} // ''), " contents=", substr(($args{contents}[0]{parts}[0]{text} // ''), 0, 200));

        my $promise;
        if (($engine->{type} || '') eq 'openai_compatible' && !$requires_gemini) {
            $promise = _opencode_prompt($c, %args);
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

    # Fetches model choices for any registry engine shown in admin settings.
    $app->helper(ai_engine_models => sub {
        my ($c, $engine_id) = @_;
        my $engine = $c->db->get_ai_engine($engine_id);
        return ([], 'Unknown AI engine') unless ref $engine eq 'HASH';
        return gemini_models_sync(ua => $c->ua, engine => $engine) if ($engine->{type} || '') eq 'gemini';
        return opencode_models_sync(ua => $c->ua, engine => $engine) if ($engine->{models_endpoint});
        return ($engine->{fallback_models} || [], '');
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
