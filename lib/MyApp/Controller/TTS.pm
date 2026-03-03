# /lib/MyApp/Controller/TTS.pm

package MyApp::Controller::TTS;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);
use strict;
use warnings;
use utf8;

# Text-to-Speech Controller
# 
# This controller exposes the Google Cloud TTS plugin to the frontend. 
# It handles request validation and returns raw MP3 binary data.

# API: Synthesize Text
# Route: POST /api/tts/synthesize
# 
# Parameters (JSON):
#   text          : (Required) The string to convert to speech
#   language_code : (Optional) BCP-47 code (auto-detected if omitted)
# 
# Returns:
#   - 200 OK: Raw MP3 binary stream
#   - 400/500 Error: JSON object with error message
sub synthesize {
    my $c = shift;
    
    # Logic: Safe extraction from both form-params and JSON body
    my $json = $c->req->json || {};
    my $text = trim($c->param('text') // $json->{text} // '');
    my $lang = trim($c->param('language_code') // $json->{language_code} // '');

    unless ($text) {
        return $c->render(json => { error => 'Missing text parameter' }, status => 400);
    }

    # Constraint: Google Cloud TTS limit is 5,000 characters
    if (length($text) > 5000) {
        return $c->render(json => { error => 'Text too long (max 5,000 chars)' }, status => 400);
    }

    my $result = $c->tts_synthesize(
        text          => $text,
        language_code => $lang
    );

    if ($result->{error}) {
        return $c->render(json => { error => $result->{error} }, status => 500);
    }

    # Stream the raw audio data to the client with explicit MIME
    $c->res->headers->content_type('audio/mpeg');
    return $c->render(data => $result->{audio});
}

1;
