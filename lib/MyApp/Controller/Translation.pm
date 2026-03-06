# /lib/MyApp/Controller/Translation.pm

package MyApp::Controller::Translation;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);
use strict;
use warnings;
use utf8;

# Translation Controller
# 
# This controller exposes the Google Cloud Translation plugin to the frontend. 
# It handles request validation and returns translated text as JSON.

# API: Translate Text
# Route: POST /translation/api/translate
# 
# Parameters (JSON):
#   text   : (Required) The string to translate
#   target : (Optional) Target BCP-47 code (default: 'th')
#   source : (Optional) Source BCP-47 code (detected if omitted)
# 
# Returns:
#   - 200 OK: JSON { translated_text, detected_source_lang, cached }
#   - 400/500 Error: JSON object with error message
sub translate {
    my $c = shift;
    
    # Logic: Safe extraction from both form-params and JSON body
    my $json = $c->req->json || {};
    my $text   = trim($c->param('text') // $json->{text} // '');
    my $target = trim($c->param('target') // $json->{target} // 'th');
    my $source = trim($c->param('source') // $json->{source} // '');

    unless ($text) {
        return $c->render(json => { error => 'Missing text parameter' }, status => 400);
    }

    my $result = $c->translate_text(
        text   => $text,
        target => $target,
        source => $source || undef
    );

    if ($result->{error}) {
        return $c->render(json => { error => $result->{error} }, status => 500);
    }

    # Standard JSON response
    $c->render(json => {
        success              => 1,
        translated_text      => $result->{translated_text},
        detected_source_lang => $result->{detected_source_lang},
        cached               => $result->{cached}
    });
}

1;
