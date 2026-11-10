# /lib/MyApp/Controller/Trakt.pm

package MyApp::Controller::Trakt;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::JSON qw(decode_json encode_json from_json);
use Mojo::Promise;
use Mojo::IOLoop;
use Mojo::URL;
use Mojo::Util qw(trim url_escape secure_compare);
use Crypt::PRNG qw(random_bytes);
use Digest::SHA qw(sha256 hmac_sha256);
use MIME::Base64 qw(encode_base64url decode_base64url);

# Controller for Trakt OAuth integration and media management.
#
# Features:
#   - Per-user OAuth authentication with automatic token refresh.
#   - Full Trakt data sync (watchlist, lists, upcoming, watched state).
#   - Show details with season/episode progress and watched toggle.
#   - Search, list CRUD, and history management.
#
# Integration Points:
#   - Depends on DB::Trakt for data persistence and caching.
#   - Depends on DB::Settings for app-level API credentials.
#   - Consumes the Trakt v2 REST API for all external operations.

my $TRAKT_API  = 'https://api.trakt.tv';
my $TRAKT_AUTH = 'https://auth.trakt.tv/oauth/authorize';
my $TRAKT_TOKEN = 'https://auth.trakt.tv/oauth/token';
my $WATCHLIST_NAME = 'Watchlist';
my $UNWATCHED_CACHE_GENERATION = 0;
my $REQUEST_TIMEOUT = 20;

# Holds a dedicated, non-reentrant DB session lease until asynchronous work settles.
sub _with_lease_p {
    my ($c, $name, $work) = @_;
    my ($dbh, $locked);
    my $ok = eval {
        $dbh = $c->db->{dbh}->clone({ AutoCommit => 1, RaiseError => 1, PrintError => 0 });
        $locked = $dbh->selectrow_array('SELECT GET_LOCK(?, 0)', undef, $name);
        die 'Another Trakt operation is still in progress' unless $locked;
        1;
    };
    unless ($ok) {
        my $error = $@;
        eval { $dbh->disconnect } if $dbh;
        return Mojo::Promise->reject($error);
    }
    my $promise = eval { $work->() };
    $promise = Mojo::Promise->reject($@) if $@;
    $promise = Mojo::Promise->resolve($promise) unless ref $promise && eval { $promise->isa('Mojo::Promise') };
    return $promise->finally(sub {
        eval { $dbh->selectrow_array('SELECT RELEASE_LOCK(?)', undef, $name) };
        eval { $dbh->disconnect };
    });
}

# Runs an endpoint promise with consistent error rendering and no nested event loop.
sub _render_p {
    my ($c, $work) = @_;
    $c->render_later;
    my $promise = eval { $work->() };
    $promise = Mojo::Promise->reject($@) if $@;
    $promise->catch(sub {
        my $error = shift || 'Unable to complete Trakt operation';
        my $message = 'Unable to complete Trakt operation; try refreshing again';
        $message = 'Trakt changed while refreshing; please refresh again' if $error =~ /TRAKT_SYNC_STALE/;
        $message = 'Connect Trakt first' if $error =~ /TRAKT_SYNC_DISCONNECTED|Connect Trakt first/;
        $message = 'Another Trakt operation is still in progress' if $error =~ /Another Trakt operation/;
        $message = 'Trakt request timed out' if $error =~ /Trakt request timed out/;
        $message = $1 if $error =~ /\A(Trakt API HTTP \d+(?:; Retry-After: [0-9]+)?)/;
        $message = 'Trakt did not accept all selected items' if $error =~ /Trakt did not accept/;
        $c->app->log->warn('Trakt operation failed for ' . $c->req->url->path . ": $message");
        _json_error($c, $message);
    });
    return undef;
}

# Executes independent authenticated reads with at most four requests in flight.
sub _read_many_p {
    my ($c, @paths) = @_;
    return _ensure_token_p($c)->then(sub {
        my $token = shift;
        die 'Connect Trakt first' unless $token;
        return Mojo::Promise->map({ concurrency => 4 }, sub {
            _trakt_request_p($c, 'GET', shift, undef, $token)->then(sub {
                return { data => shift };
            })->catch(sub { return { error => shift } });
        }, @paths);
    })->then(sub {
        my @results = map { $_->[0] } @_;
        die $_->{error} for grep { exists $_->{error} } @results;
        return [map { $_->{data} } @results];
    });
}

# Serializes remote mutations and fences cache snapshots on both sides of remote I/O.
sub _mutation_p {
    my ($c, $work) = @_;
    return _ensure_token_p($c)->then(sub {
        die 'Connect Trakt first' unless shift;
        return _with_lease_p($c, 'trakt_mutation_' . $c->current_user_id, sub {
            die 'Unable to prepare Trakt update' unless _begin_cache_mutation($c);
            my $revision = $c->db->get_trakt_cache_revision($c->current_user_id);
            return $work->($revision);
        });
    });
}

# Renders the Trakt dashboard skeleton.
# Route: GET /trakt
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family;
    $c->render('trakt');
}

# Returns cached dashboard state; unwatched rebuilding uses its dedicated endpoint.
# Route: GET /trakt/api/state
# Returns: JSON { success, configured, connection, lists, upcoming, unwatched, unwatched_stale? }
sub api_state {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);

    my $state = eval { _dashboard_state($c) };
    if ($@) {
        $c->app->log->error("Trakt state failed: $@");
        return $c->render(json => { success => 0, error => 'Trakt tables are not ready' });
    }

    $state->{success} = 1;
    $state->{configured} = _trakt_configured($c) ? 1 : 0;
    return $c->render(json => $state);
}

# Returns cached unwatched data or rebuilds it with bounded concurrent Trakt requests.
# Route: GET /trakt/api/unwatched
# Returns: JSON { success, unwatched, unwatched_counts, stale?, outdated? }
sub api_unwatched {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);

    return _render_p($c, sub {
    my ($cache_marker, $stale);
    return _ensure_token_p($c)->then(sub {
    die 'Connect Trakt first' unless shift;
    return _with_lease_p($c, 'trakt_unwatched_' . $c->current_user_id, sub {
    my $refresh = _prepare_unwatched_refresh($c);
    die $refresh->{error} if $refresh->{error};
    if (ref $refresh->{cached} eq 'ARRAY') {
        return Mojo::Promise->resolve(_unwatched_payload($refresh->{cached}, $c));
    }
    $cache_marker = $refresh->{marker};
    $stale = $refresh->{stale};
    my $lists = $c->db->get_trakt_lists($c->current_user_id);
    my ($watchlist) = grep { $_->{is_watchlist} } @$lists;
    my $watchlist_media = _watchlist_media_lookup($watchlist);
    my @show_ids = sort { $a <=> $b } keys %{$watchlist_media->{show} || {}};
    unless (@show_ids) {
        my $stored = $c->db->compare_and_set_trakt_unwatched_cache(
            $c->current_user_id,
            $cache_marker,
            [],
        );
        my $payload = _unwatched_payload([], $c);
        $payload->{outdated} = 1 unless $stored;
        return Mojo::Promise->resolve($payload);
    }

    my @paths = map { ('/shows/' . $_ . '/seasons?extended=full,episodes',
        '/shows/' . $_ . '/progress/watched?hidden=false&specials=false&count_specials=false') } @show_ids;
    return _read_many_p($c, @paths)->then(sub {
        my $rows = shift;
        my @items;
        for my $i (0 .. $#show_ids) {
            my $id = $show_ids[$i];
            push @items, @{_unwatched_items_for_show($c, $id, $watchlist_media->{show}{$id},
                $rows->[$i * 2], $rows->[$i * 2 + 1])};
        }
        @items = sort { ($b->{first_aired} || '') cmp ($a->{first_aired} || '') } @items;
        my $stored = $c->db->compare_and_set_trakt_unwatched_cache(
            $c->current_user_id,
            $cache_marker,
            \@items,
        );
        my $payload = _unwatched_payload(\@items, $c);
        $payload->{outdated} = 1 unless $stored;
        return $payload;
    });
    });
    })->catch(sub {
        my ($error) = @_;
        my $busy = $error =~ /Another Trakt operation/;
        $c->app->log->warn('Trakt unwatched refresh unavailable') unless $busy;
        my $current_raw = eval {
            $c->db->get_trakt_unwatched_cache($c->current_user_id, 1);
        };
        $stale = _unwatched_cache_stale_items($current_raw) unless defined $stale;
        if ($busy || (defined $cache_marker && !$@ && (!defined $current_raw || $current_raw ne $cache_marker))) {
            my $payload = _unwatched_payload($stale || [], $c);
            $payload->{outdated} = 1;
            $payload->{stale} = 1;
            $payload->{refreshing} = 1 if $busy;
            $payload->{pending} = 1 if $busy;
            $payload->{retry_after_ms} = 1000 if $busy;
            if ($busy && !defined $stale) {
                delete $payload->{unwatched};
                delete $payload->{unwatched_counts};
            }
            return $payload;
        }
        if ($stale) {
            my $payload = _unwatched_payload($stale, $c);
            $payload->{stale} = 1;
            return $payload;
        }
        die $error;
    })->then(sub { $c->render(json => shift) });
    });
}

# Initiates the Trakt OAuth flow, redirecting the user to Trakt for authorization.
# Route: GET /trakt/oauth/start
# Returns: Redirect to Trakt authorization page
sub oauth_start {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family;

    my $creds = $c->db->get_trakt_app_credentials();
    return $c->render(text => 'Trakt API credentials are not configured', status => 400)
        unless $creds->{client_id};

    my $redirect_uri = _redirect_uri($c);
    my $state = encode_base64url(random_bytes(32));
    my $pending = {
        state => $state, user_id => $c->current_user_id,
        client_id => $creds->{client_id}, redirect_uri => $redirect_uri,
        started_at => $c->now->epoch
    };
    $c->signed_cookie(trakt_oauth_pending => encode_base64url(encode_json($pending)), {
        path => '/trakt/oauth', httponly => 1, secure => 1,
        samesite => 'Lax', max_age => 600
    });
    my $challenge = encode_base64url(sha256(_pkce_verifier($c, $pending)));
    my $url = $TRAKT_AUTH
        . '?response_type=code'
        . '&client_id=' . url_escape($creds->{client_id})
        . '&redirect_uri=' . url_escape($redirect_uri)
        . '&state=' . url_escape($state)
        . '&code_challenge=' . url_escape($challenge)
        . '&code_challenge_method=S256';
    return $c->redirect_to($url);
}

# Handles the Trakt OAuth callback, exchanges code for tokens, and performs initial sync.
# Route: GET /trakt/oauth
# Parameters: code, state
# Returns: Redirect to /trakt
sub oauth_callback {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family;

    my $code = trim($c->param('code') // '');
    my $state = trim($c->param('state') // '');
    my $pending = eval { decode_json(decode_base64url($c->signed_cookie('trakt_oauth_pending') || '')) };
    return $c->render(text => 'Invalid OAuth state', status => 400)
        unless ref($pending) eq 'HASH' && $state
            && secure_compare($pending->{state} || '', $state)
            && ($pending->{user_id} || 0) == $c->current_user_id
            && ($pending->{started_at} || 0) <= $c->now->epoch
            && ($pending->{started_at} || 0) >= $c->now->epoch - 600;
    $c->signed_cookie(trakt_oauth_pending => '', {
        path => '/trakt/oauth', httponly => 1, secure => 1,
        samesite => 'Lax', max_age => 0, expires => 1
    });
    return $c->render(text => 'Trakt authorization was cancelled. Please connect again.', status => 400)
        if $c->param('error') || !$code;

    my $creds = $c->db->get_trakt_app_credentials();
    return $c->render(text => 'Trakt configuration changed. Please connect again.', status => 400)
        unless ($creds->{client_id} || '') eq ($pending->{client_id} || '');
    return _render_p($c, sub { _token_exchange_p($c, {
        code          => $code,
        client_id     => $creds->{client_id},
        code_verifier => _pkce_verifier($c, $pending),
        redirect_uri  => $pending->{redirect_uri}
    })->then(sub {
    my $token = shift;
    return $c->render(text => $token->{error}, status => 400) unless $token->{success};

    return _trakt_request_p($c, 'GET', '/users/settings', undef, $token->{access_token})->then(sub {
    my $settings = shift;
    my $user = $settings->{user} || {};
    $c->db->upsert_trakt_connection($c->current_user_id, {
        trakt_user_id  => $user->{ids}{uuid} || $user->{ids}{trakt} || $user->{ids}{slug},
        trakt_username => $user->{username} || '',
        access_token   => $token->{access_token},
        refresh_token  => $token->{refresh_token},
        token_type     => $token->{token_type},
        expires_at     => _mysql_time($c, $token->{expires_in} || 0),
        scope          => $token->{scope}
    });
    return _sync_user_p($c)->catch(sub {
        $c->app->log->warn('Initial Trakt sync failed');
    })->then(sub { $c->redirect_to('/trakt') });
    });
    })->catch(sub { $c->render(text => 'Unable to connect Trakt account', status => 400) });
    });
}

# Disconnects the current user's Trakt account and clears cached data.
# Route: POST /trakt/api/oauth/disconnect
# Returns: JSON { success, message }
sub api_disconnect {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);
    $c->db->disconnect_trakt_connection($c->current_user_id);
    $c->db->clear_trakt_user_cache($c->current_user_id);
    return $c->render(json => { success => 1, message => 'Trakt disconnected' });
}

# Triggers a full Trakt data sync for the current user.
# Route: POST /trakt/api/sync
# Returns: JSON { success, state }
sub api_sync {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);
    return _render_p($c, sub { _sync_user_p($c)->then(sub {
        $c->render(json => { success => 1, state => _dashboard_state($c) });
    }) });
}

# Refreshes only the cached watchlist calendar without rebuilding lists or watched state.
# Route: POST /trakt/api/upcoming/sync
# Returns: JSON { success, upcoming }
sub api_upcoming_sync {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);
    return _render_p($c, sub { _ensure_token_p($c)->then(sub {
    die 'Connect Trakt first' unless shift;
    my $revision = $c->db->get_trakt_cache_revision($c->current_user_id);
    my $lists = $c->db->get_trakt_lists($c->current_user_id);
    my ($watchlist) = grep { $_->{is_watchlist} } @$lists;
    my @show_ids = map { 0 + ($_->{trakt_id} || 0) }
        grep { ($_->{media_type} || '') eq 'show' && ($_->{trakt_id} || 0) }
        @{($watchlist || {})->{items} || []};

    return _watchlist_calendar_p($c, \@show_ids)->then(sub {
    my $upcoming = shift;
    eval { $c->db->replace_trakt_upcoming_cache($c->current_user_id, $upcoming, $revision) };
    if ($@) {
        $c->app->log->error("Trakt calendar cache refresh failed: $@");
        return _json_error($c, 'Unable to save Trakt calendar data');
    }

    my $state = _normalize_dashboard_state($c->db->get_trakt_dashboard_state($c->current_user_id));
    return $c->render(json => { success => 1, upcoming => $state->{upcoming},
        cache_revision => $state->{cache_revision} });
    });
    }) });
}

# Searches Trakt for movies and shows.
# Route: GET /trakt/api/search
# Parameters: q (query, min 2 chars), type (movie|show|movie,show)
# Returns: JSON { success, results }
sub api_search {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);

    my $q = trim($c->param('q') // '');
    my $type = trim($c->param('type') // 'movie,show');
    $type = 'movie,show' unless $type =~ /\A(?:movie|show|movie,show)\z/;
    return _json_error($c, 'Search query is required') unless length $q >= 2;

    return _render_p($c, sub { _read_many_p($c,
        '/search/' . $type . '?query=' . url_escape($q) . '&extended=full&limit=30&page=1',
        '/sync/watched/movies', '/sync/watched/shows?extended=full',
    )->then(sub {
        my $rows = shift;
        my $watched = _watched_lookup($rows->[1], $rows->[2]);
        $c->render(json => { success => 1, results => _normalize_search($rows->[0], $watched) });
    }) });
}

# Returns detailed show info including seasons, episodes, and watched progress.
# Route: GET /trakt/api/shows/:id
# Parameters: id (Trakt show id)
# Returns: JSON { success, show }
sub api_show_details {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);

    my $show_id = $c->param('id');
    return _json_error($c, 'Invalid show') unless defined $show_id && $show_id =~ /\A\d+\z/;

    return _render_p($c, sub { _read_many_p($c,
        '/shows/' . $show_id . '?extended=full',
        '/shows/' . $show_id . '/seasons?extended=full,episodes',
        '/shows/' . $show_id . '/progress/watched?hidden=false&specials=true&count_specials=true',
    )->then(sub {
        my $rows = shift;
        $c->render(json => { success => 1, show => _normalize_show_details(
            $rows->[0], $rows->[1], _show_progress_lookup($rows->[2])) });
    }) });
}

# Creates a new private Trakt list for the current user.
# Route: POST /trakt/api/lists/create
# Parameters: name, description
# Returns: JSON { success, state }
sub api_list_create {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);

    my $name = trim($c->param('name') // '');
    return _json_error($c, 'List name is required') unless $name;
    return _json_error($c, 'Watchlist is reserved for the application Watchlist')
        if lc($name) eq lc($WATCHLIST_NAME);
    my $metadata = {
        name => $name,
        description => trim($c->param('description') // ''),
        privacy => 'private'
    };
    return _render_p($c, sub { _mutation_p($c, sub {
        my $revision = shift;
        return _trakt_request_p($c, 'POST', '/users/me/lists', $metadata)->then(sub {
            my $remote = shift;
            my $id = $c->db->upsert_trakt_cached_list($c->current_user_id, { %$metadata, %$remote }, $revision);
            $c->render(json => { success => 1, list_id => $id, state => _dashboard_state($c) });
        });
    }) });
}

# Updates a custom Trakt list name and description.
# Route: POST /trakt/api/lists/:id/update
# Parameters: id (list DB id), name, description
# Returns: JSON { success, state }
sub api_list_update {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);

    my $list = $c->db->get_trakt_list_for_owner($c->current_user_id, $c->param('id'));
    return _json_error($c, 'List not found') unless $list;
    return _json_error($c, 'Watchlist name cannot be changed') if $list->{is_watchlist};

    my $name = trim($c->param('name') // $list->{name});
    return _json_error($c, 'List name is required') unless $name;
    return _json_error($c, 'Watchlist is reserved for the application Watchlist')
        if lc($name) eq lc($WATCHLIST_NAME);
    my $metadata = {
        name => $name,
        description => trim($c->param('description') // $list->{description} // ''),
        privacy => $list->{privacy} || 'private'
    };
    return _render_p($c, sub { _mutation_p($c, sub {
        my $revision = shift;
        return _trakt_request_p($c, 'PUT', '/users/me/lists/' . $list->{trakt_list_id}, $metadata)->then(sub {
            my $remote = shift;
            $c->db->upsert_trakt_cached_list($c->current_user_id,
                { %$metadata, ids => { trakt => $list->{trakt_list_id} }, %$remote }, $revision);
            $c->render(json => { success => 1, state => _dashboard_state($c) });
        });
    }) });
}

# Deletes a custom Trakt list (watchlist cannot be deleted).
# Route: POST /trakt/api/lists/:id/delete
# Parameters: id (list DB id)
# Returns: JSON { success, state }
sub api_list_delete {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);

    my $list = $c->db->get_trakt_list_for_owner($c->current_user_id, $c->param('id'));
    return _json_error($c, 'List not found') unless $list;
    return _json_error($c, 'Watchlist cannot be deleted') if $list->{is_watchlist};
    return _render_p($c, sub { _mutation_p($c, sub {
        my $revision = shift;
        return _trakt_request_p($c, 'DELETE', '/users/me/lists/' . $list->{trakt_list_id})->then(sub {
            $c->db->delete_trakt_cached_list($c->current_user_id, $list, $revision);
            $c->render(json => { success => 1, state => _dashboard_state($c) });
        });
    }) });
}

# Toggles the collapsed state of a list section for the current user.
# Route: POST /trakt/api/lists/:id/collapse
# Parameters: id (list DB id), collapsed (0 or 1)
# Returns: JSON { success }
sub api_list_collapse {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);

    my $list_id = $c->param('id');
    my $collapsed = ($c->param('collapsed') // 1) ? 1 : 0;
    my $ok = $c->db->set_trakt_list_collapsed($c->current_user_id, $list_id, $collapsed);
    return _json_error($c, 'List not found') unless $ok;

    return $c->render(json => { success => 1 });
}

# Adds items to a Trakt list from search results.
# Route: POST /trakt/api/lists/:id/items/add
# Parameters: id (list DB id), items (JSON array of {media_type, trakt_id})
# Returns: JSON { success, state }
sub api_list_items_add {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);

    my $list = $c->db->get_trakt_list_for_owner($c->current_user_id, $c->param('id'));
    return _json_error($c, 'List not found') unless $list;

    my $items = _items_from_param($c);
    my $payload = _sync_payload_from_items($items);
    return _json_error($c, 'Select at least one item') unless $payload;

    return _render_p($c, sub { _mutation_p($c, sub {
    my $revision = shift;
    return _trakt_request_p(
        $c,
        'POST',
        '/users/me/lists/' . $list->{trakt_list_id} . '/items',
        $payload,
    )->then(sub {
    my $res = shift;
    die 'Trakt did not accept all selected items' unless _list_response_accepted($res, $payload, 'add');
    $c->db->add_trakt_cached_list_items($c->current_user_id, $list, $items, $revision);
    _invalidate_unwatched_cache($c) if $list->{is_watchlist};
    my $mirror = $list->{is_watchlist}
        ? _trakt_request_p($c, 'POST', '/sync/watchlist', $payload)
        : Mojo::Promise->resolve;
    return $mirror->catch(sub { $c->app->log->warn('Trakt Watchlist mirror add failed') })->then(sub {
        $c->render(json => { success => 1, state => _dashboard_state($c) });
    });
    });
    }) });
}

# Removes items from a Trakt list.
# Route: POST /trakt/api/lists/:id/items/remove
# Parameters: id (list DB id), items (JSON array of {media_type, trakt_id})
# Returns: JSON { success, state }
sub api_list_items_remove {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);

    my $list = $c->db->get_trakt_list_for_owner($c->current_user_id, $c->param('id'));
    return _json_error($c, 'List not found') unless $list;

    my $items = _items_from_param($c);
    my $payload = _sync_payload_from_items($items);
    return _json_error($c, 'Select at least one item') unless $payload;

    return _render_p($c, sub { _mutation_p($c, sub {
    my $revision = shift;
    return _trakt_request_p(
        $c,
        'POST',
        '/users/me/lists/' . $list->{trakt_list_id} . '/items/remove',
        $payload,
    )->then(sub {
    my $res = shift;
    return _verify_list_removal_p($c, $list, $items, $payload, $res);
    })->then(sub {
    $c->db->remove_trakt_cached_list_items($c->current_user_id, $list, $items, $revision);
    _invalidate_unwatched_cache($c) if $list->{is_watchlist};
    my $mirror = $list->{is_watchlist}
        ? _trakt_request_p($c, 'POST', '/sync/watchlist/remove', $payload)
        : Mojo::Promise->resolve;
    return $mirror->catch(sub { $c->app->log->warn('Trakt Watchlist mirror remove failed') })->then(sub {
        $c->render(json => { success => 1, state => _dashboard_state($c) });
    });
    });
    }) });
}

# Marks items as watched in Trakt history.
# Route: POST /trakt/api/history/add
# Parameters: items (JSON array of {media_type, trakt_id})
# Returns: JSON { success, message, state }
sub api_history_add {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);

    my $items = _items_from_param($c);
    my $payload = _history_payload_from_items($items);
    return _json_error($c, 'Select valid items; seasons require their parent show and season number') unless $payload;

    return _render_p($c, sub { _mutation_p($c, sub {
    my $revision = shift;
    return _trakt_request_p($c, 'POST', '/sync/history', $payload)->then(sub {
    my ($accepted) = _history_response_accepted(shift, $payload, 'add');
    die 'Trakt did not accept all selected items' unless $accepted;
    $c->db->set_trakt_cached_items_watched($c->current_user_id, $items, 1, $revision);
    _invalidate_unwatched_cache($c);
    return _mirror_cached_watchlist_p($c)->catch(sub {
        $c->app->log->warn('Trakt Watchlist mirror after history add failed');
    })->then(sub {
        $c->render(json => { success => 1, message => 'Marked watched', state => _dashboard_state($c) });
    });
    });
    }) });
}

# Marks items as unwatched in Trakt history.
# Route: POST /trakt/api/history/remove
# Parameters: items (JSON array of {media_type, trakt_id})
# Returns: JSON { success, message, state }
sub api_history_remove {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);

    my $items = _items_from_param($c);
    my $payload = _history_payload_from_items($items);
    return _json_error($c, 'Select valid items; seasons require their parent show and season number') unless $payload;

    return _render_p($c, sub { _mutation_p($c, sub {
    my $revision = shift;
    return _trakt_request_p($c, 'POST', '/sync/history/remove', $payload)->then(sub {
    my ($accepted) = _history_response_accepted(shift, $payload, 'remove');
    die 'Trakt did not accept all selected items' unless $accepted;
    $c->db->set_trakt_cached_items_watched($c->current_user_id, $items, 0, $revision);
    _invalidate_unwatched_cache($c);
    return _mirror_cached_watchlist_p($c)->catch(sub {
        $c->app->log->warn('Trakt Watchlist mirror after history remove failed');
    })->then(sub {
        $c->render(json => { success => 1, message => 'Marked unwatched', state => _dashboard_state($c) });
    });
    });
    }) });
}

# Advances the local mutation revision before a remote list operation and full sync.
# Parameters:
#   $c : Mojolicious controller
# Returns:
#   True when the revision was advanced
sub _begin_cache_mutation {
    my ($c) = @_;
    my $ok = eval {
        $c->db->bump_trakt_cache_revision($c->current_user_id);
        1;
    };
    $c->app->log->error("Unable to advance Trakt cache revision: $@") if !$ok && $@;
    return $ok ? 1 : 0;
}

# Re-registers the authoritative cached Watchlist with Trakt's calendar source.
# Parameters:
#   $c : Mojolicious controller
# Returns:
#   Trakt request result hashref
sub _mirror_cached_watchlist_p {
    my ($c) = @_;

    my $lists = eval { $c->db->get_trakt_lists($c->current_user_id) };
    return Mojo::Promise->reject('Unable to read the application Watchlist')
        if $@ || ref $lists ne 'ARRAY';

    my ($watchlist) = grep { $_->{is_watchlist} } @$lists;
    return Mojo::Promise->reject('The application Watchlist is unavailable')
        unless $watchlist;

    my @items = grep {
        ($_->{media_type} || '') eq 'show' || ($_->{media_type} || '') eq 'movie'
    } @{$watchlist->{items} || []};
    my $payload = _sync_payload_from_items(\@items);
    return Mojo::Promise->resolve unless $payload;
    return _trakt_request_p($c, 'POST', '/sync/watchlist', $payload);
}

# Resolves or provisions the authoritative custom Watchlist for a connected user.
# Parameters:
#   $c     : Mojolicious controller
#   $lists : Arrayref of Trakt personal-list rows
# Returns:
#   Promise resolving to [watchlist row, needs initial built-in import]
sub _resolve_watchlist_list_p {
    my ($c, $lists) = @_;
    $lists = [] unless ref $lists eq 'ARRAY';

    my $conn = $c->db->get_trakt_connection($c->current_user_id) || {};
    my $stored_id = 0 + ($conn->{watchlist_trakt_list_id} || 0);
    if ($stored_id) {
        my ($watchlist) = grep {
            ref $_ eq 'HASH' && 0 + ((($_->{ids} || {})->{trakt}) || 0) == $stored_id
        } @$lists;
        return Mojo::Promise->resolve([$watchlist, 0]) if $watchlist;
        return Mojo::Promise->reject('The application Watchlist no longer exists on Trakt');
    }

    my @matches = grep {
        ref $_ eq 'HASH' && lc(trim($_->{name} // '')) eq lc($WATCHLIST_NAME)
    } @$lists;
    return Mojo::Promise->reject('Multiple custom Watchlist lists exist on Trakt') if @matches > 1;

    my $watchlist = $matches[0];
    unless ($watchlist) {
        return _trakt_request_p($c, 'POST', '/users/me/lists', {
            name        => $WATCHLIST_NAME,
            description => 'Persistent watchlist for Rendler.',
            privacy     => 'private',
        })->then(sub {
        $watchlist = shift;
        die 'Trakt did not return the created Watchlist'
            unless ref $watchlist eq 'HASH' && (($watchlist->{ids} || {})->{trakt} || 0);
        push @$lists, $watchlist;
        return [$watchlist, 1];
        });
    }

    return Mojo::Promise->resolve([$watchlist, 1]);
}

# Adds custom Watchlist shows and movies missing from Trakt's calendar source.
# Parameters:
#   $c              : Mojolicious controller
#   $watchlist_rows : Authoritative custom Watchlist item rows
#   $built_shows    : Current built-in Watchlist show rows
#   $built_movies   : Current built-in Watchlist movie rows
# Returns:
#   Trakt request result hashref
sub _mirror_watchlist_items_p {
    my ($c, $watchlist_rows, $built_shows, $built_movies) = @_;
    my %present;

    for my $row (@{$built_shows || []}) {
        my $id = ((($row->{show} || {})->{ids} || {})->{trakt} || 0);
        $present{"show:$id"} = 1 if $id;
    }
    for my $row (@{$built_movies || []}) {
        my $id = ((($row->{movie} || {})->{ids} || {})->{trakt} || 0);
        $present{"movie:$id"} = 1 if $id;
    }

    my @missing;
    for my $row (@{$watchlist_rows || []}) {
        next unless ref $row eq 'HASH';
        my ($type, $media) = _media_from_cached_row($row);
        next unless $type && ($type eq 'show' || $type eq 'movie');
        my $id = (($media->{ids} || {})->{trakt} || 0);
        push @missing, $row if $id && !$present{"$type:$id"};
    }

    my $payload = _sync_payload_from_trakt_rows(\@missing);
    return Mojo::Promise->resolve unless $payload;
    return _trakt_request_p($c, 'POST', '/sync/watchlist', $payload)->then(sub {
        die 'Trakt did not accept all selected items' unless _list_response_accepted(shift, $payload, 'add');
        return 1;
    });
}

# Fetches the retained watchlist calendar window and filters it to specific shows.
# Parameters:
#   $c        : Mojolicious controller
#   $show_ids : Arrayref of Trakt show IDs
# Returns:
#   Promise resolving to filtered calendar rows
sub _watchlist_calendar_p {
    my ($c, $show_ids) = @_;
    my %show_ids = map { (0 + $_) => 1 } grep { defined $_ && /^\d+$/ && $_ > 0 } @{$show_ids || []};
    return Mojo::Promise->resolve([]) unless %show_ids;

    # Trakt interprets calendar dates in the account timezone; three dates safely cover 48 UTC hours.
    my $start = $c->now->clone->subtract(days => 3)->ymd;
    return _trakt_request_p($c, 'GET', "/calendars/my/shows/$start/133?extended=full")->then(sub {
    my $calendar = shift;
    my @upcoming = grep {
        ref $_ eq 'HASH'
            && $show_ids{0 + ((($_->{show} || {})->{ids} || {})->{trakt} || 0)}
    } @{$calendar || []};
    return \@upcoming;
    });
}

# Serializes a user's full refresh; rejects failed or stale snapshots without retrying writes.
sub _sync_user_p {
    my ($c) = @_;
    return _ensure_token_p($c)->then(sub {
        die 'Connect Trakt first' unless shift;
        return _with_lease_p($c, 'trakt_full_sync_' . $c->current_user_id, sub {
            return _sync_user_locked_p($c);
        });
    });
}

# Hydrates a complete paginated snapshot while the per-user full-sync lease is held.
sub _sync_user_locked_p {
    my ($c) = @_;
    my $sync_revision = $c->db->get_trakt_cache_revision($c->current_user_id);
    return Mojo::Promise->reject('Connect Trakt first') unless defined $sync_revision;
    my ($list_rows, $watchlist_trakt_id, $needs_import, $built_shows, $built_movies, $watched);
    my %items_by_list;
    return _read_many_p($c, '/users/me/lists', '/sync/watchlist/shows', '/sync/watchlist/movies',
        '/sync/watched/movies?extended=full', '/sync/watched/shows?extended=full')->then(sub {
        my $rows = shift;
        ($list_rows, $built_shows, $built_movies) = @$rows[0..2];
        $watched = _watched_lookup($rows->[3], $rows->[4]);
        return _resolve_watchlist_list_p($c, $list_rows);
    })->then(sub {
        my $resolved = shift;
        my $watchlist = $resolved->[0];
        $needs_import = $resolved->[1];
        $watchlist_trakt_id = 0 + (($watchlist->{ids} || {})->{trakt} || 0);
        my @ids = map { ($_->{ids} || {})->{trakt} || () } @$list_rows;
        return _read_many_p($c, map { '/users/me/lists/' . $_ . '/items?extended=full' } @ids)->then(sub {
            my $rows = shift;
            @items_by_list{@ids} = @$rows;
            my $payload = $needs_import ? _sync_payload_from_trakt_rows([@$built_shows, @$built_movies]) : undef;
            return Mojo::Promise->resolve unless $payload;
            return _trakt_request_p($c, 'POST', '/users/me/lists/' . $watchlist_trakt_id . '/items', $payload)->then(sub {
                die 'Trakt did not accept all selected items' unless _list_response_accepted(shift, $payload, 'add');
                return _trakt_request_p($c, 'GET', '/users/me/lists/' . $watchlist_trakt_id . '/items?extended=full');
            })->then(sub { $items_by_list{$watchlist_trakt_id} = shift; return 1 });
        });
    })->then(sub {
        my $watchlist_items = $items_by_list{$watchlist_trakt_id} || [];
        return _mirror_watchlist_items_p($c, $watchlist_items, $built_shows, $built_movies)->then(sub {
            my @ids = map { 0 + ((($_->{show} || {})->{ids} || {})->{trakt} || 0) }
                grep { ((_media_from_cached_row($_))[0] || '') eq 'show' } @$watchlist_items;
            return _watchlist_calendar_p($c, \@ids);
        });
    })->then(sub {
        my $upcoming = shift;
        $c->db->replace_trakt_cache(
            $c->current_user_id,
            $watchlist_trakt_id,
            $upcoming,
            $list_rows,
            \%items_by_list,
            $watched,
            1,
            $sync_revision,
        );
        _invalidate_unwatched_cache($c);
        return 1;
    });
}

# Builds the dashboard state hash from the local DB cache.
sub _dashboard_state {
    my ($c) = @_;
    my $state = $c->db->get_trakt_dashboard_state($c->current_user_id);

    my $cached_unwatched;
    my $cached_raw = $c->db->get_trakt_unwatched_cache($c->current_user_id);
    if ($cached_raw) {
        my $cached = eval { decode_json($cached_raw) };
        $cached_unwatched = $cached if ref $cached eq 'ARRAY';
    }

    unless (ref $cached_unwatched eq 'ARRAY') {
        my $stale_raw = $c->db->get_trakt_unwatched_cache($c->current_user_id, 1);
        my $stale = _unwatched_cache_stale_items($stale_raw);
        if (ref $stale eq 'ARRAY') {
            $cached_unwatched = $stale;
            $state->{unwatched_stale} = 1;
        }
    }

    ref $cached_unwatched eq 'ARRAY'
        ? $state->{unwatched} = $cached_unwatched
        : delete $state->{unwatched};

    if (ref $cached_unwatched eq 'ARRAY') {
        my %counts;
        for my $ep (@$cached_unwatched) {
            $counts{0 + ($ep->{show_trakt_id} || 0)}++;
        }
        $state->{unwatched_counts} = \%counts;
    }

    return _normalize_dashboard_state($state);
}

# Builds the lightweight response returned by the dedicated unwatched endpoint.
# Parameters:
#   $items : Arrayref of unwatched episode rows
# Returns:
#   Hashref containing unwatched rows and per-show counts
sub _unwatched_payload {
    my ($items, $c) = @_;
    $items = [] unless ref $items eq 'ARRAY';
    my %counts;
    for my $item (@$items) {
        next unless ref $item eq 'HASH';
        $counts{0 + ($item->{show_trakt_id} || 0)}++;
    }
    return {
        success          => 1,
        unwatched        => $items,
        unwatched_counts => \%counts,
        ($c ? (cache_revision => $c->db->get_trakt_cache_revision($c->current_user_id)) : ()),
    };
}

# Extracts usable stale episode rows from an unwatched cache value or marker.
# Parameters:
#   $raw : Raw JSON stored in trakt_unwatched_cache
# Returns:
#   Arrayref of episode rows, or undef when no usable rows exist
sub _unwatched_cache_stale_items {
    my ($raw) = @_;
    return undef unless defined $raw && length $raw;
    my $decoded = eval { decode_json($raw) };
    return $decoded if ref $decoded eq 'ARRAY';
    return $decoded->{stale}
        if ref $decoded eq 'HASH' && ref $decoded->{stale} eq 'ARRAY';
    return undef;
}

# Builds a unique cache generation marker while retaining last-known episode rows.
# Parameters:
#   $c     : Mojolicious controller
#   $stale : Optional stale episode rows
# Returns:
#   Raw JSON generation marker
sub _unwatched_cache_marker {
    my ($c, $stale) = @_;
    $UNWATCHED_CACHE_GENERATION++;
    return encode_json({
        generation => join(':', $c->now->epoch, $$, $UNWATCHED_CACHE_GENERATION, int(rand(1_000_000_000))),
        (ref $stale eq 'ARRAY' ? (stale => $stale) : ()),
    });
}

# Claims the current cache generation before rebuilding unwatched episode data.
# Parameters:
#   $c : Mojolicious controller
# Returns:
#   Hashref containing cached rows, or a marker and stale fallback rows
sub _prepare_unwatched_refresh {
    my ($c) = @_;
    my $user_id = $c->current_user_id;

    for (1 .. 3) {
        my $fresh_raw = $c->db->get_trakt_unwatched_cache($user_id);
        if (defined $fresh_raw) {
            my $fresh = eval { decode_json($fresh_raw) };
            return { cached => $fresh } if ref $fresh eq 'ARRAY';
        }

        my $current_raw = defined $fresh_raw
            ? $fresh_raw
            : $c->db->get_trakt_unwatched_cache($user_id, 1);
        my $current = defined $current_raw ? eval { decode_json($current_raw) } : undef;
        my $stale = _unwatched_cache_stale_items($current_raw);
        if (ref $current eq 'HASH' && $current->{generation}) {
            return { marker => $current_raw, stale => $stale };
        }

        my $marker = _unwatched_cache_marker($c, $stale);
        if ($c->db->compare_and_set_trakt_unwatched_cache(
            $user_id,
            $current_raw,
            $marker,
        )) {
            return { marker => $marker, stale => $stale };
        }
    }

    return { error => 'Unable to prepare unwatched episode refresh' };
}

# Invalidates current unwatched work without allowing older requests to write afterward.
# Parameters:
#   $c : Mojolicious controller
# Returns:
#   Raw JSON generation marker
sub _invalidate_unwatched_cache {
    my ($c) = @_;
    my $stale_raw = $c->db->get_trakt_unwatched_cache($c->current_user_id, 1);
    my $marker = _unwatched_cache_marker(
        $c,
        _unwatched_cache_stale_items($stale_raw),
    );
    $c->db->set_trakt_unwatched_cache($c->current_user_id, $marker);
    return $marker;
}

# Builds unwatched episode rows for one show from its catalogue and watched progress.
# Parameters:
#   $c        : Mojolicious controller
#   $show_id  : Trakt show ID
#   $show     : Cached show metadata
#   $seasons  : Trakt season catalogue rows
#   $progress : Trakt watched-progress response
# Returns:
#   Arrayref of normalized unwatched episode rows
sub _unwatched_items_for_show {
    my ($c, $show_id, $show, $seasons, $progress) = @_;
    $show ||= {};
    my $watched = _show_progress_lookup($progress || {});
    my @items;

    for my $season (@{$seasons || []}) {
        next unless ref $season eq 'HASH';
        next unless ($season->{number} || 0) > 0;

        for my $episode (@{$season->{episodes} || []}) {
            next unless ref $episode eq 'HASH';
            my $episode_id = (($episode->{ids} || {})->{trakt} || 0);
            my $season_num = $season->{number};
            my $episode_num = $episode->{number};
            next unless $episode_id && defined $season_num && defined $episode_num;
            next unless _episode_is_aired($c, $episode->{first_aired});

            my $key = join(':', $season_num, $episode_num);
            next if $watched->{$key};

            push @items, {
                media_type    => 'episode',
                trakt_id      => $episode_id,
                show_trakt_id => $show_id,
                show_title    => $show->{title} || '',
                show_images   => _normalize_images($show->{images}),
                title         => $episode->{title} || '',
                year          => $show->{year},
                season        => $season_num,
                episode       => $episode_num,
                first_aired   => $episode->{first_aired},
                list_name     => 'Watchlist'
            };
        }
    }

    return \@items;
}

# Builds a lookup hash of watched movies, shows, and episodes from Trakt API data.
sub _watched_lookup {
    my ($movies, $shows) = @_;
    my %watched = (
        movies   => {},
        shows    => {},
        episodes => {}
    );

    for my $row (@{$movies || []}) {
        my $id = (($row->{movie} || {})->{ids} || {})->{trakt};
        $watched{movies}{$id} = 1 if $id;
    }

    for my $show (@{$shows || []}) {
        my $show_id = (($show->{show} || {})->{ids} || {})->{trakt};
        my $aired = $show->{aired} || ($show->{show} || {})->{aired_episodes} || 0;
        my $completed = $show->{completed} || 0;
        my $watched_regular = 0;
        if ($show_id && $completed >= $aired && $aired > 0) {
            $watched{shows}{$show_id} = 1;
        }
        for my $season (@{$show->{seasons} || []}) {
            my $season_num = $season->{number};
            for my $episode (@{$season->{episodes} || []}) {
                my $episode_num = $episode->{number};
                next unless $show_id && defined $season_num && defined $episode_num;
                my $key = join(':', $show_id, $season_num, $episode_num);
                my $plays = $episode->{plays} || 0;
                my $completed = $episode->{completed} || 0;
                if ($plays || $completed) {
                    $watched{episodes}{$key} = 1;
                    $watched_regular++ if ($season_num || 0) > 0;
                }
            }
        }
        if ($show_id && !$watched{shows}{$show_id} && $aired > 0 && $watched_regular >= $aired) {
            $watched{shows}{$show_id} = 1;
        }
    }

    return \%watched;
}

# Builds a lookup hash of watched episodes from Trakt progress data.
sub _show_progress_lookup {
    my ($progress) = @_;
    my %watched;
    for my $season (@{$progress->{seasons} || []}) {
        my $season_num = $season->{number};
        next unless defined $season_num;
        for my $episode (@{$season->{episodes} || []}) {
            my $episode_num = $episode->{number};
            next unless defined $episode_num;
            my $key = join(':', $season_num, $episode_num);
            $watched{$key} = ($episode->{completed} || $episode->{plays} || 0) ? 1 : 0;
        }
    }
    return \%watched;
}

# Builds cached Watchlist metadata keyed by media type and Trakt ID.
# Parameters:
#   $watchlist : Cached custom Watchlist with item rows
# Returns:
#   Hashref keyed by media type and Trakt ID
sub _watchlist_media_lookup {
    my ($watchlist) = @_;
    my %lookup;

    for my $item (@{($watchlist || {})->{items} || []}) {
        next unless ref $item eq 'HASH';
        my $type = $item->{media_type} || '';
        my $trakt_id = 0 + ($item->{trakt_id} || 0);
        next unless $type =~ /\A(?:show|movie)\z/ && $trakt_id;

        my $raw = _decode_raw_json($item->{raw_json});
        my ($raw_type, $raw_media) = _media_from_cached_row($raw, $type);
        $raw_media = $raw unless $raw_type;
        $lookup{$type}{$trakt_id} = {
            title  => $item->{title} || $raw_media->{title} || '',
            year   => $item->{year} || $raw_media->{year},
            images => ref $raw_media->{images} eq 'HASH' ? $raw_media->{images} : {},
        };
    }

    return \%lookup;
}

# Checks if an episode has already aired by comparing its first_aired timestamp to now.
sub _episode_is_aired {
    my ($c, $first_aired) = @_;
    return 0 unless $first_aired;
    my $episode_time = substr($first_aired, 0, 19);
    my $now = $c->now->clone;
    $now->set_time_zone('UTC');
    my $now_utc = $now->strftime('%Y-%m-%dT%H:%M:%S');
    return $episode_time le $now_utc ? 1 : 0;
}

# Normalizes show details including seasons, episodes, and watched status.
sub _normalize_show_details {
    my ($show, $seasons, $watched) = @_;
    $show ||= {};
    my @season_rows;

    for my $season (@{$seasons || []}) {
        next unless ref $season eq 'HASH';
        my @episodes;
        for my $episode (@{$season->{episodes} || []}) {
            next unless ref $episode eq 'HASH';
            my $key = join(':', $season->{number}, $episode->{number});
            push @episodes, {
                trakt_id    => (($episode->{ids} || {})->{trakt} || 0),
                season      => $season->{number},
                episode     => $episode->{number},
                title       => $episode->{title} || '',
                overview    => $episode->{overview} || '',
                first_aired => $episode->{first_aired},
                runtime     => $episode->{runtime},
                watched     => $watched->{$key} ? 1 : 0
            };
        }

        push @season_rows, {
            number   => $season->{number},
            title    => $season->{title} || '',
            overview => $season->{overview} || '',
            episodes => \@episodes
        };
    }

    return {
        trakt_id   => (($show->{ids} || {})->{trakt} || 0),
        title      => $show->{title} || '',
        year       => $show->{year},
        overview   => $show->{overview} || '',
        status     => $show->{status} || '',
        network    => $show->{network} || '',
        aired_episodes => $show->{aired_episodes},
        genres     => $show->{genres} || [],
        runtime    => $show->{runtime},
        images     => _normalize_images($show->{images}),
        seasons    => \@season_rows
    };
}

# Returns a valid access token for the current user, refreshing via OAuth if expired.
sub _ensure_token_p {
    my ($c, $attempt) = @_;
    $attempt ||= 0;
    my $user_id = $c->current_user_id;
    my $conn = $c->db->get_trakt_connection($user_id);
    return Mojo::Promise->resolve(undef)
        unless $conn && ($conn->{status} || '') eq 'connected' && $conn->{access_token};
    return Mojo::Promise->resolve($conn->{access_token})
        if ($conn->{expires_at} || '') gt _mysql_time($c, 90);
    return _with_lease_p($c, 'trakt_token_refresh_' . $user_id, sub {
        $conn = $c->db->get_trakt_connection($user_id);
        if ($conn && ($conn->{status} || '') eq 'connected' && $conn->{access_token}) {
            if (($conn->{expires_at} || '') gt _mysql_time($c, 90)) {
                return Mojo::Promise->resolve($conn->{access_token});
            } else {
                my $creds = $c->db->get_trakt_app_credentials();
                return _token_refresh_p($c, $conn, $creds)->then(sub {
                my $res = shift;
                if ($res->{success}) {
                    my $updated = $c->db->update_trakt_refreshed_connection(
                        $user_id,
                        $conn->{refresh_token},
                        {
                            access_token  => $res->{access_token},
                            refresh_token => $res->{refresh_token} || $conn->{refresh_token},
                            token_type    => $res->{token_type} || $conn->{token_type},
                            expires_at    => _mysql_time($c, $res->{expires_in} || 0),
                            scope         => defined $res->{scope} ? $res->{scope} : $conn->{scope}
                        },
                    );
                    if ($updated) {
                        return $res->{access_token};
                    } else {
                        $c->app->log->info("Discarded refreshed Trakt token for changed connection user $user_id");
                    }
                } else {
                    my $reason = lc($res->{reason} || 'temporary_failure');
                    if ($reason eq 'invalid_grant' || $reason eq 'revoked_token') {
                        my $disconnected = $c->db->disconnect_trakt_connection_for_refresh_token(
                            $user_id,
                            $conn->{refresh_token},
                        );
                        if ($disconnected) {
                            $c->app->log->warn("Trakt token was rejected for user $user_id; disconnected");
                        } else {
                            $c->app->log->info("Ignored rejected Trakt token for changed connection user $user_id");
                        }
                    } else {
                        $c->app->log->warn("Trakt token refresh temporarily failed for user $user_id: $reason");
                    }
                }
                return undef;
                });
            }
        }
        return Mojo::Promise->resolve(undef);
    })->catch(sub {
        my $error = shift;
        die $error unless $error =~ /Another Trakt operation/ && $attempt < 100;
        my $delay = Mojo::Promise->new;
        Mojo::IOLoop->timer(0.25 => sub { $delay->resolve });
        return $delay->then(sub { _ensure_token_p($c, $attempt + 1) });
    });
}

# Performs a nonblocking authenticated Trakt GET and resolves with decoded data.
# Parameters:
#   $c       : Mojolicious controller
#   $path    : Trakt API path
#   $headers : Authenticated Trakt request headers
# Returns:
#   Mojo::Promise resolving to decoded response data
sub _trakt_get_p {
    my ($c, $path, $headers) = @_;
    return _request_pages_p($c, 'GET', $path, undef, $headers || {});
}

# Makes an authenticated nonblocking request, including every dataset page.
sub _trakt_request_p {
    my ($c, $method, $path, $payload, $override_token) = @_;
    my $creds = $c->db->get_trakt_app_credentials();
    my $token_p = defined $override_token
        ? Mojo::Promise->resolve($override_token) : _ensure_token_p($c);
    return $token_p->then(sub {
        my $token = shift;
        die 'Unable to refresh the Trakt session; reconnect or try again' unless $token;
        return _request_pages_p($c, $method, $path, $payload, {
        'Content-Type'      => 'application/json',
        'trakt-api-version' => '2',
        'trakt-api-key'     => $creds->{client_id} || '',
        Authorization       => "Bearer $token",
        });
    });
}

# Bounds each transaction without changing the shared UA used by other integrations.
sub _http_p {
    my ($c, $method, $url, $headers, $payload) = @_;
    my %headers = (%{$headers || {}}, 'User-Agent' => 'Rendler-Industries/Trakt (https://rendler.org)');
    my @body = defined $payload ? (json => $payload) : ();
    my $tx = $c->ua->build_tx($method => $url => \%headers => @body);
    my $deadline = Mojo::Promise->new;
    my $timer = Mojo::IOLoop->timer($REQUEST_TIMEOUT => sub {
        $tx->req->error({message => 'Trakt request timed out'});
        Mojo::IOLoop->remove($tx->connection) if $tx->connection;
        $deadline->reject('Trakt request timed out');
    });
    return Mojo::Promise->race($c->ua->start_p($tx), $deadline)->finally(sub {
        Mojo::IOLoop->remove($timer);
    });
}

# Follows the actual pagination page/count/limit headers, rejecting incomplete datasets.
sub _request_pages_p {
    my ($c, $method, $path, $payload, $headers) = @_;
    my $url = Mojo::URL->new($path =~ /^https?:/ ? $path : $TRAKT_API . $path);
    my (@rows, %seen);
    my $fetch;
    $fetch = sub {
        return _http_p($c, $method, $url->clone, $headers, $payload)->then(sub {
            my $tx = shift;
            my $res = $tx->result;
            unless ($res->is_success) {
                my $retry = $res->headers->header('Retry-After');
                die 'Trakt API HTTP ' . ($res->code || 500)
                    . (defined $retry ? "; Retry-After: $retry" : '');
            }
            return {} if ($res->code || 0) == 204;
            my $data = $res->json;
            die 'Trakt returned invalid JSON' unless defined $data && ref $data;
            return $data unless $method eq 'GET' && ref $data eq 'ARRAY';
            return $data if $url->path->to_string =~ m{\A/search/};
            push @rows, @$data;
            my $page = $res->headers->header('X-Pagination-Page');
            my $pages = $res->headers->header('X-Pagination-Page-Count');
            return \@rows unless defined $page || defined $pages;
            die 'Invalid Trakt pagination headers'
                unless defined $page && defined $pages && $page =~ /\A[1-9]\d*\z/
                    && $pages =~ /\A\d+\z/ && (!$pages || $page <= $pages) && !$seen{$page}++;
            my $requested = $url->query->param('page') || 1;
            die 'Trakt returned an unexpected page' unless $page == $requested;
            return \@rows if $page >= $pages;
            die 'Trakt pagination exceeded its safety bound' if $page >= 10000;
            my $limit = $res->headers->header('X-Pagination-Limit');
            die 'Invalid Trakt pagination limit' unless defined $limit && $limit =~ /\A[1-9]\d*\z/;
            $url->query->merge(page => $page + 1, limit => $limit);
            return $fetch->();
        });
    };
    return $fetch->()->finally(sub { undef $fetch });
}

# Exchanges an OAuth authorization code for Trakt access and refresh tokens.
sub _token_exchange_p {
    my ($c, $args) = @_;
    return _http_p($c, 'POST', $TRAKT_TOKEN, {}, {
            code          => $args->{code},
            client_id     => $args->{client_id},
            code_verifier => $args->{code_verifier},
            redirect_uri  => $args->{redirect_uri},
            grant_type    => 'authorization_code'
        })->then(sub {
    my $tx = shift;
    my $res = $tx->result;
    my $json = $res->json;
    $json = {} unless ref $json eq 'HASH';
    return { success => 1, %$json } if $res->is_success && $json->{access_token};
    return { success => 0, error => 'Unable to connect Trakt account' };
    });
}

# Refreshes an expired Trakt OAuth token using the stored refresh token.
sub _token_refresh_p {
    my ($c, $conn, $creds) = @_;
    return _http_p($c, 'POST', $TRAKT_TOKEN, {}, {
            refresh_token => $conn->{refresh_token},
            client_id     => $creds->{client_id},
            grant_type    => 'refresh_token'
        })->then(sub {
    my $tx = shift;
    my $res = $tx->result;
    my $json = $res->json;
    $json = {} unless ref $json eq 'HASH';
    return { success => 1, %$json } if $res->is_success && $json->{access_token};

    my $reason = ($json->{error} || '') =~ /\A(?:invalid_grant|revoked_token)\z/
        ? $json->{error} : 'temporary_failure';
    $c->app->log->warn("Trakt token refresh rejected: $reason");
    return { success => 0, error => 'Unable to refresh Trakt token', reason => $reason };
    });
}

# Parses and returns the items JSON array from the request params.
sub _items_from_param {
    my ($c) = @_;
    my $items = eval { from_json($c->param('items') || '[]') };
    return [] if $@ || ref $items ne 'ARRAY';
    my (%seen, @valid);
    for my $item (@$items) {
        return [] unless ref $item eq 'HASH';
        my $type = $item->{media_type} || $item->{type} || '';
        my $id = $item->{trakt_id} || '';
        return [] unless $type =~ /\A(?:movie|show|season|episode)\z/ && $id =~ /\A[1-9]\d*\z/;
        next if $seen{"$type:$id"}++;
        push @valid, { %$item, media_type => $type, trakt_id => 0 + $id };
    }
    return \@valid;
}

# Builds a Trakt sync payload hash from a list of items with media type and trakt_id.
sub _sync_payload_from_items {
    my ($items) = @_;
    return undef unless ref $items eq 'ARRAY' && @$items;

    my %payload = ( movies => [], shows => [], seasons => [], episodes => [] );
    for my $item (@$items) {
        next unless ref $item eq 'HASH';
        my $type = $item->{media_type} || $item->{type} || '';
        my $id = $item->{trakt_id} || '';
        next unless $id && $id =~ /\A\d+\z/;
        if ($type eq 'movie') {
            push @{$payload{movies}}, { ids => { trakt => 0 + $id } };
        } elsif ($type eq 'show') {
            push @{$payload{shows}}, { ids => { trakt => 0 + $id } };
        } elsif ($type eq 'season') {
            push @{$payload{seasons}}, { ids => { trakt => 0 + $id } };
        } elsif ($type eq 'episode') {
            push @{$payload{episodes}}, { ids => { trakt => 0 + $id } };
        }
    }

    delete $payload{$_} for grep { !@{$payload{$_}} } keys %payload;
    return keys %payload ? \%payload : undef;
}

# Builds a Trakt sync payload from personal-list API rows.
# Parameters:
#   $rows : Arrayref of rows containing movie, show, or episode objects
# Returns:
#   Trakt sync payload hashref, or undef when no supported media exists
sub _sync_payload_from_trakt_rows {
    my ($rows) = @_;
    my @items;

    for my $row (@{$rows || []}) {
        next unless ref $row eq 'HASH';
        my ($type, $media) = _media_from_cached_row($row);
        for ($type || ()) {
            my $id = (($media->{ids} || {})->{trakt} || 0);
            next unless $id;
            push @items, { media_type => $type, trakt_id => 0 + $id };
            last;
        }
    }

    return _sync_payload_from_items(\@items);
}

# Validates per-media list counts before applying any selected items locally.
sub _list_response_accepted {
    my ($data, $payload, $action) = @_;
    return 0 unless ref $data eq 'HASH' && ref $payload eq 'HASH';
    return 0 if _history_response_count($data->{not_found});
    for my $type (keys %$payload) {
        my $expected = scalar @{$payload->{$type}};
        my $accepted = ($action eq 'remove')
            ? _history_response_count(($data->{deleted} || {})->{$type})
            : _history_response_count(($data->{added} || {})->{$type})
                + _history_response_count(($data->{existing} || {})->{$type});
        return 0 unless $accepted >= $expected;
    }
    return 1;
}

# Verifies idempotent or partial removals against the authoritative paginated list.
sub _verify_list_removal_p {
    my ($c, $list, $items, $payload, $data) = @_;
    return Mojo::Promise->resolve(1) if _list_response_accepted($data, $payload, 'remove');
    return Mojo::Promise->reject('Trakt did not accept all selected items')
        unless ref $data eq 'HASH' && ref $data->{deleted} eq 'HASH';
    return _trakt_request_p($c, 'GET', '/users/me/lists/' . $list->{trakt_list_id} . '/items?extended=full')->then(sub {
        my $rows = shift;
        die 'Trakt did not return list items' unless ref $rows eq 'ARRAY';
        my %present;
        for my $row (@$rows) {
            my ($type, $media) = _media_from_cached_row($row);
            my $id = ($media->{ids} || {})->{trakt} || 0;
            $present{"$type:$id"} = 1 if $type && $id;
        }
        for my $item (@$items) {
            die 'Trakt did not accept all selected items' if $present{"$item->{media_type}:$item->{trakt_id}"};
        }
        return 1;
    });
}

# Uses parent show identity plus season number for history, never the parent alone.
sub _history_payload_from_items {
    my ($items) = @_;
    my $payload = _sync_payload_from_items($items) || return undef;
    delete $payload->{seasons};
    for my $item (@$items) {
        next unless ($item->{media_type} || '') eq 'season';
        my ($show_id, $number) = @{$item}{qw(show_trakt_id season)};
        return undef unless defined $show_id && $show_id =~ /\A[1-9]\d*\z/
            && defined $number && $number =~ /\A\d+\z/;
        push @{$payload->{shows}}, { ids => { trakt => 0 + $show_id }, seasons => [{ number => 0 + $number }] };
    }
    return $payload;
}

# Validates that a Trakt sync history response accepted the expected items.
sub _history_response_accepted {
    my ($data, $payload, $action) = @_;
    $data ||= {};
    return (0, 'Trakt did not return a sync result') unless ref $data eq 'HASH';

    my $not_found = _history_response_count($data->{not_found});
    return (0, 'Trakt could not find one or more selected items') if $not_found;
    if (($action || '') eq 'remove') {
        return (ref $data->{deleted} eq 'HASH' ? (1, undef) : (0, 'Trakt did not return a removal result'));
    }

    my $expected = _history_payload_count($payload);
    my $accepted = _history_response_count($data->{added}) + _history_response_count($data->{existing});
    return (1, undef) if $expected && $accepted >= $expected;
    return (0, 'Trakt did not mark the selected items as watched');
}

# Counts the total number of movies, episodes, and shows in a sync payload.
sub _history_payload_count {
    my ($payload) = @_;
    return 0 unless ref $payload eq 'HASH';

    my $count = scalar(@{$payload->{movies} || []}) + scalar(@{$payload->{episodes} || []})
        + scalar(@{$payload->{seasons} || []});
    for my $show (@{$payload->{shows} || []}) {
        if ($show->{seasons}) {
            for my $season (@{$show->{seasons} || []}) {
                $count += ref $season->{episodes} eq 'ARRAY' ? scalar(@{$season->{episodes}}) : 1;
            }
        } else {
            $count++;
        }
    }
    return $count;
}

# Recursively counts items from a Trakt response node (scalar, array, or hash).
sub _history_response_count {
    my ($node) = @_;
    return 0 unless defined $node;
    return $node if !ref $node && $node =~ /\A\d+\z/;
    return scalar(@$node) if ref $node eq 'ARRAY';
    if (ref $node eq 'HASH') {
        my $count = 0;
        $count += _history_response_count($_) for values %$node;
        return $count;
    }
    return 0;
}

# Normalizes Trakt search results into a consistent format with watched status.
sub _normalize_search {
    my ($rows, $watched) = @_;
    $watched ||= {};
    my @out;
    for my $row (@{$rows || []}) {
        my $type = $row->{type} || next;
        next unless $type eq 'movie' || $type eq 'show';
        my $media = $row->{$type} || next;
        my $trakt_id = $media->{ids}{trakt};
        push @out, {
            media_type => $type,
            trakt_id   => $trakt_id,
            title      => $media->{title} || '',
            year       => $media->{year},
            overview   => $media->{overview} || '',
            images     => _normalize_images($media->{images}),
            score      => $row->{score},
            watched    => $type eq 'movie'
                ? (($watched->{movies} || {})->{$trakt_id} ? 1 : 0)
                : (($watched->{shows} || {})->{$trakt_id} ? 1 : 0)
        };
    }
    return \@out;
}

# Normalizes the dashboard state by decoding cached JSON and enriching items.
sub _normalize_dashboard_state {
    my ($state) = @_;
    $state ||= {};

    for my $list (@{$state->{lists} || []}) {
        for my $item (@{$list->{items} || []}) {
            next unless ref $item eq 'HASH';
            my $raw = _decode_raw_json($item->{raw_json});
            my ($type, $media) = _media_from_cached_row($raw, $item->{media_type});
            $item->{media_type} ||= $type if $type;
            $item->{overview} ||= $media->{overview} || '';
            my $media_images = _normalize_images($media->{images});
            $item->{images} = keys(%$media_images) ? $media_images : _normalize_images($raw->{images});
            if (($item->{media_type} || '') eq 'show') {
                $item->{unwatched_count} = 0 + (($state->{unwatched_counts} || {})->{0 + ($item->{trakt_id} || 0)} || 0);
            }
            if (($item->{media_type} || '') eq 'episode' || ($item->{media_type} || '') eq 'season') {
                $item->{show_images} = _normalize_images((($raw || {})->{show} || {})->{images});
                $item->{show_title} ||= (($raw || {})->{show} || {})->{title} || '';
                $item->{show_trakt_id} ||= ((($raw->{show} || {})->{ids} || {})->{trakt} || 0);
                $item->{season} = $media->{number}
                    if ($item->{media_type} || '') eq 'season' && defined $media->{number};
            }
            delete $item->{raw_json};
        }
    }

    for my $row (@{$state->{upcoming} || []}) {
        next unless ref $row eq 'HASH';
        my $raw = _decode_raw_json($row->{raw_json});
        $row->{show_images} = _normalize_images(((($raw || {})->{show}) || {})->{images});
        delete $row->{raw_json};
    }

    return $state;
}

# Safely decodes a raw JSON string into a hashref, returning an empty hash on failure.
sub _decode_raw_json {
    my ($raw) = @_;
    return {} unless defined $raw && length $raw;
    my $data = eval { decode_json($raw) };
    return ref $data eq 'HASH' ? $data : {};
}

# Extracts the media type and data hash from a cached row by checking known types.
sub _media_from_cached_row {
    my ($row, $explicit) = @_;
    $row ||= {};
    $explicit ||= $row->{media_type} || $row->{type};
    return ($explicit, ref $row->{$explicit} eq 'HASH' ? $row->{$explicit} : {})
        if $explicit && $explicit =~ /\A(?:movie|show|season|episode)\z/;
    for my $type (qw(episode season movie show)) {
        return ($type, $row->{$type}) if ref $row->{$type} eq 'HASH';
    }
    return (undef, {});
}

# Normalizes Trakt image data into a flat hash of known image keys with URLs.
sub _normalize_images {
    my ($images) = @_;
    $images ||= {};
    return {} unless ref $images eq 'HASH';

    my %out;
    for my $key (qw(poster thumb fanart banner logo clearart)) {
        my $value = _first_image_url($images->{$key});
        $out{$key} = $value if $value;
    }

    return \%out;
}

# Recursively extracts the first valid image URL from a Trakt image node.
sub _first_image_url {
    my ($node) = @_;
    return undef unless defined $node;

    if (!ref $node) {
        return $node =~ m{\Ahttps?://} ? $node : "https://$node";
    }

    if (ref $node eq 'ARRAY') {
        for my $item (@$node) {
            my $url = _first_image_url($item);
            return $url if $url;
        }
        return undef;
    }

    if (ref $node eq 'HASH') {
        for my $key (qw(full medium thumb original url)) {
            my $url = _first_image_url($node->{$key});
            return $url if $url;
        }
    }

    return undef;
}

# Checks whether the Trakt PKCE application client ID is configured.
sub _trakt_configured {
    my ($c) = @_;
    my $creds = $c->db->get_trakt_app_credentials();
    return $creds->{client_id} ? 1 : 0;
}

# Derives a per-login PKCE verifier without exposing it in signed session cookies.
# The random state is bound to the user, client, callback, and private app secret.
sub _pkce_verifier {
    my ($c, $pending) = @_;
    return encode_base64url(hmac_sha256(
        join("\0", 'trakt-pkce', map { $pending->{$_} } qw(state user_id client_id redirect_uri started_at)),
        $c->app->secrets->[0]
    ));
}

# Builds the absolute URL for the Trakt OAuth redirect endpoint.
sub _redirect_uri {
    my ($c) = @_;
    return $c->url_for('/trakt/oauth')->to_abs->to_string;
}

# Returns the current datetime in MySQL format with an optional offset in seconds.
sub _mysql_time {
    my ($c, $offset_seconds) = @_;
    my $dt = $c->now->clone;
    $dt->add(seconds => $offset_seconds || 0);
    return $dt->strftime('%Y-%m-%d %H:%M:%S');
}

# Renders a 403 Unauthorized JSON response.
sub _unauthorized {
    my ($c) = @_;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403);
}

# Checks that the current user is logged in and a family member.
sub _authorized {
    my ($c) = @_;
    return $c->is_logged_in && $c->is_family;
}

# Renders a JSON error response with the given error message.
sub _json_error {
    my ($c, $error) = @_;
    return $c->render(json => { success => 0, error => $error || 'Trakt request failed' });
}

sub register_routes {
    my ($class, $r) = @_;
    $r->{family}->get('/trakt')->to('trakt#index');
    $r->{family}->get('/trakt/api/state')->to('trakt#api_state');
    $r->{family}->get('/trakt/api/unwatched')->to('trakt#api_unwatched');
    $r->{family}->get('/trakt/oauth/start')->to('trakt#oauth_start');
    $r->{family}->get('/trakt/oauth')->to('trakt#oauth_callback');
    $r->{family}->post('/trakt/api/oauth/disconnect')->to('trakt#api_disconnect');
    $r->{family}->post('/trakt/api/sync')->to('trakt#api_sync');
    $r->{family}->post('/trakt/api/upcoming/sync')->to('trakt#api_upcoming_sync');
    $r->{family}->get('/trakt/api/search')->to('trakt#api_search');
    $r->{family}->get('/trakt/api/shows/:id')->to('trakt#api_show_details');
    $r->{family}->post('/trakt/api/lists/create')->to('trakt#api_list_create');
    $r->{family}->post('/trakt/api/lists/:id/update')->to('trakt#api_list_update');
    $r->{family}->post('/trakt/api/lists/:id/delete')->to('trakt#api_list_delete');
    $r->{family}->post('/trakt/api/lists/:id/collapse')->to('trakt#api_list_collapse');
    $r->{family}->post('/trakt/api/lists/:id/items/add')->to('trakt#api_list_items_add');
    $r->{family}->post('/trakt/api/lists/:id/items/remove')->to('trakt#api_list_items_remove');
    $r->{family}->post('/trakt/api/history/add')->to('trakt#api_history_add');
    $r->{family}->post('/trakt/api/history/remove')->to('trakt#api_history_remove');
}

1;
