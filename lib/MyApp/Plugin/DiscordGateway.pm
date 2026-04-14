# /lib/MyApp/Plugin/DiscordGateway.pm

package MyApp::Plugin::DiscordGateway;

use Mojo::Base 'Mojolicious::Plugin';
use Mojo::UserAgent;
use Mojo::JSON qw(encode_json decode_json);
use Mojo::IOLoop;
use Encode qw(decode encode);
use DB;
use strict;
use warnings;

# Discord Gateway Client Plugin (Inbound Messages).
#
# Implements the PID + last_heartbeat ownership model so exactly one Hypnotoad
# worker maintains a persistent WebSocket to the Discord Gateway while all
# others stand by to reclaim if the owner dies.
#
# Ownership lifecycle:
#   - Each worker attempts INSERT into gateway_owner on startup (next_tick).
#   - The first to succeed connects and heartbeats the row every 30s.
#   - Every 90s all non-owning workers check for a stale row; if found they
#     delete it and attempt to claim ownership themselves.
#
# Gateway lifecycle (owning worker):
#   1. GET /gateway/bot  → fetch WSS URL
#   2. WebSocket connect + opcode dispatch loop
#   3. Opcode 10 (Hello)  → start Discord heartbeat + send IDENTIFY (or RESUME)
#   4. Opcode 0  (Dispatch) → route named events; emit 'discord_dm' on DMs
#   5. Opcode 7  (Reconnect) → close cleanly; 'finish' handler reconnects
#   6. Opcode 9  (Invalid Session) → clear session state; re-IDENTIFY
#   7. On 'finish': attempt RESUME if session_id exists, else re-IDENTIFY
#
# Downstream modules subscribe to DM events via:
#   $app->hook(discord_dm => sub { my ($dm) = @_; ... });
#
# $dm hashref keys: author_id, username, content, channel_id, message_id

# Discord Gateway intents bitmask.
# DIRECT_MESSAGES (1<<12): receive DMs directed at the bot.
# Message content in DMs is accessible with this intent alone — the privileged
# MESSAGE_CONTENT intent (1<<15) is only required for guild channel messages.
use constant GATEWAY_INTENTS  => (1 << 12);
use constant GATEWAY_API_BASE => 'https://discord.com/api/v10';

# Seconds of silence before a non-owning worker considers the owner dead.
# Must be longer than the DB heartbeat interval (30s) to avoid false positives.
use constant STALE_SECS => 90;

sub register {
    my ($self, $app, $config) = @_;

    # $gw holds all per-worker gateway state. It is intentionally NOT
    # initialised here (pre-fork). The closures below create it inside
    # next_tick, which fires after Hypnotoad forks the worker, giving each
    # worker a fully independent DB handle and UserAgent.
    my $gw;

    # On worker start: initialise state and attempt to claim gateway ownership.
    Mojo::IOLoop->next_tick(sub {
        eval {
            $gw = {
                ua         => do {
                    my $ua = Mojo::UserAgent->new;
                    $ua->inactivity_timeout(0);  # Gateway WS must never time out
                    $ua;
                },
                db         => DB->new,
                tx         => undef,    # Active WebSocket transaction
                session_id => undef,    # Discord session ID for RESUME
                seq        => undef,    # Last sequence number for RESUME
                hb_timer     => undef,    # Mojo::IOLoop timer for Discord heartbeat
                db_timer     => undef,    # Mojo::IOLoop timer for DB ownership heartbeat
                jitter_timer => undef,    # Mojo::IOLoop timer for Discord startup jitter
                is_owner     => 0,
            };
            _try_claim($app, $gw);
        };
        if ($@) {
            $app->log->error("Discord Gateway: startup error: $@");
            # Ensure the recurring standby timer can detect the broken state
            # and avoid operating on a partially-initialised $gw.
            $gw = undef;
        }
    });

    # All workers: every 90s, delete a stale owner row and try to take over.
    Mojo::IOLoop->recurring(STALE_SECS, sub {
        return unless $gw && !$gw->{is_owner};
        _standby_check($app, $gw);
    });
}

# --- Ownership ---

# Attempts to INSERT the single gateway_owner row for this worker's PID.
# On success, starts the WebSocket connection.
sub _try_claim {
    my ($app, $gw) = @_;
    if ($gw->{db}->try_claim_gateway($$)) {
        $gw->{is_owner} = 1;
        $app->log->info("Discord Gateway: worker $$ claimed ownership");
        _connect($app, $gw);
    }
}

# Non-owning workers call this. Deletes the gateway_owner row if its
# last_heartbeat timestamp is older than STALE_SECS, then attempts to claim.
sub _standby_check {
    my ($app, $gw) = @_;
    if ($gw->{db}->reclaim_stale_gateway(STALE_SECS)) {
        $app->log->warn("Discord Gateway: stale owner evicted; worker $$ reclaiming");
        _try_claim($app, $gw);
        unless ($gw->{is_owner}) {
            # Under contention, a successful reclaim may still lose the claim race.
            # This is expected behavior — log for observability.
            $app->log->info("Discord Gateway: worker $$ lost claim race; staying standby");
        }
    }
}

# --- Connection ---

# Fetches the WSS URL from /gateway/bot and opens the WebSocket.
sub _connect {
    my ($app, $gw) = @_;

    my $token = $gw->{db}->get_discord_token();
    unless ($token) {
        $app->log->warn("Discord Gateway: no bot token configured; gateway disabled");
        $gw->{db}->release_gateway($$);
        $gw->{is_owner} = 0;
        return;
    }

    $gw->{ua}->get_p(
        GATEWAY_API_BASE . '/gateway/bot',
        { Authorization => "Bot $token" }
    )->then(sub {
        my $tx  = shift;
        my $res = $tx->result;
        die "get_gateway_bot HTTP " . $res->code . ": " . $res->body
            unless $res->is_success;
        my $url = ($res->json // {})->{url}
            or die "no url in /gateway/bot response (body: " . $res->body . ")";
        _open_ws($app, $gw, "$url/?v=10&encoding=json", $token);
    })->catch(sub {
        my $err = shift;
        $app->log->error("Discord Gateway: /gateway/bot failed: $err");
        Mojo::IOLoop->timer(15 => sub {
            _connect($app, $gw) if $gw->{is_owner};
        });
    });
}

# Opens the WebSocket and wires up the message and finish handlers.
sub _open_ws {
    my ($app, $gw, $url, $token) = @_;

    $app->log->info("Discord Gateway: connecting to $url");

    $gw->{ua}->websocket_p($url)->then(sub {
        my $tx = shift;
        $tx->max_websocket_size(1048576);  # 1MB — Discord payloads can be large
        $gw->{tx} = $tx;

        $tx->on(message => sub {
            my (undef, $raw) = @_;
            # Sanitise bytes before JSON decoding: some Discord payloads (e.g.
            # user display names) contain malformed UTF-8. Decode with FB_DEFAULT
            # to replace bad bytes with U+FFFD, then re-encode to valid UTF-8.
            my $clean = encode('UTF-8', decode('UTF-8', $raw, Encode::FB_DEFAULT));
            my $msg = eval { decode_json($clean) };
            if ($@) {
                $app->log->error("Discord Gateway: JSON decode error: $@");
                return;
            }
            return unless $msg;
            eval { _handle_op($app, $gw, $msg, $token) };
            $app->log->error("Discord Gateway: handler error: $@") if $@;
        });

        $tx->on(finish => sub {
            my (undef, $code, $reason) = @_;
            $reason //= '';
            $app->log->warn("Discord Gateway: closed (code=$code reason=$reason)");
            _cleanup_timers($gw);
            $gw->{tx} = undef;

            # Do not reconnect on codes that require manual intervention
            # (4004 auth failed, 4013/4014 invalid intents).
            if ($code && ($code == 4004 || $code == 4013 || $code == 4014)) {
                $app->log->error("Discord Gateway: unrecoverable close ($code); releasing ownership");
                $gw->{db}->release_gateway($$);
                $gw->{is_owner} = 0;
                return;
            }

            if ($gw->{is_owner}) {
                Mojo::IOLoop->timer(5 => sub { _connect($app, $gw) });
            }
        });

    })->catch(sub {
        my $err = shift;
        $app->log->error("Discord Gateway: WebSocket connect failed: $err");
        Mojo::IOLoop->timer(10 => sub { _connect($app, $gw) }) if $gw->{is_owner};
    });
}

# --- Opcode dispatch ---

# Routes incoming Gateway messages to the appropriate opcode handler.
# Tracks the sequence number for RESUME payloads.
sub _handle_op {
    my ($app, $gw, $msg, $token) = @_;

    $gw->{seq} = $msg->{s} if defined $msg->{s};
    my $op = $msg->{op} // return;

    if    ($op == 10) { _op_hello($app, $gw, $msg, $token)        }
    elsif ($op == 11) { }   # Heartbeat ACK — acknowledged, nothing to do
    elsif ($op ==  0) { _op_dispatch($app, $gw, $msg)             }
    elsif ($op ==  7) { _op_reconnect($app, $gw)                  }
    elsif ($op ==  9) { _op_invalid_session($app, $gw, $token)    }
    elsif ($op ==  1) { _send_heartbeat($gw)                      }
}

# Opcode 10: Hello. Starts the Discord heartbeat timer and sends IDENTIFY or RESUME.
# heartbeat_interval is in milliseconds; we convert to seconds for IOLoop.
sub _op_hello {
    my ($app, $gw, $msg, $token) = @_;

    my $interval = ($msg->{d}{heartbeat_interval} // 41250) / 1000;
    $app->log->info(sprintf "Discord Gateway: hello received; heartbeat=%.2fs", $interval);

    _cleanup_timers($gw);

    # Discord heartbeat — must fire at the interval Discord specifies
    $gw->{hb_timer} = Mojo::IOLoop->recurring($interval, sub { _send_heartbeat($gw) });

    # DB ownership heartbeat — every 30s so standby workers detect liveness
    $gw->{db_timer} = Mojo::IOLoop->recurring(30 => sub { _db_heartbeat($app, $gw) });

    # Jitter the first heartbeat per Discord spec, then IDENTIFY or RESUME
    $gw->{jitter_timer} = Mojo::IOLoop->timer(rand(1) => sub {
        $gw->{jitter_timer} = undef;
        _send_heartbeat($gw);
        if ($gw->{session_id} && defined $gw->{seq}) {
            _send_resume($gw, $token);
        } else {
            _send_identify($gw, $token);
        }
    });
}

# Opcode 0: Dispatch. Routes named Discord events to their handlers.
sub _op_dispatch {
    my ($app, $gw, $msg) = @_;

    my $event = $msg->{t} // return;
    my $data  = $msg->{d} // {};

    if ($event eq 'READY') {
        $gw->{session_id} = $data->{session_id};
        my $tag = ($data->{user}{username} // '?') . '#' . ($data->{user}{discriminator} // '0');
        $app->log->info("Discord Gateway: READY as $tag (session=$gw->{session_id})");
    }
    elsif ($event eq 'RESUMED') {
        $app->log->info("Discord Gateway: session resumed (seq=$gw->{seq})");
    }
    elsif ($event eq 'MESSAGE_CREATE') {
        _on_message_create($app, $gw, $data);
    }
}

# Opcode 7: Reconnect. Discord wants us to reconnect and resume the session.
# The 'finish' handler in _open_ws will trigger _connect automatically.
sub _op_reconnect {
    my ($app, $gw) = @_;
    $app->log->info("Discord Gateway: server-requested reconnect");
    $gw->{tx}->finish if $gw->{tx} && !$gw->{tx}->is_finished;
}

# Opcode 9: Invalid Session. Session cannot be resumed; must re-IDENTIFY.
# Discord docs: wait a random 1–5s before sending IDENTIFY.
sub _op_invalid_session {
    my ($app, $gw, $token) = @_;
    $app->log->warn("Discord Gateway: invalid session; re-identifying");
    $gw->{session_id} = undef;
    $gw->{seq}        = undef;

    # Halting the Discord heartbeat and DB timers prevents stale heartbeat
    # transmissions while waiting to re-IDENTIFY.
    _cleanup_timers($gw);

    $gw->{jitter_timer} = Mojo::IOLoop->timer(1 + int(rand 4) => sub {
        $gw->{jitter_timer} = undef;
        _send_identify($gw, $token);
    });
}

# --- Event handlers ---

# Handles a MESSAGE_CREATE dispatch event.
# Filters to DMs only (guild_id absent) and non-bot authors, then emits
# 'discord_dm' on the app for downstream command handlers to subscribe to.
sub _on_message_create {
    my ($app, $gw, $data) = @_;

    return if $data->{guild_id};        # Guild message, not a DM
    return if $data->{author}{bot};     # Ignore other bots (and ourselves)

    my $author_id  = $data->{author}{id}       // '';
    my $username   = $data->{author}{username} // '';
    my $content    = $data->{content}          // '';
    my $channel_id = $data->{channel_id}       // '';
    my $message_id = $data->{id}               // '';

    $app->log->info(sprintf "Discord Gateway: DM from %s (%s): %s",
        $username, $author_id, substr($content, 0, 120));

    # Emit via the Mojolicious plugin hook system.
    # Subscribers register with: $app->hook(discord_dm => sub { my ($dm) = @_; ... })
    $app->plugins->emit_hook(discord_dm => {
        author_id  => $author_id,
        username   => $username,
        content    => $content,
        channel_id => $channel_id,
        message_id => $message_id,
    });
}

# --- Gateway send helpers ---

# Sends opcode 1 (Heartbeat) with the last known sequence number.
sub _send_heartbeat {
    my ($gw) = @_;
    return unless $gw->{tx} && !$gw->{tx}->is_finished;
    $gw->{tx}->send(encode_json({ op => 1, d => $gw->{seq} }));
}

# Sends opcode 2 (Identify) with bot token and intent bitmask.
sub _send_identify {
    my ($gw, $token) = @_;
    return unless $gw->{tx} && !$gw->{tx}->is_finished;
    $gw->{tx}->send(encode_json({
        op => 2,
        d  => {
            token      => $token,
            intents    => GATEWAY_INTENTS,
            properties => {
                os      => 'linux',
                browser => 'rendler-industries',
                device  => 'rendler-industries',
            },
        },
    }));
}

# Sends opcode 6 (Resume) to reconnect to an existing session without re-IDENTIFY.
sub _send_resume {
    my ($gw, $token) = @_;
    return unless $gw->{tx} && !$gw->{tx}->is_finished;
    $gw->{tx}->send(encode_json({
        op => 6,
        d  => {
            token      => $token,
            session_id => $gw->{session_id},
            seq        => $gw->{seq},
        },
    }));
}

# --- Housekeeping ---

# Writes a fresh timestamp to the gateway_owner row so standby workers
# know this worker is still alive and connected.
sub _db_heartbeat {
    my ($app, $gw) = @_;
    eval { $gw->{db}->heartbeat_gateway($$) };
    $app->log->error("Discord Gateway: DB heartbeat error: $@") if $@;
}

# Cancels the Discord and DB heartbeat IOLoop timers.
sub _cleanup_timers {
    my ($gw) = @_;
    if ($gw->{hb_timer}) {
        Mojo::IOLoop->remove($gw->{hb_timer});
        $gw->{hb_timer} = undef;
    }
    if ($gw->{db_timer}) {
        Mojo::IOLoop->remove($gw->{db_timer});
        $gw->{db_timer} = undef;
    }
    if ($gw->{jitter_timer}) {
        Mojo::IOLoop->remove($gw->{jitter_timer});
        $gw->{jitter_timer} = undef;
    }
}

1;
