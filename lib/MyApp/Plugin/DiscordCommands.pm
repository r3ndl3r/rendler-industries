# /lib/MyApp/Plugin/DiscordCommands.pm

package MyApp::Plugin::DiscordCommands;

use Mojo::Base 'Mojolicious::Plugin';
use Mojo::JSON qw(encode_json);
use strict;
use warnings;

# Discord Bot Command Handler Plugin.
#
# Subscribes to the 'discord_dm' hook emitted by DiscordGateway and routes
# inbound DM text to command handlers keyed on a leading '!' prefix.
#
# Reply path: Discord DM payloads include the channel_id for the existing DM
# channel, so replies post directly to /channels/:id/messages without a
# separate channel-open step.
#
# Adding a command:
#   1. Add an entry to the %COMMANDS dispatch table pointing to a sub.
#   2. The sub receives ($app, $dm, $user) where $user is the matched DB row
#      (undef if the sender has no account) and returns the reply string.
#
# $dm hashref keys: author_id, username, content, channel_id, message_id

use constant API_BASE => 'https://discord.com/api/v10';

# Command dispatch table.
# Keys are the bare command word (lowercase, without the '!' prefix).
# Values are coderefs: ($app, $dm, $user) -> $reply_string
my %COMMANDS = (
    account => \&_cmd_account,
);

sub register {
    my ($self, $app, $config) = @_;

    $app->hook(discord_dm => sub {
        my ($dm) = @_;

        my $content = $dm->{content} // '';
        return unless $content =~ /^!(\S+)/;

        my $cmd = lc $1;
        my $handler = $COMMANDS{$cmd} or return;

        my $user = eval { $app->db->get_user_by_discord_id($dm->{author_id}) };
        if ($@) {
            $app->log->error("DiscordCommands: DB lookup error: $@");
            return;
        }

        my $reply = eval { $handler->($app, $dm, $user) };
        if ($@) {
            $app->log->error("DiscordCommands: handler error for !$cmd: $@");
            return;
        }

        _send_reply($app, $dm->{channel_id}, $reply) if defined $reply;
    });
}

# --- Command handlers ---

# !account — returns the sender's username, email, and permission flags.
# Replies with a denial if the Discord account is not linked to any user row.
sub _cmd_account {
    my ($app, $dm, $user) = @_;

    unless ($user) {
        return "Your Discord account is not linked to any account on this server.";
    }

    my @perms;
    push @perms, 'Admin'  if $user->{is_admin};
    push @perms, 'Family' if $user->{is_family};
    push @perms, 'Child'  if $user->{is_child};
    my $perm_str = @perms ? join(', ', @perms) : 'Standard';

    # Mask email: show only the domain and first character of the local part
    # to confirm linkage without transmitting the full address over Discord.
    my $masked_email = '';
    if ($user->{email} && $user->{email} =~ /^(.)([^@]*)(@.+)$/) {
        $masked_email = $1 . ('*' x length($2)) . $3;
    }

    return join("\n",
        '**Account Info**',
        "Username:    $user->{username}",
        "Email:       $masked_email",
        "Permissions: $perm_str",
        "Status:      $user->{status}",
    );
}

# --- Reply helper ---

# Posts a text message to a Discord channel using the bot token.
# Uses the existing app-level UA (non-blocking, fire-and-forget).
sub _send_reply {
    my ($app, $channel_id, $text) = @_;

    my $token = eval { $app->db->get_discord_token() };
    unless ($token) {
        $app->log->warn("DiscordCommands: no bot token; cannot send reply");
        return;
    }

    $app->ua->post_p(
        API_BASE . "/channels/$channel_id/messages",
        { Authorization => "Bot $token", 'Content-Type' => 'application/json' },
        json => { content => $text },
    )->then(sub {
        my $tx = shift;
        unless ($tx->result->is_success) {
            $app->log->error(
                "DiscordCommands: reply failed (HTTP " . $tx->result->code . "): " . $tx->result->body
            );
        }
    })->catch(sub {
        $app->log->error("DiscordCommands: reply error: " . shift);
    });
}

1;
