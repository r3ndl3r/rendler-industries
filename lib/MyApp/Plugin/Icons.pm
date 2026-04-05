# /lib/MyApp/Plugin/Icons.pm

package MyApp::Plugin::Icons;
use Mojo::Base 'Mojolicious::Plugin';
use utf8;

# Centralized Icon Management Plugin
# Migrated to DB-backed user emojis with memory caching for high performance.

sub register {
    my ($self, $app) = @_;

    # Internal state for user icons (Shared across workers)
    state $user_icons = { unknown => '👤' };

    # Private refresher sub
    my $refresh_cache = sub {
        my $c = shift;
        my $map = $c->db->get_user_emoji_map();
        foreach my $user (keys %$map) {
            $user_icons->{$user} = $map->{$user};
        }
        $app->log->debug("User Icon Cache refreshed from DB (" . (scalar keys %$map) . " users)");
    };

    # 1. Initial State Hydration (at Startup)
    Mojo::IOLoop->next_tick(sub {
        eval {
            # We need a controller context to use DB helper easily
            # but since we're in register, we can access app->db
            my $map = $app->db->get_user_emoji_map();
            foreach my $user (keys %$map) {
                $user_icons->{$user} = $map->{$user};
            }
        };
    });

    # 2. Register Perl Helpers
    
    # getUserIcon('username') - Returns specific user icons from memory cache
    $app->helper(getUserIcon => sub {
        my ($c, $name) = @_;
        return $user_icons->{lc($name // '')} // $user_icons->{unknown} // '👤';
    });

    # Register Injection Helper: icons_json_users (only for user icons)
    $app->helper(icons_json_users => sub {
        return { users => $user_icons };
    });

    # 3. Scheduled Background Refresh (Every 5 minutes)
    Mojo::IOLoop->recurring(300 => sub {
        eval {
            my $map = $app->db->get_user_emoji_map();
            foreach my $user (keys %$map) {
                $user_icons->{$user} = $map->{$user};
            }
        };
    });
}

1;
