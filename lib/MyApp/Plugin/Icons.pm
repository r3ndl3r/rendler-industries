# /lib/MyApp/Plugin/Icons.pm

package MyApp::Plugin::Icons;
use Mojo::Base 'Mojolicious::Plugin';
use Mojo::JSON qw(decode_json);
use Mojo::File qw(path);
use Mojo::Util qw(decode);

# Centralized Icon Management Plugin
# Synchronizes semantic icon mappings between Perl and JavaScript using assets/emoji.json.

sub register {
    my ($self, $app) = @_;

    # 1. Load mappings from centralized JSON asset
    my $json_path = path($app->home, 'assets', 'emoji.json');
    my $icons_ref = {};
    
    if (-e $json_path) {
        eval {
            $icons_ref = decode_json($json_path->slurp);
        };
        if ($@) {
            $app->log->error("Failed to parse emoji.json: $@");
        }
    } else {
        $app->log->error("emoji.json missing at $json_path");
    }

    # 2. Register Perl Helper: icon('name')
    # Returns the icon string for a given semantic name.
    $app->helper(icon => sub {
        my ($c, $name) = @_;
        return $icons_ref->{lc($name)} // $name;
    });

    # 3. Register Injection Helper: icons_json
    # Returns the raw JSON string for frontend hydration.
    $app->helper(icons_json => sub {
        my $bytes = path($app->home, 'assets', 'emoji.json')->slurp;
        return decode('UTF-8', $bytes);
    });
}

1;
