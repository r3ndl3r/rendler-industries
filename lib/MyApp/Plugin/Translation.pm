# /lib/MyApp/Plugin/Translation.pm

package MyApp::Plugin::Translation;

use Mojo::Base 'Mojolicious::Plugin';
use Mojo::Util qw(trim);
use strict;
use warnings;
use utf8;

# Google Cloud Translation Service Plugin.
# Features:
#   - Translates text via Google Cloud Translation REST API (v2)
#   - Integrated database caching to minimize API costs and latency
#   - Automatic source language detection
#   - Secure authentication via unified google_cloud_key
# Integration points:
#   - Registered in MyApp.pm startup
#   - Exposes global helper '$c->translate_text(%args)'
#   - Relies on DB::get_google_cloud_key for credential retrieval

sub register {
    my ($self, $app) = @_;

    $app->helper(translate_text => sub {
        my ($c, %args) = @_;
        # args:
        #   text   : (required) String to translate
        #   target : (optional) BCP-47 target language code (default: 'th')
        #   source : (optional) BCP-47 source language code (detected if omitted)

        my $api_key = $c->db->get_google_cloud_key();
        unless ($api_key) {
            $c->app->log->warn('Translation: Google Cloud API key not configured');
            return { error => 'Google Cloud API key not configured' };
        }

        unless ($args{text}) {
            return { error => 'No text provided' };
        }

        # Optimization: Normalize text for cache consistency
        my $text = trim($args{text});
        my $target = $args{target} // 'th';

        # --- Cache System: Check for existing translation ---
        if (my $cached = $c->db->get_translation_cache($text, $target)) {
            $c->app->log->info("Translation Cache: Hit for '$target' (" . length($text) . " chars)");
            return Mojo::Promise->resolve({
                translated_text      => $cached->{translated_text},
                detected_source_lang => $cached->{source_lang},
                cached               => 1
            });
        }

        $c->app->log->info("Translation Cache: Miss. Requesting '$target' (" . length($text) . " chars)");

        my $payload = {
            q      => $text,
            target => $target,
            format => 'text'
        };
        $payload->{source} = $args{source} if $args{source};

        # Optimization: Use shared UserAgent from the app instance
        my $ua  = $c->app->ua;
        my $url = "https://translation.googleapis.com/language/translate/v2?key=$api_key";

        return $ua->post_p($url => json => $payload)->then(sub {
            my $tx = shift;

            if (my $err = $tx->error) {
                $c->app->log->error("Translation: API request failed: " . $err->{message});
                return Mojo::Promise->reject($err->{message});
            }

            my $data = $tx->result->json->{data};
            unless ($data && $data->{translations} && @{$data->{translations}}) {
                $c->app->log->error('Translation: API returned no data');
                return Mojo::Promise->reject('No translation returned from API');
            }

            my $result = $data->{translations}[0];
            my $translated_text = $result->{translatedText};
            my $source_lang = $result->{detectedSourceLanguage} // $args{source};

            # --- Cache System: Save new translation ---
            $c->db->save_translation_cache($text, $translated_text, $target, $source_lang);

            return {
                translated_text      => $translated_text,
                detected_source_lang => $source_lang,
                cached               => 0
            };
        })->catch(sub {
            my $err = shift;
            $c->app->log->error("Translation: Exception: $err");
            return Mojo::Promise->reject($err);
        });
    });
}

1;
