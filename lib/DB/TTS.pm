# /lib/DB/TTS.pm

package DB::TTS;

use strict;
use warnings;
use Digest::SHA qw(sha256_hex);
use Encode qw(encode);
use MIME::Base64 qw(encode_base64 decode_base64);

# Database helper for Text-to-Speech audio caching.
# Features:
#   - SHA-256 based fingerprinting for rapid cache lookups
#   - Base64 persistence to guarantee binary integrity across UTF-8 connections
#   - Automated cache hit/miss logic for the TTS plugin

# Retrieves cached audio for a given text and language combination.
# Parameters:
#   text : The synthesized string
#   lang : BCP-47 language code
# Returns:
#   Scalar (Binary audio data) or undef on cache miss
sub DB::get_tts_cache {
    my ($self, $text, $lang) = @_;
    $self->ensure_connection;

    my $stable_string = encode('UTF-8', $text . '|' . $lang);
    my $hash = sha256_hex($stable_string);
    
    my $sth = $self->{dbh}->prepare("SELECT audio_data FROM tts_cache WHERE text_hash = ? LIMIT 1");
    $sth->execute($hash);
    
    my ($b64_audio) = $sth->fetchrow_array();
    
    # Logic: Decode from safe Base64 storage back to raw binary bytes
    return defined $b64_audio ? decode_base64($b64_audio) : undef;
}

# Stores a new synthesis result in the database cache.
# Parameters:
#   text  : The synthesized string
#   lang  : BCP-47 language code
#   audio : Binary audio data (MP3 blob)
# Returns: Boolean success status
sub DB::save_tts_cache {
    my ($self, $text, $lang, $audio) = @_;
    $self->ensure_connection;

    my $stable_string = encode('UTF-8', $text . '|' . $lang);
    my $hash = sha256_hex($stable_string);

    # Logic: Convert binary to Base64 string for safe storage in UTF-8 database
    my $b64_audio = encode_base64($audio);

    eval {
        my $sth = $self->{dbh}->prepare("
            INSERT IGNORE INTO tts_cache (text_hash, text_content, language_code, audio_data)
            VALUES (?, ?, ?, ?)
        ");
        $sth->execute($hash, $text, $lang, $b64_audio);
    };
    if ($@) {
        $self->{app}->log->error("Failed to save TTS cache: $@");
        return 0;
    }

    return 1;
}

1;
