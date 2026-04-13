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
#     - gemini_key: String
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

    # Safely fetch Google Gemini API key
    eval {
        my $sth = $self->{dbh}->prepare("SELECT secret_value FROM app_secrets WHERE key_name = 'gemini_api_key'");
        $sth->execute();
        my ($key) = $sth->fetchrow_array();
        $settings->{gemini_key} = $key || '';
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
        $sth = $self->{dbh}->prepare("UPDATE pushover SET token = ?, user = ? WHERE id = 1");
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
        $sth = $self->{dbh}->prepare("UPDATE gotify SET token = ? WHERE id = 1");
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

# Retrieves the Google Gemini API key.
# Parameters: None
# Returns:
# String (API Key) or empty string if not found
sub DB::get_gemini_key {
    my ($self) = @_;
    $self->ensure_connection;
    my $key = '';
    eval {
        my $sth = $self->{dbh}->prepare("SELECT secret_value FROM app_secrets WHERE key_name = 'gemini_api_key'");
        $sth->execute();
        ($key) = $sth->fetchrow_array();
    };
    return $key || '';
}

# Updates the Google Gemini API key.
# Parameters:
# api_key : New API Key string
# Returns: Void
sub DB::update_gemini_key {
    my ($self, $api_key) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("SELECT COUNT(*) FROM app_secrets WHERE key_name = 'gemini_api_key'");
    $sth->execute();
    my ($count) = $sth->fetchrow_array();
    if ($count > 0) {
        $sth = $self->{dbh}->prepare("UPDATE app_secrets SET secret_value = ? WHERE key_name = 'gemini_api_key'");
        $sth->execute($api_key);
    } else {
        $sth = $self->{dbh}->prepare("INSERT INTO app_secrets (key_name, secret_value) VALUES ('gemini_api_key', ?)");
        $sth->execute($api_key);
    }
}

# Retrieves the list of available Gemini models.
sub DB::get_gemini_models {
    my ($self) = @_;
    $self->ensure_connection;
    my $sql = "SELECT secret_value FROM app_secrets WHERE key_name = 'gemini_models'";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute();
    my ($val) = $sth->fetchrow_array();
    
    # Default list if not set
    if (!$val) {
        return ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
    }
    
    eval { return decode_json($val); } || return [];
}

# Updates the list of available Gemini models.
sub DB::update_gemini_models {
    my ($self, $models_ref) = @_;
    $self->ensure_connection;
    my $models_json = encode_json($models_ref);
    
    my $sth = $self->{dbh}->prepare("SELECT COUNT(*) FROM app_secrets WHERE key_name = 'gemini_models'");
    $sth->execute();
    my ($count) = $sth->fetchrow_array();
    
    if ($count > 0) {
        $sth = $self->{dbh}->prepare("UPDATE app_secrets SET secret_value = ? WHERE key_name = 'gemini_models'");
        $sth->execute($models_json);
    } else {
        $sth = $self->{dbh}->prepare("INSERT INTO app_secrets (key_name, secret_value) VALUES ('gemini_models', ?)");
        $sth->execute($models_json);
    }
}

# Retrieves the active Gemini model.
sub DB::get_gemini_active_model {
    my ($self) = @_;
    $self->ensure_connection;
    my $sql = "SELECT secret_value FROM app_secrets WHERE key_name = 'gemini_active_model'";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute();
    my ($val) = $sth->fetchrow_array();
    return $val // 'gemini-2.5-flash-lite';
}

# Updates the active Gemini model.
sub DB::update_gemini_active_model {
    my ($self, $model) = @_;
    $self->ensure_connection;
    
    my $sth = $self->{dbh}->prepare("SELECT COUNT(*) FROM app_secrets WHERE key_name = 'gemini_active_model'");
    $sth->execute();
    my ($count) = $sth->fetchrow_array();
    
    if ($count > 0) {
        $sth = $self->{dbh}->prepare("UPDATE app_secrets SET secret_value = ? WHERE key_name = 'gemini_active_model'");
        $sth->execute($model);
    } else {
        $sth = $self->{dbh}->prepare("INSERT INTO app_secrets (key_name, secret_value) VALUES ('gemini_active_model', ?)");
        $sth->execute($model);
    }
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
