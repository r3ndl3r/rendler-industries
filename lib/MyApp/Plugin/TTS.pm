# /lib/MyApp/Plugin/TTS.pm

package MyApp::Plugin::TTS;

use Mojo::Base 'Mojolicious::Plugin';
use Mojo::UserAgent;
use Mojo::JSON qw(encode_json decode_json);
use MIME::Base64 qw(decode_base64);
use strict;
use warnings;
use utf8;

# Google Cloud Text-to-Speech Service Plugin.
# Features:
#   - Synthesizes text to MP3 audio via Google Cloud TTS REST API
#   - Automatic Thai/English language detection based on Unicode character ratios
#   - Supports all BCP-47 language codes (en-AU, th-TH, ja-JP, etc.)
#   - Optional voice name and gender selection
#   - API key retrieved from app_secrets via DB
# Integration points:
#   - Registered in MyApp.pm startup
#   - Exposes global helper '$c->tts_synthesize(%args)'
#   - Relies on DB::get_google_tts_key for credential retrieval

sub register {
    my ($self, $app) = @_;

    $app->helper(tts_synthesize => sub {
        my ($c, %args) = @_;
        # args:
        #   text          : (required) String to synthesize
        #   language_code : BCP-47 language code - auto-detected if omitted
        #   voice_name    : (optional) Specific voice e.g. 'en-AU-Neural2-A'
        #   gender        : (optional) 'MALE', 'FEMALE', or 'NEUTRAL' (default: 'FEMALE')

        my $api_key = $c->db->get_google_cloud_key();
        unless ($api_key) {
            $c->app->log->warn('TTS: Google Cloud API key not configured');
            return { error => 'Google Cloud API key not configured' };
        }

        unless ($args{text}) {
            return { error => 'No text provided' };
        }

        # Optimization: Normalize text for cache consistency
        $args{text} =~ s/^\s+|\s+$//g;

        # Auto-detect language if not explicitly provided (handle empty strings)
        my $language_code = ($args{language_code} || $self->_detect_language($args{text}));
        my $gender        = $args{gender} // 'FEMALE';

        # --- Cache System: Check for existing synthesis ---
        if (my $cached_audio = $c->db->get_tts_cache($args{text}, $language_code)) {
            $c->app->log->info("TTS Cache: Hit for '$language_code' (" . length($args{text}) . " chars)");
            return Mojo::Promise->resolve({
                audio         => $cached_audio,
                language_code => $language_code,
                cached        => 1
            });
        }

        $c->app->log->info("TTS Cache: Miss. Synthesizing in '$language_code' (" . length($args{text}) . " chars)");

        my $voice = { languageCode => $language_code, ssmlGender => $gender };
        $voice->{name} = $args{voice_name} if $args{voice_name};

        my $payload = {
            input       => { text => $args{text} },
            voice       => $voice,
            audioConfig => { audioEncoding => 'MP3' },
        };

        # Optimization: Use shared UserAgent from the app instance
        my $ua  = $c->app->ua;
        my $url = "https://texttospeech.googleapis.com/v1/text:synthesize?key=$api_key";

        # Return a promise for the non-blocking request
        return $ua->post_p($url => json => $payload)->then(sub {
            my $tx = shift;
            
            if (my $err = $tx->error) {
                $c->app->log->error("TTS: API request failed: " . $err->{message});
                return Mojo::Promise->reject($err->{message});
            }

            my $audio_b64 = $tx->result->json->{audioContent};
            unless ($audio_b64) {
                $c->app->log->error('TTS: API returned no audioContent');
                return Mojo::Promise->reject('No audio content returned from API');
            }

            my $audio_blob = decode_base64($audio_b64);

            # --- Cache System: Save new synthesis ---
            $c->db->save_tts_cache($args{text}, $language_code, $audio_blob);

            return {
                audio         => $audio_blob,
                language_code => $language_code,
                cached        => 0
            };
        })->catch(sub {
            my $err = shift;
            $c->app->log->error("TTS: Exception: $err");
            return Mojo::Promise->reject($err);
        });
    });
}

# Detects whether text is predominantly Thai or English.
# Parameters:
#   text : Input string (utf8)
# Returns:
#   BCP-47 language code string ('th-TH' or 'en-AU')
# Behavior:
#   - Counts Thai Unicode characters (U+0E00-U+0E7F)
#   - If Thai chars exceed 20% of total alpha characters, classify as Thai
#   - Falls back to 'en-AU' for purely Latin/mixed text
sub _detect_language {
    my ($self, $text) = @_;

    my @thai_chars  = ($text =~ /[\x{0E00}-\x{0E7F}]/g);
    my @alpha_chars = ($text =~ /[\x{0E00}-\x{0E7F}a-zA-Z]/g);

    return 'en-AU' unless @alpha_chars;

    my $thai_ratio = scalar(@thai_chars) / scalar(@alpha_chars);

    return $thai_ratio >= 0.2 ? 'th-TH' : 'en-AU';
}

1;
