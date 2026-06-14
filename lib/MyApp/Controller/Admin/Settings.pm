# /lib/MyApp/Controller/Admin/Settings.pm

package MyApp::Controller::Admin::Settings;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::JSON qw(decode_json);
use Mojo::Util qw(trim);

# Controller for Application Configuration Management.
# Features:
#   - Centralized settings display interface for admins
#   - Handles updates for Pushover, Gotify, Unsplash, App Secret, and Email settings
#   - Dynamic AI engine registry management
#   - Real-time configuration state synchronization
# Integration points:
#   - Restricted to administrative members via router bridge
#   - Depends on DB::Settings for persistence and system maintenance triggers

# Renders the settings management dashboard skeleton.
# Route: GET /admin/settings
# Parameters: None
# Returns: Rendered HTML template 'settings'.
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_admin;
    $c->render('admin/settings');
}

# Returns the consolidated state for the module.
# Route: GET /admin/settings/api/state
# Parameters: None
# Returns: JSON object { settings, email_settings, timer_reset_hour, gemini, google_cloud, success }
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $registry = $c->db->get_ai_engine_registry();

    my $state = {
        settings         => $c->db->get_all_settings(),
        email_settings   => $c->db->get_email_settings(),
        timer_reset_hour => $c->db->get_timer_reset_hour(),
        ai_engine_registry => _public_ai_engine_registry($c, $registry),
        ai_apps          => $c->db->get_ai_app_models(),
        google_cloud     => {
            key => $c->db->get_google_cloud_key()
        },
        trakt             => _public_trakt_credentials($c->db->get_trakt_app_credentials()),
        owm_api_key      => $c->db->get_all_settings()->{owm_api_key},
        success          => 1
    };
    
    $c->render(json => $state);
}

# Processes updates for a specific configuration section.
# Route: POST /admin/settings/update
# Parameters:
#   section : The configuration block to update
# Returns: JSON object { success, message, error }
sub update {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    my $section = $c->param('section') // '';
    
    if ($section eq 'pushover') {
        my $existing = $c->db->get_all_settings()->{pushover} || {};
        my $token = _secret_update_value($c->param('pushover_token')) || ($existing->{token} // '');
        my $user = _secret_update_value($c->param('pushover_user')) || ($existing->{user} // '');
        
        if ($token && $user) {
            $c->db->update_pushover($token, $user);
            return $c->render(json => { success => 1, message => 'Pushover settings updated successfully' });
        } else {
            return $c->render(json => { success => 0, error => 'Pushover token and user are required' });
        }
    }
    elsif ($section eq 'gotify') {
        my $existing = $c->db->get_all_settings()->{gotify} || {};
        my $token = _secret_update_value($c->param('gotify_token')) || ($existing->{token} // '');
        
        if ($token) {
            $c->db->update_gotify($token);
            return $c->render(json => { success => 1, message => 'Gotify settings updated successfully' });
        } else {
            return $c->render(json => { success => 0, error => 'Gotify token is required' });
        }
    }
    elsif ($section eq 'app_secret') {
        my $secret = _secret_update_value($c->param('app_secret'));
        return $c->render(json => { success => 1, message => 'App secret left unchanged' }) unless length $secret;

        if ($secret && length($secret) >= 32) {
            $c->db->update_app_secret($secret);
            return $c->render(json => { success => 1, message => 'App secret updated successfully. Restart required.' });
        } else {
            return $c->render(json => { success => 0, error => 'App secret must be at least 32 characters' });
        }
    }
    elsif ($section eq 'unsplash') {
        my $api_key = _secret_update_value($c->param('unsplash_key'));

        $c->db->update_unsplash_key($api_key) if length $api_key;

        my $msg = $api_key ? 'Unsplash API key updated successfully' : 'Unsplash API key left unchanged';
        return $c->render(json => { success => 1, message => $msg });
    }
    elsif ($section eq 'email') {
        my $existing = $c->db->get_email_settings();
        my $gmail_email = trim($c->param('gmail_email') // '');
        my $gmail_password = _secret_update_value($c->param('gmail_app_password'));
        $gmail_password = $existing->{gmail_app_password} // '' unless length $gmail_password;
        $gmail_password =~ s/\s+//g;
        my $from_name = trim($c->param('gmail_from_name') // '');
        
        if ($gmail_email && $gmail_password) {
            unless ($gmail_email =~ /^[a-zA-Z0-9._%+-]+\@gmail\.com$/) {
                return $c->render(json => { success => 0, error => 'Invalid Gmail address (must be @gmail.com)' });
            }
            
            $c->db->update_email_settings($gmail_email, $gmail_password, $from_name);
            return $c->render(json => { success => 1, message => 'Email settings updated successfully' });
        } else {
            return $c->render(json => { success => 0, error => 'Gmail email and app password are required' });
        }
    }
    elsif ($section eq 'timers') {
        my $reset_hour = $c->param('timer_reset_hour');
        
        unless (defined $reset_hour && $reset_hour =~ /^\d+$/ && $reset_hour >= 0 && $reset_hour <= 23) {
            return $c->render(json => { success => 0, error => 'Invalid timer reset hour (must be 0-23)' });
        }
        
        $c->db->set_timer_reset_hour($reset_hour);
        
        my $display_hour = $reset_hour == 0 ? '12:00 AM' 
                         : $reset_hour < 12 ? sprintf("%d:00 AM", $reset_hour)
                         : $reset_hour == 12 ? '12:00 PM'
                         : sprintf("%d:00 PM", $reset_hour - 12);
        
        return $c->render(json => { success => 1, message => "Timer reset time set to $display_hour" });
    }
    elsif ($section eq 'ai_engine_registry') {
        my $raw = $c->param('ai_engine_registry') // '{}';
        my $payload = eval { decode_json($raw) };
        return $c->render(json => { success => 0, error => 'Invalid AI engine registry' }) if $@ || ref $payload ne 'HASH';
        my $current = $c->db->get_ai_engine_registry();
        my ($registry, $error) = _validate_ai_engine_registry_payload($payload, $current);
        return $c->render(json => { success => 0, error => $error }) if $error;

        unless ($c->db->update_ai_engine_registry($registry)) {
            return $c->render(json => { success => 0, error => 'AI engine registry was not saved' });
        }
        return $c->render(json => { success => 1, message => 'AI engines updated successfully' });
    }
    elsif ($section eq 'ai_app_models') {
        my $raw = $c->param('ai_app_models') // '[]';
        my $rows = eval { decode_json($raw) } || [];
        return $c->render(json => { success => 0, error => 'Invalid AI feature defaults' }) unless ref $rows eq 'ARRAY';

        my %models;
        for my $row (@$rows) {
            return $c->render(json => { success => 0, error => 'Invalid AI feature default row' }) unless ref $row eq 'HASH';
            my $profile_key = trim($row->{key} // '');
            my $provider = trim($row->{provider} // '');
            my $model = trim($row->{model} // '');

            unless (_valid_ai_app_key($profile_key)) {
                return $c->render(json => { success => 0, error => 'Invalid AI feature' });
            }
            unless (_valid_ai_engine_id($c, $provider)) {
                return $c->render(json => { success => 0, error => 'Invalid AI provider' });
            }
            return $c->render(json => { success => 0, error => 'Invalid AI model' }) unless length $model;

            $models{$profile_key} = { provider => $provider, model => $model };
        }

        $c->db->update_ai_app_models(\%models);
        return $c->render(json => { success => 1, message => 'AI feature defaults updated successfully' });
    }
    elsif ($section eq 'google_cloud') {
        my $api_key = _secret_update_value($c->param('google_cloud_key'));
        $c->db->update_google_cloud_key($api_key) if length $api_key;
        my $msg = $api_key ? 'Google Cloud API key updated successfully' : 'Google Cloud API key left unchanged';
        return $c->render(json => { success => 1, message => $msg });
    }
    elsif ($section eq 'openweathermap') {
        my $api_key = _secret_update_value($c->param('owm_api_key'));
        $c->db->update_owm_api_key($api_key) if length $api_key;
        my $msg = $api_key ? 'OpenWeatherMap API key updated successfully' : 'OpenWeatherMap API key left unchanged';
        return $c->render(json => { success => 1, message => $msg });
    }
    elsif ($section eq 'discord') {
        my $token = _secret_update_value($c->param('discord_token')) || ($c->db->get_discord_token() // '');
        unless ($token) {
            return $c->render(json => { success => 0, error => 'Bot token is required' });
        }
        $c->db->update_discord($token);
        return $c->render(json => { success => 1, message => 'Discord bot token updated successfully' });
    }
    elsif ($section eq 'trakt') {
        my $existing = $c->db->get_trakt_app_credentials();
        my $client_id = _secret_update_value($c->param('trakt_client_id')) || ($existing->{client_id} // '');
        my $client_secret = _secret_update_value($c->param('trakt_client_secret')) || ($existing->{client_secret} // '');

        unless ($client_id && $client_secret) {
            return $c->render(json => { success => 0, error => 'Trakt client ID and client secret are required' });
        }

        $c->db->update_trakt_app_credentials($client_id, $client_secret);
        return $c->render(json => { success => 1, message => 'Trakt API credentials updated successfully' });
    }

    return $c->render(json => { success => 0, error => 'Unknown settings section' });
}

# Validates submitted AI engine JSON and preserves stored secrets for blank key fields.
sub _validate_ai_engine_registry_payload {
    my ($payload, $current) = @_;
    return (undef, 'Invalid AI engine registry') unless ref $payload eq 'HASH' && ref $current eq 'HASH';

    my $submitted = $payload->{engines};
    my @rows;
    if (ref $submitted eq 'HASH') {
        @rows = map {
            my $row = ref $submitted->{$_} eq 'HASH' ? { %{$submitted->{$_}} } : {};
            $row->{id} = $_;
            $row;
        } sort keys %$submitted;
    } elsif (ref $submitted eq 'ARRAY') {
        @rows = @$submitted;
    } else {
        return (undef, 'Invalid AI engine rows');
    }
    return (undef, 'At least one AI engine is required') unless @rows;

    my $default_engine = trim($payload->{default_engine} // '');
    return (undef, 'Invalid default AI engine') unless $default_engine =~ /\A[a-z0-9_]+\z/;

    my %engines;
    for my $row (@rows) {
        return (undef, 'Invalid AI engine row') unless ref $row eq 'HASH';
        my $id = trim($row->{id} // '');
        return (undef, 'Invalid AI engine') unless $id =~ /\A[a-z0-9_]+\z/;

        my $existing = ref $current->{engines}{$id} eq 'HASH' ? $current->{engines}{$id} : {};
        my $type = trim($row->{type} // ($existing->{type} || ''));
        return (undef, 'Invalid AI engine type') unless $type eq 'gemini' || $type eq 'openai_compatible';

        my $chat_endpoint = trim($row->{chat_endpoint} // '');
        return (undef, 'AI chat endpoint must start with http:// or https://')
            unless $chat_endpoint =~ m{^https?://\S+$};

        my $models_endpoint = trim($row->{models_endpoint} // '');
        return (undef, 'AI models endpoint must start with http:// or https://')
            if length($models_endpoint) && $models_endpoint !~ m{^https?://\S+$};

        my $active_model = trim($row->{active_model} // '');
        return (undef, 'Invalid AI active model') unless length $active_model;

        my $api_key = _secret_update_value($row->{api_key});
        $api_key = $existing->{api_key} // '' unless length $api_key;
        my $existing_fallbacks = ref $existing->{fallback_models} eq 'ARRAY' ? $existing->{fallback_models} : [];
        my $existing_caps = ref $existing->{capabilities} eq 'ARRAY' ? $existing->{capabilities} : [];
        my $fallback_models = ref $row->{fallback_models} eq 'ARRAY' ? $row->{fallback_models} : $existing_fallbacks;
        my $capabilities = ref $row->{capabilities} eq 'ARRAY' ? $row->{capabilities} : $existing_caps;

        $engines{$id} = {
            label           => trim($row->{label} // $existing->{label} // $id),
            type            => $type,
            enabled         => $row->{enabled} ? 1 : 0,
            api_key         => $api_key,
            active_model    => $active_model,
            fallback_models => [ grep { defined $_ && length $_ } @$fallback_models ],
            chat_endpoint   => $chat_endpoint,
            models_endpoint => $models_endpoint,
            capabilities    => [ grep { defined $_ && /\A[a-z0-9_]+\z/ } @$capabilities ]
        };
    }

    return (undef, 'Default AI engine must be enabled')
        unless $engines{$default_engine} && $engines{$default_engine}{enabled};

    return ({
        default_engine => $default_engine,
        engines        => \%engines
    }, undef);
}

# Returns a UI-safe copy of the registry with secrets redacted and model choices attached.
sub _public_ai_engine_registry {
    my ($c, $registry) = @_;
    my %engines;

    for my $id (sort keys %{$registry->{engines} || {}}) {
        my $engine = $registry->{engines}{$id};
        next unless ref $engine eq 'HASH';
        my ($models, $model_error) = $c->ai_engine_models($id);
        $engines{$id} = {
            %$engine,
            api_key => '',
            api_key_configured => length($engine->{api_key} || '') ? 1 : 0,
            models => $models,
            model_error => $model_error
        };
    }

    return {
        default_engine => $registry->{default_engine},
        engines        => \%engines
    };
}

sub _public_trakt_credentials {
    my ($creds) = @_;
    $creds ||= {};
    return {
        client_id_configured     => length($creds->{client_id} || '') ? 1 : 0,
        client_secret_configured => length($creds->{client_secret} || '') ? 1 : 0
    };
}

# Checks whether a submitted AI feature key is one the settings UI owns.
sub _valid_ai_app_key {
    my ($key) = @_;
    return scalar grep { $_ eq $key } qw(
        ai_chat
        notes_format
        emoji_lookup
        receipts
        fuel
        rubiks
        automator_report
    );
}

# Checks whether a submitted AI engine id exists in the current registry.
sub _valid_ai_engine_id {
    my ($c, $engine_id) = @_;
    my $registry = $c->db->get_ai_engine_registry();
    return exists $registry->{engines}{$engine_id || ''};
}

# Normalizes secret field submissions so placeholders never overwrite real values.
sub _secret_update_value {
    my ($value) = @_;
    $value = trim($value // '');
    return '' unless length $value;
    return '' if $value =~ /\A\(configured\b/i;
    return '' if $value =~ /\A[\*\x{2022}]{4,}\z/;
    return $value;
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{admin}->get('/admin/settings')->to('admin-settings#index');
    $r->{admin}->get('/admin/settings/api/state')->to('admin-settings#api_state');
    $r->{admin}->post('/admin/settings/update')->to('admin-settings#update');
}

1;
