# /lib/DB/Settings.pm

package DB::Settings;

use strict;
use warnings;
use Mojo::JSON qw(encode_json decode_json);

# Database helper for application configuration and external API keys.
# Features:
#   - Aggregated retrieval of all system settings
#   - Management of third-party API credentials (Pushover, Gotify, Unsplash)
#   - Management of internal application secrets (Session signing)
# Integration points:
#   - Extends DB package via package injection
#   - Uses "Upsert" logic (Check -> Update/Insert) for single-row configuration tables

# Inject methods into the main DB package

# Retrieves all application settings in a single data structure.
# Parameters: None
# Returns:
#   HashRef containing keys:
#     - pushover: { token => '...', user => '...' }
#     - gotify: { token => '...' }
#     - app_secret: String
#     - unsplash_key: String
# Behavior:
#   - Uses eval blocks to safely return defaults if tables/keys are missing
sub DB::get_all_settings {
    my ($self) = @_;
    
    # Verify database connectivity
    $self->ensure_connection;
    
    my $settings = {};
    
    # Safely fetch Pushover credentials
    eval {
        my $sth = $self->{dbh}->prepare("SELECT * FROM pushover LIMIT 1");
        $sth->execute();
        $settings->{pushover} = $sth->fetchrow_hashref() || { token => '', user => '' };
    };
    
    # Safely fetch Gotify credentials
    eval {
        my $sth = $self->{dbh}->prepare("SELECT * FROM gotify LIMIT 1");
        $sth->execute();
        $settings->{gotify} = $sth->fetchrow_hashref() || { token => '' };
    };
    
    # Safely fetch App Secret (Session signature)
    eval {
        my $sth = $self->{dbh}->prepare("SELECT secret_value FROM app_secrets WHERE key_name = 'mojo_app_secret'");
        $sth->execute();
        my ($secret) = $sth->fetchrow_array();
        $settings->{app_secret} = $secret || '';
    };
    
    # Safely fetch Unsplash API key
    eval {
        my $sth = $self->{dbh}->prepare("SELECT secret_value FROM app_secrets WHERE key_name = 'unsplash_api_key'");
        $sth->execute();
        my ($key) = $sth->fetchrow_array();
        $settings->{unsplash_key} = $key || '';
    };

    # Safely fetch Email/Gmail credentials
    eval {
        my $email_settings = $self->get_email_settings();
        $settings->{email} = $email_settings;
    };

    # Safely fetch Google Cloud API key (TTS/Translation)
    eval {
        my $sth = $self->{dbh}->prepare("SELECT secret_value FROM app_secrets WHERE key_name = 'google_cloud_key'");
        $sth->execute();
        my ($key) = $sth->fetchrow_array();
        $settings->{google_cloud_key} = $key || '';
    };

    # Safely fetch OpenWeatherMap API key
    eval {
        my $sth = $self->{dbh}->prepare("SELECT secret_value FROM app_secrets WHERE key_name = 'owm_api_key'");
        $sth->execute();
        my ($key) = $sth->fetchrow_array();
        $settings->{owm_api_key} = $key || '';
    };

    # Safely fetch Discord bot token
    eval {
        my $sth = $self->{dbh}->prepare("SELECT secret_value FROM app_secrets WHERE key_name = 'discord_bot_token'");
        $sth->execute();
        my ($key) = $sth->fetchrow_array();
        $settings->{discord_token} = $key || '';
    };

    return $settings;
}

# Retrieves the stored Trakt OAuth client ID and secret from app_secrets.
# Returns: HashRef { client_id, client_secret }
sub DB::get_trakt_app_credentials {
    my ($self) = @_;
    $self->ensure_connection;

    my $creds = {
        client_id     => '',
        client_secret => ''
    };

    eval {
        my $sth = $self->{dbh}->prepare("SELECT key_name, secret_value FROM app_secrets WHERE key_name IN ('trakt_client_id', 'trakt_client_secret')");
        $sth->execute();
        while (my ($key, $value) = $sth->fetchrow_array()) {
            $creds->{client_id} = $value if $key eq 'trakt_client_id';
            $creds->{client_secret} = $value if $key eq 'trakt_client_secret';
        }
    };

    return $creds;
}

# Upserts the Trakt OAuth client ID and secret into app_secrets.
# Parameters:
#   client_id     : New Trakt client ID.
#   client_secret : New Trakt client secret.
# Returns: Void.
sub DB::update_trakt_app_credentials {
    my ($self, $client_id, $client_secret) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        q{INSERT INTO app_secrets (key_name, secret_value)
          VALUES (?, ?)
          ON DUPLICATE KEY UPDATE secret_value = VALUES(secret_value)}
    );

    $sth->execute('trakt_client_id', $client_id) if defined $client_id && length $client_id;
    $sth->execute('trakt_client_secret', $client_secret) if defined $client_secret && length $client_secret;
}

# Updates or creates the Pushover API configuration.
# Parameters:
#   token : Application API Token
#   user  : User Key
# Returns: Void
sub DB::update_pushover {
    my ($self, $token, $user) = @_;
    
    $self->ensure_connection;
    
    # Check if a configuration record already exists
    my $sth = $self->{dbh}->prepare("SELECT COUNT(*) FROM pushover");
    $sth->execute();
    my ($count) = $sth->fetchrow_array();
    
    # Perform upsert (Update existing or Insert new)
    if ($count > 0) {
        $sth = $self->{dbh}->prepare("UPDATE pushover SET token = ?, user = ? LIMIT 1");
        $sth->execute($token, $user);
    } else {
        $sth = $self->{dbh}->prepare("INSERT INTO pushover (token, user) VALUES (?, ?)");
        $sth->execute($token, $user);
    }
}

# Updates or creates the Gotify API configuration.
# Parameters:
#   token : Application Token
# Returns: Void
sub DB::update_gotify {
    my ($self, $token) = @_;
    
    $self->ensure_connection;
    
    # Check if a configuration record already exists
    my $sth = $self->{dbh}->prepare("SELECT COUNT(*) FROM gotify");
    $sth->execute();
    my ($count) = $sth->fetchrow_array();
    
    # Perform upsert
    if ($count > 0) {
        $sth = $self->{dbh}->prepare("UPDATE gotify SET token = ? LIMIT 1");
        $sth->execute($token);
    } else {
        $sth = $self->{dbh}->prepare("INSERT INTO gotify (token) VALUES (?)");
        $sth->execute($token);
    }
}

# Updates the application secret used for session cookie signing.
# Parameters:
#   secret : New secret string
# Returns: Void
# Note: Changing this invalidates all active user sessions.
sub DB::update_app_secret {
    my ($self, $secret) = @_;
    
    $self->ensure_connection;
    
    # Check if secret exists in key-value table
    my $sth = $self->{dbh}->prepare("SELECT COUNT(*) FROM app_secrets WHERE key_name = 'mojo_app_secret'");
    $sth->execute();
    my ($count) = $sth->fetchrow_array();
    
    # Perform upsert
    if ($count > 0) {
        $sth = $self->{dbh}->prepare("UPDATE app_secrets SET secret_value = ? WHERE key_name = 'mojo_app_secret'");
        $sth->execute($secret);
    } else {
        $sth = $self->{dbh}->prepare("INSERT INTO app_secrets (key_name, secret_value) VALUES ('mojo_app_secret', ?)");
        $sth->execute($secret);
    }
}

# Retrieves the specific Unsplash API key.
# Parameters: None
# Returns:
#   String (API Key) or empty string if not found.
sub DB::get_unsplash_key {
    my ($self) = @_;
    $self->ensure_connection;
    
    my $key = '';
    # Safely attempt retrieval
    eval {
        my $sth = $self->{dbh}->prepare("SELECT secret_value FROM app_secrets WHERE key_name = 'unsplash_api_key'");
        $sth->execute();
        ($key) = $sth->fetchrow_array();
    };
    
    return $key || '';
}

# Updates the Unsplash API key.
# Parameters:
#   api_key : New API Key string
# Returns: Void
sub DB::update_unsplash_key {
    my ($self, $api_key) = @_;
    $self->ensure_connection;
    
    # Check if key exists in key-value table
    my $sth = $self->{dbh}->prepare("SELECT COUNT(*) FROM app_secrets WHERE key_name = 'unsplash_api_key'");
    $sth->execute();
    my ($count) = $sth->fetchrow_array();
    
    # Perform upsert
    if ($count > 0) {
        $sth = $self->{dbh}->prepare("UPDATE app_secrets SET secret_value = ? WHERE key_name = 'unsplash_api_key'");
        $sth->execute($api_key);
    } else {
        $sth = $self->{dbh}->prepare("INSERT INTO app_secrets (key_name, secret_value) VALUES ('unsplash_api_key', ?)");
        $sth->execute($api_key);
    }
}

# Retrieves Gmail email configuration for SMTP delivery.
# Parameters: None
# Returns:
#   HashRef containing:
#     - gmail_email: Gmail account address
#     - gmail_app_password: App-specific password
#     - from_name: Display name for From header (optional)
sub DB::get_email_settings {
    my ($self) = @_;
    
    $self->ensure_connection;
    
    my $settings = {
        gmail_email => '',
        gmail_app_password => '',
        from_name => ''
    };
    
    eval {
        my $sth = $self->{dbh}->prepare("SELECT key_name, secret_value FROM app_secrets WHERE key_name IN ('gmail_email', 'gmail_app_password', 'gmail_from_name')");
        $sth->execute();
        
        while (my ($key, $value) = $sth->fetchrow_array()) {
            if ($key eq 'gmail_email') {
                $settings->{gmail_email} = $value;
            } elsif ($key eq 'gmail_app_password') {
                $settings->{gmail_app_password} = $value;
            } elsif ($key eq 'gmail_from_name') {
                $settings->{from_name} = $value;
            }
        }
    };
    
    return $settings;
}

# Updates Gmail email configuration.
# Parameters:
#   gmail_email: Gmail account address
#   gmail_app_password: App-specific password
#   from_name: Display name (optional)
# Returns: Void
sub DB::update_email_settings {
    my ($self, $gmail_email, $gmail_app_password, $from_name) = @_;
    
    $self->ensure_connection;
    
    my @keys = (
        ['gmail_email', $gmail_email],
        ['gmail_app_password', $gmail_app_password],
        ['gmail_from_name', $from_name || '']
    );
    
    foreach my $pair (@keys) {
        my ($key_name, $value) = @$pair;
        
        my $sth = $self->{dbh}->prepare("SELECT COUNT(*) FROM app_secrets WHERE key_name = ?");
        $sth->execute($key_name);
        my ($count) = $sth->fetchrow_array();
        
        if ($count > 0) {
            $sth = $self->{dbh}->prepare("UPDATE app_secrets SET secret_value = ? WHERE key_name = ?");
            $sth->execute($value, $key_name);
        } else {
            $sth = $self->{dbh}->prepare("INSERT INTO app_secrets (key_name, secret_value) VALUES (?, ?)");
            $sth->execute($key_name, $value);
        }
    }
}

# Get timer reset time configuration (default 3 PM)
# Parameters: None
# Returns: Integer hour (0-23) for daily timer reset
sub DB::get_timer_reset_hour {
    my ($self) = @_;
    
    $self->ensure_connection();
    
    my $sql = "SELECT secret_value FROM app_secrets WHERE key_name = 'timer_reset_hour'";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute();
    
    my ($val) = $sth->fetchrow_array();
    
    return defined $val ? int($val) : 15;
}

# Set timer reset time configuration
# Parameters:
#   hour : Integer hour (0-23)
# Returns: Boolean success status
sub DB::set_timer_reset_hour {
    my ($self, $hour) = @_;
    
    $self->ensure_connection();
    
    return 0 unless defined $hour && $hour =~ /^\d+$/ && $hour >= 0 && $hour <= 23;
    
    my $check_sql = "SELECT COUNT(*) FROM app_secrets WHERE key_name = 'timer_reset_hour'";
    my ($count) = $self->{dbh}->selectrow_array($check_sql);
    
    if ($count > 0) {
        return $self->{dbh}->do("UPDATE app_secrets SET secret_value = ? WHERE key_name = 'timer_reset_hour'", undef, $hour) > 0;
    } else {
        return $self->{dbh}->do("INSERT INTO app_secrets (key_name, secret_value) VALUES ('timer_reset_hour', ?)", undef, $hour) > 0;
    }
}

# Reads one app_secrets value without exposing table details to registry helpers.
sub _app_secret_value {
    my ($self, $key_name) = @_;
    my $sth = $self->{dbh}->prepare("SELECT secret_value FROM app_secrets WHERE key_name = ?");
    $sth->execute($key_name);
    my ($value) = $sth->fetchrow_array();
    return $value // '';
}

# Writes one app_secrets value, creating the row when it does not exist yet.
sub _upsert_app_secret {
    my ($self, $key_name, $value) = @_;
    my $sth = $self->{dbh}->prepare("SELECT COUNT(*) FROM app_secrets WHERE key_name = ?");
    $sth->execute($key_name);
    my ($count) = $sth->fetchrow_array();

    if ($count > 0) {
        $sth = $self->{dbh}->prepare("UPDATE app_secrets SET secret_value = ? WHERE key_name = ?");
        $sth->execute($value, $key_name);
    } else {
        $sth = $self->{dbh}->prepare("INSERT INTO app_secrets (key_name, secret_value) VALUES (?, ?)");
        $sth->execute($key_name, $value);
    }
}

# Builds the default AI registry for fresh installs.
sub _ai_engine_defaults {
    return {
        default_engine => 'gemini',
        engines => {
            gemini => {
                label           => 'Google Gemini',
                type            => 'gemini',
                enabled         => 1,
                api_key         => '',
                active_model    => 'gemini-3.1-flash-lite',
                fallback_models => ['gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-pro'],
                chat_endpoint   => 'https://generativelanguage.googleapis.com/{api_version}/models/{model}:generateContent?key={api_key}',
                models_endpoint => 'https://generativelanguage.googleapis.com/v1beta/models?key={api_key}',
                capabilities    => ['text', 'image', 'json_mode', 'web_search']
            },
            opencode => {
                label           => 'OpenCode Zen',
                type            => 'openai_compatible',
                enabled         => 1,
                api_key         => '',
                active_model    => 'big-pickle',
                fallback_models => ['big-pickle', 'deepseek-v4-flash-free', 'mimo-v2.5-free', 'qwen3.6-plus-free', 'minimax-m3-free', 'nemotron-3-super-free'],
                chat_endpoint   => 'https://opencode.ai/zen/v1/chat/completions',
                models_endpoint => 'https://opencode.ai/zen/v1/models',
                capabilities    => ['text', 'json_mode']
            },
            local => {
                label           => 'Local LLM',
                type            => 'openai_compatible',
                enabled         => 1,
                api_key         => '',
                active_model    => 'local',
                fallback_models => ['local'],
                chat_endpoint   => 'http://127.0.0.1:8080/v1/chat/completions',
                models_endpoint => '',
                capabilities    => ['text', 'json_mode']
            }
        }
    };
}

# Normalizes one AI engine entry into the supported persisted shape.
sub _normalize_ai_engine {
    my ($id, $engine) = @_;
    return undef unless $id =~ /\A[a-z0-9_]+\z/ && ref $engine eq 'HASH';

    my $fallback_models = ref $engine->{fallback_models} eq 'ARRAY' ? $engine->{fallback_models} : [];
    my $capabilities = ref $engine->{capabilities} eq 'ARRAY' ? $engine->{capabilities} : [];

    return {
        label           => $engine->{label} // $id,
        type            => $engine->{type} // '',
        enabled         => $engine->{enabled} ? 1 : 0,
        api_key         => $engine->{api_key} // '',
        active_model    => $engine->{active_model} // '',
        fallback_models => [ grep { defined $_ && length $_ } @$fallback_models ],
        chat_endpoint   => $engine->{chat_endpoint} // '',
        models_endpoint => $engine->{models_endpoint} // '',
        capabilities    => [ grep { defined $_ && /\A[a-z0-9_]+\z/ } @$capabilities ]
    };
}

# Normalizes a decoded AI registry into the supported persisted shape.
sub _normalize_ai_engine_registry {
    my ($self, $registry, $opts) = @_;
    my $use_defaults = ref $opts eq 'HASH' && $opts->{use_defaults};
    $registry = {} unless ref $registry eq 'HASH';

    my $normalized = $use_defaults ? _ai_engine_defaults() : { default_engine => '', engines => {} };
    my $engines = ref $registry->{engines} eq 'HASH' ? $registry->{engines} : {};

    for my $id (keys %$engines) {
        my $engine = _normalize_ai_engine($id, $engines->{$id});
        $normalized->{engines}{$id} = $engine if $engine;
    }

    my $default_engine = $registry->{default_engine} || $normalized->{default_engine};
    $default_engine = (sort keys %{$normalized->{engines}})[0] || '' unless exists $normalized->{engines}{$default_engine};
    $normalized->{default_engine} = $default_engine;
    return $normalized;
}

# Checks that a normalized registry is safe to persist.
sub _valid_ai_engine_registry {
    my ($registry) = @_;
    return 0 unless ref $registry eq 'HASH' && ref $registry->{engines} eq 'HASH';
    my $default_engine = $registry->{default_engine} || '';
    return 0 unless exists $registry->{engines}{$default_engine};
    return 0 unless $registry->{engines}{$default_engine}{enabled};

    for my $id (keys %{$registry->{engines}}) {
        return 0 unless $id =~ /\A[a-z0-9_]+\z/;
        my $engine = $registry->{engines}{$id};
        return 0 unless ref $engine eq 'HASH';
        return 0 unless ($engine->{type} || '') =~ /\A(?:gemini|openai_compatible)\z/;
        return 0 unless length($engine->{active_model} || '');
        return 0 unless ($engine->{chat_endpoint} || '') =~ m{^https?://\S+$};
        return 0 if length($engine->{models_endpoint} || '') && $engine->{models_endpoint} !~ m{^https?://\S+$};
        return 0 unless ref $engine->{fallback_models} eq 'ARRAY';
        return 0 unless ref $engine->{capabilities} eq 'ARRAY';
        return 0 if grep { !defined $_ || $_ !~ /\A[a-z0-9_]+\z/ } @{$engine->{capabilities}};
    }

    return 1;
}

# Returns the canonical AI engine registry, seeding fresh defaults when absent.
sub DB::get_ai_engine_registry {
    my ($self) = @_;
    $self->ensure_connection;

    my $raw = _app_secret_value($self, 'ai_engine_registry');
    my $registry = eval { decode_json($raw || '') };
    unless (ref $registry eq 'HASH' && ref $registry->{engines} eq 'HASH') {
        $registry = _normalize_ai_engine_registry($self, {}, { use_defaults => 1 });
        _upsert_app_secret($self, 'ai_engine_registry', encode_json($registry));
        return $registry;
    }

    my $normalized = _normalize_ai_engine_registry($self, $registry);
    return $normalized if _valid_ai_engine_registry($normalized);

    $normalized = _normalize_ai_engine_registry($self, {}, { use_defaults => 1 });
    _upsert_app_secret($self, 'ai_engine_registry', encode_json($normalized));
    return $normalized;
}

# Persists a validated AI engine registry.
sub DB::update_ai_engine_registry {
    my ($self, $registry) = @_;
    $self->ensure_connection;
    return 0 unless ref $registry eq 'HASH';

    my $normalized = _normalize_ai_engine_registry($self, $registry);
    return 0 unless _valid_ai_engine_registry($normalized);
    _upsert_app_secret($self, 'ai_engine_registry', encode_json($normalized));
    return 1;
}

# Returns one AI engine configuration by registry id.
sub DB::get_ai_engine {
    my ($self, $engine_id) = @_;
    my $registry = $self->get_ai_engine_registry();
    return $registry->{engines}{$engine_id || ''};
}

# Finds the first enabled engine that advertises the requested capability.
sub DB::get_ai_engine_for_capability {
    my ($self, $capability) = @_;
    my $registry = $self->get_ai_engine_registry();
    my @ids = ($registry->{default_engine}, sort keys %{$registry->{engines} || {}});
    my %seen;

    for my $id (@ids) {
        next unless defined $id && !$seen{$id}++;
        my $engine = $registry->{engines}{$id};
        next unless ref $engine eq 'HASH' && $engine->{enabled};
        my %caps = map { $_ => 1 } @{$engine->{capabilities} || []};
        return $id if $caps{$capability};
    }

    return '';
}

# Returns per-feature AI model overrides keyed by feature profile.
sub DB::get_ai_app_models {
    my ($self) = @_;
    $self->ensure_connection;

    my $raw = '';
    eval {
        my $sth = $self->{dbh}->prepare("SELECT secret_value FROM app_secrets WHERE key_name = 'ai_app_models'");
        $sth->execute();
        ($raw) = $sth->fetchrow_array();
    };

    my $models = {};
    eval { $models = decode_json($raw || '{}') || {}; };
    return ref $models eq 'HASH' ? $models : {};
}

# Resolves a feature profile into an enabled engine/model pair with global fallback.
sub DB::get_ai_model_profile {
    my ($self, $profile_key) = @_;
    my $registry = $self->get_ai_engine_registry();
    my $models = $self->get_ai_app_models();
    my $profile = ref $models->{$profile_key || ''} eq 'HASH' ? $models->{$profile_key} : {};

    my $fallback_provider = $registry->{default_engine} || 'gemini';
    $fallback_provider = $self->get_ai_engine_for_capability('text') || 'gemini'
        unless $registry->{engines}{$fallback_provider} && $registry->{engines}{$fallback_provider}{enabled};

    my $provider = $profile->{provider} || $fallback_provider;
    $provider = $fallback_provider
        unless exists $registry->{engines}{$provider} && $registry->{engines}{$provider}{enabled};

    my $model = $profile->{model} || '';
    if (!length $model) {
        $model = $registry->{engines}{$provider}{active_model} || ($registry->{engines}{$provider}{fallback_models}[0] // '');
    }

    return { provider => $provider, model => $model };
}

# Persists per-feature AI model overrides as a single JSON app_secret value.
sub DB::update_ai_app_models {
    my ($self, $models) = @_;
    $self->ensure_connection;
    return 0 unless ref $models eq 'HASH';

    my $json = encode_json($models);
    my $sth = $self->{dbh}->prepare("SELECT COUNT(*) FROM app_secrets WHERE key_name = 'ai_app_models'");
    $sth->execute();
    my ($count) = $sth->fetchrow_array();

    if ($count > 0) {
        $sth = $self->{dbh}->prepare("UPDATE app_secrets SET secret_value = ? WHERE key_name = 'ai_app_models'");
        $sth->execute($json);
    } else {
        $sth = $self->{dbh}->prepare("INSERT INTO app_secrets (key_name, secret_value) VALUES ('ai_app_models', ?)");
        $sth->execute($json);
    }
    return 1;
}

# Retrieves the Google Cloud API key (TTS/Translation).
sub DB::get_google_cloud_key {
    my ($self) = @_;
    $self->ensure_connection;
    my $key = '';
    eval {
        my $sth = $self->{dbh}->prepare("SELECT secret_value FROM app_secrets WHERE key_name = 'google_cloud_key'");
        $sth->execute();
        ($key) = $sth->fetchrow_array();
    };
    return $key || '';
}

# Updates the Google Cloud API key.
sub DB::update_google_cloud_key {
    my ($self, $api_key) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("SELECT COUNT(*) FROM app_secrets WHERE key_name = 'google_cloud_key'");
    $sth->execute();
    my ($count) = $sth->fetchrow_array();
    if ($count > 0) {
        $sth = $self->{dbh}->prepare("UPDATE app_secrets SET secret_value = ? WHERE key_name = 'google_cloud_key'");
        $sth->execute($api_key);
    } else {
        $sth = $self->{dbh}->prepare("INSERT INTO app_secrets (key_name, secret_value) VALUES ('google_cloud_key', ?)");
        $sth->execute($api_key);
    }
}

# Updates the OpenWeatherMap API key.
sub DB::update_owm_api_key {
    my ($self, $api_key) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("SELECT COUNT(*) FROM app_secrets WHERE key_name = 'owm_api_key'");
    $sth->execute();
    my ($count) = $sth->fetchrow_array();
    if ($count > 0) {
        $sth = $self->{dbh}->prepare("UPDATE app_secrets SET secret_value = ? WHERE key_name = 'owm_api_key'");
        $sth->execute($api_key);
    } else {
        $sth = $self->{dbh}->prepare("INSERT INTO app_secrets (key_name, secret_value) VALUES ('owm_api_key', ?)");
        $sth->execute($api_key);
    }
}

# Attempts to INSERT a gateway_owner row for $pid.
# The table allows only one row (id TINYINT DEFAULT 1, PRIMARY KEY).
# Returns 1 if this worker claimed ownership, 0 if another worker already holds it.
sub DB::try_claim_gateway {
    my ($self, $pid) = @_;
    $self->ensure_connection;
    my $ok = eval {
        $self->{dbh}->do(
            "INSERT INTO gateway_owner (pid, started_at, last_heartbeat) VALUES (?, NOW(), NOW())",
            undef, $pid
        );
        1;
    };
    if ($@) {
        # Ensures system-level visibility if the claim fails for reasons other than
        # a duplicate key. Callers treat 0 as "did not claim" which is correct — but
        # operators need visibility if the INSERT fails for a non-duplicate-key reason.
        warn "try_claim_gateway INSERT failed: $@";
    }
    return $ok ? 1 : 0;
}

# Updates last_heartbeat for $pid so standby workers know this worker is alive.
sub DB::heartbeat_gateway {
    my ($self, $pid) = @_;
    $self->ensure_connection;
    eval {
        $self->{dbh}->do(
            "UPDATE gateway_owner SET last_heartbeat = NOW() WHERE pid = ?",
            undef, $pid
        );
    };
}

# Deletes the gateway_owner row if last_heartbeat is older than $stale_secs.
# Returns 1 if a stale row was removed and ownership is available to claim.
sub DB::reclaim_stale_gateway {
    my ($self, $stale_secs) = @_;
    $self->ensure_connection;
    my $rows = eval {
        $self->{dbh}->do(
            "DELETE FROM gateway_owner WHERE last_heartbeat < DATE_SUB(NOW(), INTERVAL ? SECOND)",
            undef, $stale_secs
        );
    };
    return ($rows && $rows > 0) ? 1 : 0;
}

# Removes this worker's gateway_owner row on clean shutdown or token failure.
sub DB::release_gateway {
    my ($self, $pid) = @_;
    $self->ensure_connection;
    eval {
        $self->{dbh}->do(
            "DELETE FROM gateway_owner WHERE pid = ?",
            undef, $pid
        );
    };
}

# Retrieves the Discord bot token from app_secrets.
# Returns: Token string, or undef if not configured.
sub DB::get_discord_token {
    my ($self) = @_;
    $self->ensure_connection;
    my ($token) = $self->{dbh}->selectrow_array(
        "SELECT secret_value FROM app_secrets WHERE key_name = 'discord_bot_token'"
    );
    return $token || undef;
}

# Stores or updates the Discord bot token in app_secrets.
# Parameters:
#   token : Bot token string
# Returns: Void
sub DB::update_discord {
    my ($self, $token) = @_;
    $self->ensure_connection;

    my ($count) = $self->{dbh}->selectrow_array(
        "SELECT COUNT(*) FROM app_secrets WHERE key_name = 'discord_bot_token'"
    );

    if ($count > 0) {
        my $sth = $self->{dbh}->prepare(
            "UPDATE app_secrets SET secret_value = ? WHERE key_name = 'discord_bot_token'"
        );
        $sth->execute($token);
    } else {
        my $sth = $self->{dbh}->prepare(
            "INSERT INTO app_secrets (key_name, secret_value) VALUES ('discord_bot_token', ?)"
        );
        $sth->execute($token);
    }
}

1;
