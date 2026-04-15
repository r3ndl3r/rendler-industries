# /lib/MyApp/Plugin/Discord.pm

package MyApp::Plugin::Discord;

use Mojo::Base 'Mojolicious::Plugin';
use strict;
use warnings;

# Outbound Discord Notification Plugin.
# Sends DMs directly to Discord's REST API using the configured bot token.
# Replaces the previous Bobbot HTTP bridge path.
#
# Two-step flow per DM:
#   1. POST /users/@me/channels  { recipient_id } -> resolves the DM channel id
#   2. POST /channels/:id/messages { content }    -> delivers the message
#
# Both steps are chained non-blocking promises on the shared app UA.
# Success and failure are both written to the notification log.

sub register {
    my ($self, $app, $config) = @_;

    # Sends a Discord DM to a single user.
    # Parameters:
    #   discord_id : Target user's Discord snowflake ID
    #   text       : Message content string
    #   user_id    : Internal user ID for notification log (optional)
    # Returns: 1 (fire-and-forget; actual result lands in the promise chain)
    $app->helper(send_discord_dm => sub {
        my ($c, $discord_id, $text, $user_id, $caller_id) = @_;
        return 0 unless $discord_id;

        my $token = $c->db->get_discord_token();
        unless ($token) {
            $c->app->log->warn("Discord DM skipped: bot token not configured");
            return 0;
        }

        my $api_base = 'https://discord.com/api/v10';
        my $headers  = {
            Authorization  => "Bot $token",
            'Content-Type' => 'application/json',
        };

        # Step 1: Open (or retrieve) the DM channel for this recipient
        $c->app->ua->post_p(
            "$api_base/users/\@me/channels" => $headers => json => { recipient_id => "$discord_id" }
        )->then(sub {
            my $tx = shift;
            my $res = $tx->result;
            die "open_dm HTTP " . $res->code . ": " . $res->body unless $res->is_success;

            my $channel_id = $res->json->{id}
                or die "open_dm: no channel id in response";

            # Step 2: Post the message to the resolved DM channel
            return $c->app->ua->post_p(
                "$api_base/channels/$channel_id/messages" => $headers => json => { content => $text }
            );
        })->then(sub {
            my $tx = shift;
            my $res = $tx->result;
            die "send_message HTTP " . $res->code . ": " . $res->body unless $res->is_success;

            $c->app->log->info("Discord DM sent to $discord_id");
            $c->db->log_notification(
                user_id   => $user_id,
                caller_id => $caller_id,
                type      => 'discord',
                recipient => $discord_id,
                message   => $text,
                status    => 'success'
            );
        })->catch(sub {
            my $err = shift;
            $c->app->log->error("Discord DM error ($discord_id): $err");
            $c->db->log_notification(
                user_id       => $user_id,
                caller_id     => $caller_id,
                type          => 'discord',
                recipient     => $discord_id,
                message       => $text,
                status        => 'failed',
                error_details => "$err"
            );
            $c->db->enqueue_notification(
                user_id   => $user_id,
                type      => 'discord',
                recipient => $discord_id,
                message   => $text,
            );
        });

        return 1;
    });
}

1;
