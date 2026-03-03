# /lib/DB/Translation.pm

package DB::Translation;

use strict;
use warnings;
use Digest::SHA qw(sha256_hex);
use Encode qw(encode);

# Database helper for Translation caching.
# Features:
#   - SHA-256 fingerprinting for (Text + Target Lang) pairs
#   - Persistent storage of translated strings to minimize API costs
#   - Integrated cache hit/miss logic for the Translation plugin

# Retrieves a cached translation if available.
# Parameters:
#   text   : The source text
#   target : Target BCP-47 language code
# Returns:
#   HashRef { translated_text, source_lang } or undef
sub DB::get_translation_cache {
    my ($self, $text, $target) = @_;
    $self->ensure_connection;

    my $stable_string = encode('UTF-8', $text . '|' . $target);
    my $hash = sha256_hex($stable_string);
    
    my $sth = $self->{dbh}->prepare("
        SELECT translated_text, source_lang 
        FROM translation_cache 
        WHERE text_hash = ? LIMIT 1
    ");
    $sth->execute($hash);
    
    return $sth->fetchrow_hashref();
}

# Stores a new translation result in the cache.
# Parameters:
#   source_text     : The original text
#   translated_text : The resulting text
#   target_lang     : Target language code
#   source_lang     : Detected source language code
# Returns: Boolean success status
sub DB::save_translation_cache {
    my ($self, $source_text, $translated_text, $target_lang, $source_lang) = @_;
    $self->ensure_connection;

    my $stable_string = encode('UTF-8', $source_text . '|' . $target_lang);
    my $hash = sha256_hex($stable_string);

    eval {
        my $sth = $self->{dbh}->prepare("
            INSERT IGNORE INTO translation_cache 
            (text_hash, source_text, translated_text, target_lang, source_lang)
            VALUES (?, ?, ?, ?, ?)
        ");
        $sth->execute($hash, $source_text, $translated_text, $target_lang, $source_lang);
    };
    if ($@) {
        $self->{app}->log->error("Failed to save Translation cache: $@");
        return 0;
    }

    return 1;
}

1;
