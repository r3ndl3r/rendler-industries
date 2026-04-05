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
    my $general_icons = {};
    my $user_icons    = {};
    
    if (-e $json_path) {
        eval {
            my $raw = decode_json($json_path->slurp);
            
            # 1. Flatten General Icons: Map keywords in arrays back to emoji key
            if ($raw->{general}) {
                foreach my $emoji (keys %{$raw->{general}}) {
                    my $keywords = $raw->{general}{$emoji};
                    foreach my $kw (@$keywords) {
                        $general_icons->{lc($kw)} = $emoji;
                    }
                }
            }

            # 2. Map Users: Direct username to emoji mapping
            if ($raw->{users}) {
                foreach my $user (keys %{$raw->{users}}) {
                    $user_icons->{lc($user)} = $raw->{users}{$user};
                }
            }
        };
        if ($@) {
            $app->log->error("Failed to parse emoji.json: $@");
        }
    } else {
        $app->log->error("emoji.json missing at $json_path");
    }

    # 2. Register Perl Helpers
    
    # icon('name') - Returns general semantic icons
    $app->helper(icon => sub {
        my ($c, $name) = @_;
        return $general_icons->{lc($name)} // '';
    });

    # user_icon('username') - Returns specific user icons
    $app->helper(user_icon => sub {
        my ($c, $name) = @_;
        return $user_icons->{lc($name // '')} // $user_icons->{unknown} // '👤';
    });

    # Register Injection Helper: icons_json
    $app->helper(icons_json => sub {
        my $bytes = path($app->home, 'assets', 'emoji.json')->slurp;
        return decode('UTF-8', $bytes);
    });
}

1;
