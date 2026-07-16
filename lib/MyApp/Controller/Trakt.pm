# /lib/MyApp/Controller/Trakt.pm

package MyApp::Controller::Trakt;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::JSON qw(decode_json encode_json from_json);
use Mojo::Promise;
use Mojo::Util qw(trim url_escape);

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
my $TRAKT_AUTH = 'https://trakt.tv/oauth/authorize';
my $WATCHLIST_NAME = 'Watchlist';
my $UNWATCHED_CACHE_GENERATION = 0;

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

    my $refresh = _prepare_unwatched_refresh($c);
    return _json_error($c, $refresh->{error}) if $refresh->{error};
    return $c->render(json => _unwatched_payload($refresh->{cached}))
        if ref $refresh->{cached} eq 'ARRAY';
    my $cache_marker = $refresh->{marker};
    my $stale = $refresh->{stale};

    my $token = _ensure_token($c);
    unless ($token) {
        my $conn = $c->db->get_trakt_connection($c->current_user_id);
        my $error = $conn && ($conn->{status} || '') eq 'connected'
            ? 'Unable to refresh the Trakt session; try again'
            : 'Connect Trakt first';
        return _json_error($c, $error);
    }

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
        my $payload = _unwatched_payload([]);
        $payload->{outdated} = 1 unless $stored;
        return $c->render(json => $payload);
    }

    my $creds = $c->db->get_trakt_app_credentials();
    my $headers = {
        'Content-Type'      => 'application/json',
        'trakt-api-version' => '2',
        'trakt-api-key'     => $creds->{client_id} || '',
        Authorization       => "Bearer $token",
    };

    $c->render_later;
    Mojo::Promise->map({concurrency => 4}, sub {
        my ($show_id) = @_;
        my $seasons = _trakt_get_p($c, '/shows/' . $show_id . '/seasons?extended=full,episodes', $headers);
        my $progress = _trakt_get_p($c, '/shows/' . $show_id . '/progress/watched?hidden=false&specials=false&count_specials=false', $headers);
        return Mojo::Promise->all($seasons, $progress)->then(sub {
            my ($season_result, $progress_result) = @_;
            my $show = ($watchlist_media->{show} || {})->{$show_id} || {};
            return _unwatched_items_for_show(
                $c,
                $show_id,
                $show,
                $season_result->[0] || [],
                $progress_result->[0] || {},
            );
        });
    }, @show_ids)->then(sub {
        my @items;
        for my $result (@_) {
            push @items, @{$result->[0] || []};
        }
        @items = sort { ($b->{first_aired} || '') cmp ($a->{first_aired} || '') } @items;
        my $stored = $c->db->compare_and_set_trakt_unwatched_cache(
            $c->current_user_id,
            $cache_marker,
            \@items,
        );
        my $payload = _unwatched_payload(\@items);
        $payload->{outdated} = 1 unless $stored;
        $c->render(json => $payload);
    })->catch(sub {
        my ($error) = @_;
        $c->app->log->warn("Trakt concurrent unwatched refresh failed: $error");
        my $current_raw = eval {
            $c->db->get_trakt_unwatched_cache($c->current_user_id, 1);
        };
        if (!$@ && (!defined $current_raw || $current_raw ne $cache_marker)) {
            my $payload = _unwatched_payload($stale || []);
            $payload->{outdated} = 1;
            return $c->render(json => $payload);
        }
        if ($stale) {
            my $payload = _unwatched_payload($stale);
            $payload->{stale} = 1;
            return $c->render(json => $payload);
        }
        return _json_error($c, 'Unable to refresh unwatched episodes');
    });

    return undef;
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
        unless $creds->{client_id} && $creds->{client_secret};

    my $state = int(rand(1_000_000_000)) . $c->now->epoch . $c->current_user_id;
    $c->session(trakt_oauth_state => $state);

    my $redirect_uri = _redirect_uri($c);
    my $url = $TRAKT_AUTH
        . '?response_type=code'
        . '&client_id=' . url_escape($creds->{client_id})
        . '&redirect_uri=' . url_escape($redirect_uri)
        . '&state=' . url_escape($state);
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
    return $c->render(text => 'Invalid OAuth state', status => 400)
        unless $code && $state && (($c->session('trakt_oauth_state') || '') eq $state);

    my $creds = $c->db->get_trakt_app_credentials();
    my $token = _token_exchange($c, {
        code          => $code,
        client_id     => $creds->{client_id},
        client_secret => $creds->{client_secret},
        redirect_uri  => _redirect_uri($c)
    });
    return $c->render(text => $token->{error}, status => 400) unless $token->{success};

    my $settings = _trakt_request($c, 'GET', '/users/settings', undef, $token->{access_token});
    return $c->render(text => $settings->{error}, status => 400) unless $settings->{success};

    my $user = $settings->{data}{user} || {};
    $c->db->upsert_trakt_connection($c->current_user_id, {
        trakt_user_id  => $user->{ids}{slug} || $user->{ids}{trakt},
        trakt_username => $user->{username} || '',
        access_token   => $token->{access_token},
        refresh_token  => $token->{refresh_token},
        token_type     => $token->{token_type},
        expires_at     => _mysql_time($c, $token->{expires_in} || 0),
        scope          => $token->{scope}
    });
    $c->session(trakt_oauth_state => undef);
    my ($synced, $sync_error) = _sync_user($c);
    $c->app->log->warn("Initial Trakt sync failed: $sync_error") unless $synced;

    return $c->redirect_to('/trakt');
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
    my ($ok, $error) = _sync_user($c);
    return $c->render(json => { success => 0, error => $error }) unless $ok;
    return $c->render(json => { success => 1, state => _dashboard_state($c) });
}

# Refreshes only the cached watchlist calendar without rebuilding lists or watched state.
# Route: POST /trakt/api/upcoming/sync
# Returns: JSON { success, upcoming }
sub api_upcoming_sync {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);
    return _json_error($c, 'Connect Trakt first') unless _ensure_token($c);

    my $lists = $c->db->get_trakt_lists($c->current_user_id);
    my ($watchlist) = grep { $_->{is_watchlist} } @$lists;
    my @show_ids = map { 0 + ($_->{trakt_id} || 0) }
        grep { ($_->{media_type} || '') eq 'show' && ($_->{trakt_id} || 0) }
        @{($watchlist || {})->{items} || []};

    my ($ok, $upcoming, $error) = _watchlist_calendar($c, \@show_ids);
    return _json_error($c, $error) unless $ok;

    eval { $c->db->replace_trakt_upcoming_cache($c->current_user_id, $upcoming) };
    if ($@) {
        $c->app->log->error("Trakt calendar cache refresh failed: $@");
        return _json_error($c, 'Unable to save Trakt calendar data');
    }

    my $state = _normalize_dashboard_state({
        lists    => [],
        upcoming => $c->db->get_trakt_upcoming($c->current_user_id),
    });
    return $c->render(json => { success => 1, upcoming => $state->{upcoming} });
}

# Searches Trakt for movies and shows.
# Route: GET /trakt/api/search
# Parameters: q (query, min 2 chars), type (movie|show|movie,show)
# Returns: JSON { success, results }
sub api_search {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);
    return _json_error($c, 'Connect Trakt first') unless _ensure_token($c);

    my $q = trim($c->param('q') // '');
    my $type = trim($c->param('type') // 'movie,show');
    $type = 'movie,show' unless $type =~ /\A(?:movie|show|movie,show)\z/;
    return _json_error($c, 'Search query is required') unless length $q >= 2;

    my $res = _trakt_request($c, 'GET', '/search/' . $type . '?query=' . url_escape($q) . '&extended=full');
    return _json_error($c, $res->{error}) unless $res->{success};

    my $watched_movies = _trakt_request($c, 'GET', '/sync/watched/movies');
    return _json_error($c, $watched_movies->{error}) unless $watched_movies->{success};

    my $watched_shows = _trakt_request($c, 'GET', '/sync/watched/shows?extended=full');
    return _json_error($c, $watched_shows->{error}) unless $watched_shows->{success};

    my $watched = _watched_lookup(
        $watched_movies->{data} || [],
        $watched_shows->{data} || []
    );

    return $c->render(json => { success => 1, results => _normalize_search($res->{data}, $watched) });
}

# Returns detailed show info including seasons, episodes, and watched progress.
# Route: GET /trakt/api/shows/:id
# Parameters: id (Trakt show id)
# Returns: JSON { success, show }
sub api_show_details {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);
    return _json_error($c, 'Connect Trakt first') unless _ensure_token($c);

    my $show_id = $c->param('id');
    return _json_error($c, 'Invalid show') unless defined $show_id && $show_id =~ /\A\d+\z/;

    my $show = _trakt_request($c, 'GET', '/shows/' . $show_id . '?extended=full');
    return _json_error($c, $show->{error}) unless $show->{success};

    my $seasons = _trakt_request($c, 'GET', '/shows/' . $show_id . '/seasons?extended=full,episodes');
    return _json_error($c, $seasons->{error}) unless $seasons->{success};

    my $progress = _trakt_request($c, 'GET', '/shows/' . $show_id . '/progress/watched?hidden=false&specials=true&count_specials=true');
    return _json_error($c, $progress->{error}) unless $progress->{success};
    my $watched = _show_progress_lookup($progress->{data} || {});

    return $c->render(json => {
        success => 1,
        show    => _normalize_show_details($show->{data}, $seasons->{data}, $watched)
    });
}

# Creates a new private Trakt list for the current user.
# Route: POST /trakt/api/lists/create
# Parameters: name, description
# Returns: JSON { success, state }
sub api_list_create {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);
    return _json_error($c, 'Connect Trakt first') unless _ensure_token($c);

    my $name = trim($c->param('name') // '');
    return _json_error($c, 'List name is required') unless $name;
    return _json_error($c, 'Watchlist is reserved for the application Watchlist')
        if lc($name) eq lc($WATCHLIST_NAME);
    return _json_error($c, 'Unable to prepare the Trakt list update')
        unless _begin_cache_mutation($c);

    my $res = _trakt_request($c, 'POST', '/users/me/lists', {
        name => $name,
        description => trim($c->param('description') // ''),
        privacy => 'private'
    });
    return _json_error($c, $res->{error}) unless $res->{success};

    my ($synced, $sync_error) = _sync_user($c, { calendar_optional => 1 });
    return _json_error($c, $sync_error || 'Unable to sync Trakt') unless $synced;
    return $c->render(json => { success => 1, state => _dashboard_state($c) });
}

# Updates a custom Trakt list name and description.
# Route: POST /trakt/api/lists/:id/update
# Parameters: id (list DB id), name, description
# Returns: JSON { success, state }
sub api_list_update {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);
    return _json_error($c, 'Connect Trakt first') unless _ensure_token($c);

    my $list = $c->db->get_trakt_list_for_owner($c->current_user_id, $c->param('id'));
    return _json_error($c, 'List not found') unless $list;
    return _json_error($c, 'Watchlist name cannot be changed') if $list->{is_watchlist};

    my $name = trim($c->param('name') // $list->{name});
    return _json_error($c, 'List name is required') unless $name;
    return _json_error($c, 'Watchlist is reserved for the application Watchlist')
        if lc($name) eq lc($WATCHLIST_NAME);
    return _json_error($c, 'Unable to prepare the Trakt list update')
        unless _begin_cache_mutation($c);

    my $res = _trakt_request($c, 'PUT', '/users/me/lists/' . $list->{trakt_list_id}, {
        name => $name,
        description => trim($c->param('description') // $list->{description} // ''),
        privacy => $list->{privacy} || 'private'
    });
    return _json_error($c, $res->{error}) unless $res->{success};

    my ($synced, $sync_error) = _sync_user($c, { calendar_optional => 1 });
    return _json_error($c, $sync_error || 'Unable to sync Trakt') unless $synced;
    return $c->render(json => { success => 1, state => _dashboard_state($c) });
}

# Deletes a custom Trakt list (watchlist cannot be deleted).
# Route: POST /trakt/api/lists/:id/delete
# Parameters: id (list DB id)
# Returns: JSON { success, state }
sub api_list_delete {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);
    return _json_error($c, 'Connect Trakt first') unless _ensure_token($c);

    my $list = $c->db->get_trakt_list_for_owner($c->current_user_id, $c->param('id'));
    return _json_error($c, 'List not found') unless $list;
    return _json_error($c, 'Watchlist cannot be deleted') if $list->{is_watchlist};
    return _json_error($c, 'Unable to prepare the Trakt list update')
        unless _begin_cache_mutation($c);

    my $res = _trakt_request($c, 'DELETE', '/users/me/lists/' . $list->{trakt_list_id});
    return _json_error($c, $res->{error}) unless $res->{success};

    my ($synced, $sync_error) = _sync_user($c, { calendar_optional => 1 });
    return _json_error($c, $sync_error || 'Unable to sync Trakt') unless $synced;
    return $c->render(json => { success => 1, state => _dashboard_state($c) });
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
    return _json_error($c, 'Connect Trakt first') unless _ensure_token($c);

    my $list = $c->db->get_trakt_list_for_owner($c->current_user_id, $c->param('id'));
    return _json_error($c, 'List not found') unless $list;

    my $items = _items_from_param($c);
    my $payload = _sync_payload_from_items($items);
    return _json_error($c, 'Select at least one item') unless $payload;

    my $res = _trakt_request(
        $c,
        'POST',
        '/users/me/lists/' . $list->{trakt_list_id} . '/items',
        $payload,
    );
    return _json_error($c, $res->{error}) unless $res->{success};

    if ($list->{is_watchlist}) {
        my $mirror = _trakt_request($c, 'POST', '/sync/watchlist', $payload);
        $c->app->log->warn("Trakt Watchlist calendar mirror add failed: $mirror->{error}")
            unless $mirror->{success};
    }

    eval { $c->db->add_trakt_cached_list_items($c->current_user_id, $list, $items) };
    return _json_error($c, 'Unable to update Trakt cache') if $@;
    _invalidate_unwatched_cache($c) if $list->{is_watchlist};
    return $c->render(json => { success => 1, state => _dashboard_state($c) });
}

# Removes items from a Trakt list.
# Route: POST /trakt/api/lists/:id/items/remove
# Parameters: id (list DB id), items (JSON array of {media_type, trakt_id})
# Returns: JSON { success, state }
sub api_list_items_remove {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);
    return _json_error($c, 'Connect Trakt first') unless _ensure_token($c);

    my $list = $c->db->get_trakt_list_for_owner($c->current_user_id, $c->param('id'));
    return _json_error($c, 'List not found') unless $list;

    my $items = _items_from_param($c);
    my $payload = _sync_payload_from_items($items);
    return _json_error($c, 'Select at least one item') unless $payload;

    my $res = _trakt_request(
        $c,
        'POST',
        '/users/me/lists/' . $list->{trakt_list_id} . '/items/remove',
        $payload,
    );
    return _json_error($c, $res->{error}) unless $res->{success};

    if ($list->{is_watchlist}) {
        my $mirror = _trakt_request($c, 'POST', '/sync/watchlist/remove', $payload);
        $c->app->log->warn("Trakt Watchlist calendar mirror remove failed: $mirror->{error}")
            unless $mirror->{success};
    }

    eval { $c->db->remove_trakt_cached_list_items($c->current_user_id, $list, $items) };
    return _json_error($c, 'Unable to update Trakt cache') if $@;
    _invalidate_unwatched_cache($c) if $list->{is_watchlist};
    return $c->render(json => { success => 1, state => _dashboard_state($c) });
}

# Marks items as watched in Trakt history.
# Route: POST /trakt/api/history/add
# Parameters: items (JSON array of {media_type, trakt_id})
# Returns: JSON { success, message, state }
sub api_history_add {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);
    return _json_error($c, 'Connect Trakt first') unless _ensure_token($c);

    my $items = _items_from_param($c);
    my $payload = _sync_payload_from_items($items);
    return _json_error($c, 'Select at least one item') unless $payload;

    my $res = _trakt_request($c, 'POST', '/sync/history', $payload);
    return _json_error($c, $res->{error}) unless $res->{success};
    my ($accepted, $accept_error) = _history_response_accepted($res->{data}, $payload, 'add');
    return _json_error($c, $accept_error) unless $accepted;
    eval { $c->db->set_trakt_cached_items_watched($c->current_user_id, $items, 1) };
    return _json_error($c, 'Unable to update Trakt cache') if $@;
    _invalidate_unwatched_cache($c);
    my $mirror = _mirror_cached_watchlist($c);
    $c->app->log->warn("Trakt Watchlist calendar mirror after history add failed: $mirror->{error}")
        unless $mirror->{success};
    return $c->render(json => { success => 1, message => 'Marked watched', state => _dashboard_state($c) });
}

# Marks items as unwatched in Trakt history.
# Route: POST /trakt/api/history/remove
# Parameters: items (JSON array of {media_type, trakt_id})
# Returns: JSON { success, message, state }
sub api_history_remove {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);
    return _json_error($c, 'Connect Trakt first') unless _ensure_token($c);

    my $items = _items_from_param($c);
    my $payload = _sync_payload_from_items($items);
    return _json_error($c, 'Select at least one item') unless $payload;

    my $res = _trakt_request($c, 'POST', '/sync/history/remove', $payload);
    return _json_error($c, $res->{error}) unless $res->{success};
    my ($accepted, $accept_error) = _history_response_accepted($res->{data}, $payload, 'remove');
    return _json_error($c, $accept_error) unless $accepted;
    eval { $c->db->set_trakt_cached_items_watched($c->current_user_id, $items, 0) };
    return _json_error($c, 'Unable to update Trakt cache') if $@;
    _invalidate_unwatched_cache($c);
    my $mirror = _mirror_cached_watchlist($c);
    $c->app->log->warn("Trakt Watchlist calendar mirror after history remove failed: $mirror->{error}")
        unless $mirror->{success};
    return $c->render(json => { success => 1, message => 'Marked unwatched', state => _dashboard_state($c) });
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
sub _mirror_cached_watchlist {
    my ($c) = @_;

    my $lists = eval { $c->db->get_trakt_lists($c->current_user_id) };
    return { success => 0, error => 'Unable to read the application Watchlist' }
        if $@ || ref $lists ne 'ARRAY';

    my ($watchlist) = grep { $_->{is_watchlist} } @$lists;
    return { success => 0, error => 'The application Watchlist is unavailable' }
        unless $watchlist;

    my @items = grep {
        ($_->{media_type} || '') eq 'show' || ($_->{media_type} || '') eq 'movie'
    } @{$watchlist->{items} || []};
    my $payload = _sync_payload_from_items(\@items);
    return { success => 1 } unless $payload;
    return _trakt_request($c, 'POST', '/sync/watchlist', $payload);
}

# Resolves or provisions the authoritative custom Watchlist for a connected user.
# Parameters:
#   $c     : Mojolicious controller
#   $lists : Arrayref of Trakt personal-list rows
# Returns:
#   (watchlist row, needs initial built-in import, error)
sub _resolve_watchlist_list {
    my ($c, $lists) = @_;
    $lists = [] unless ref $lists eq 'ARRAY';

    my $conn = $c->db->get_trakt_connection($c->current_user_id) || {};
    my $stored_id = 0 + ($conn->{watchlist_trakt_list_id} || 0);
    if ($stored_id) {
        my ($watchlist) = grep {
            ref $_ eq 'HASH' && 0 + ((($_->{ids} || {})->{trakt}) || 0) == $stored_id
        } @$lists;
        return ($watchlist, 0, undef) if $watchlist;
        return (undef, 0, 'The application Watchlist no longer exists on Trakt');
    }

    my @matches = grep {
        ref $_ eq 'HASH' && lc(trim($_->{name} // '')) eq lc($WATCHLIST_NAME)
    } @$lists;
    return (undef, 0, 'Multiple custom Watchlist lists exist on Trakt') if @matches > 1;

    my $watchlist = $matches[0];
    unless ($watchlist) {
        my $created = _trakt_request($c, 'POST', '/users/me/lists', {
            name        => $WATCHLIST_NAME,
            description => 'Persistent watchlist for Rendler.',
            privacy     => 'private',
        });
        return (undef, 0, $created->{error}) unless $created->{success};
        $watchlist = $created->{data};
        return (undef, 0, 'Trakt did not return the created Watchlist')
            unless ref $watchlist eq 'HASH' && (($watchlist->{ids} || {})->{trakt} || 0);
        push @$lists, $watchlist;
    }

    return ($watchlist, 1, undef);
}

# Adds custom Watchlist shows and movies missing from Trakt's calendar source.
# Parameters:
#   $c              : Mojolicious controller
#   $watchlist_rows : Authoritative custom Watchlist item rows
#   $built_shows    : Current built-in Watchlist show rows
#   $built_movies   : Current built-in Watchlist movie rows
# Returns:
#   Trakt request result hashref
sub _mirror_watchlist_items {
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
        for my $type (qw(show movie)) {
            my $id = ((($row->{$type} || {})->{ids} || {})->{trakt} || 0);
            push @missing, $row if $id && !$present{"$type:$id"};
            last if $id;
        }
    }

    my $payload = _sync_payload_from_trakt_rows(\@missing);
    return { success => 1 } unless $payload;
    return _trakt_request($c, 'POST', '/sync/watchlist', $payload);
}

# Fetches the retained watchlist calendar window and filters it to specific shows.
# Parameters:
#   $c        : Mojolicious controller
#   $show_ids : Arrayref of Trakt show IDs
# Returns:
#   (success, calendar rows arrayref, error)
sub _watchlist_calendar {
    my ($c, $show_ids) = @_;
    my %show_ids = map { (0 + $_) => 1 } grep { defined $_ && /^\d+$/ && $_ > 0 } @{$show_ids || []};
    return (1, [], undef) unless %show_ids;

    # Trakt interprets calendar dates in the account timezone; three dates safely cover 48 UTC hours.
    my $start = $c->now->clone->subtract(days => 3)->ymd;
    my $calendar = _trakt_request($c, 'GET', "/calendars/my/shows/$start/133?extended=full");
    return (0, [], $calendar->{error}) unless $calendar->{success};

    my @upcoming = grep {
        ref $_ eq 'HASH'
            && $show_ids{0 + ((($_->{show} || {})->{ids} || {})->{trakt} || 0)}
    } @{$calendar->{data} || []};
    return (1, \@upcoming, undef);
}

# Serializes a user's full Trakt refresh before hydrating the local cache.
# Parameters:
#   $c    : Mojolicious controller
#   $opts : Optional hashref; calendar_optional preserves existing calendar rows on failure
# Returns:
#   (success, error)
sub _sync_user {
    my ($c, $opts) = @_;
    $opts ||= {};
    return (0, 'Connect Trakt first') unless _ensure_token($c);

    my $user_id = $c->current_user_id;
    my $lock_name = 'trakt_full_sync_' . $user_id;
    my $locked = eval {
        $c->db->{dbh}->selectrow_array("SELECT GET_LOCK(?, 15)", undef, $lock_name);
    };
    my $lock_error = $@;
    unless ($locked) {
        $c->app->log->warn("Unable to acquire Trakt full-sync lock for user $user_id: $lock_error");
        return (0, 'Another Trakt refresh is still in progress');
    }

    my (@result, $run_ok, $run_error);
    $run_ok = eval {
        @result = _sync_user_locked($c, $opts);
        1;
    };
    $run_error = $@;
    eval { $c->db->{dbh}->selectrow_array("SELECT RELEASE_LOCK(?)", undef, $lock_name) };

    unless ($run_ok) {
        $c->app->log->error("Trakt full sync failed for user $user_id: $run_error");
        return (0, 'Unable to refresh Trakt');
    }
    return @result;
}

# Fetches all remote Trakt data while the per-user full-sync lock is held.
# Parameters:
#   $c    : Mojolicious controller
#   $opts : Sync options and internal retry marker
# Returns:
#   (success, error)
sub _sync_user_locked {
    my ($c, $opts) = @_;
    $opts ||= {};
    my $sync_revision = $c->db->get_trakt_cache_revision($c->current_user_id);
    return (0, 'Connect Trakt first') unless defined $sync_revision;

    my $lists = _trakt_request($c, 'GET', '/users/me/lists');
    return (0, $lists->{error}) unless $lists->{success};
    my $list_rows = $lists->{data} || [];
    my ($watchlist, $needs_import, $watchlist_error) = _resolve_watchlist_list($c, $list_rows);
    return (0, $watchlist_error) unless $watchlist;
    my $watchlist_trakt_id = 0 + (($watchlist->{ids} || {})->{trakt} || 0);

    my %items_by_list;
    for my $list (@$list_rows) {
        my $trakt_id = $list->{ids}{trakt};
        next unless $trakt_id;
        my $items = _trakt_request($c, 'GET', '/users/me/lists/' . $trakt_id . '/items?extended=full');
        return (0, $items->{error}) unless $items->{success};
        $items_by_list{$trakt_id} = $items->{data} || [];
    }

    my $built_shows = _trakt_request($c, 'GET', '/sync/watchlist/shows');
    return (0, $built_shows->{error}) unless $built_shows->{success};
    my $built_movies = _trakt_request($c, 'GET', '/sync/watchlist/movies');
    return (0, $built_movies->{error}) unless $built_movies->{success};

    if ($needs_import) {
        my @built_rows = (@{$built_shows->{data} || []}, @{$built_movies->{data} || []});
        my $payload = _sync_payload_from_trakt_rows(\@built_rows);
        if ($payload) {
            my $import = _trakt_request(
                $c,
                'POST',
                '/users/me/lists/' . $watchlist_trakt_id . '/items',
                $payload,
            );
            return (0, $import->{error}) unless $import->{success};

            my $refreshed = _trakt_request(
                $c,
                'GET',
                '/users/me/lists/' . $watchlist_trakt_id . '/items?extended=full',
            );
            return (0, $refreshed->{error}) unless $refreshed->{success};
            $items_by_list{$watchlist_trakt_id} = $refreshed->{data} || [];
        }

        eval {
            $c->db->set_trakt_watchlist_list_id($c->current_user_id, $watchlist_trakt_id);
        };
        return (0, 'Unable to save the application Watchlist') if $@;
    }

    my $watchlist_items = $items_by_list{$watchlist_trakt_id} || [];
    my $mirror = _mirror_watchlist_items(
        $c,
        $watchlist_items,
        $built_shows->{data} || [],
        $built_movies->{data} || [],
    );
    return (0, $mirror->{error}) unless $mirror->{success};

    my $watched_movies = _trakt_request($c, 'GET', '/sync/watched/movies?extended=full');
    my $watched_shows = _trakt_request($c, 'GET', '/sync/watched/shows?extended=full');
    return (0, $watched_movies->{error}) unless $watched_movies->{success};
    return (0, $watched_shows->{error}) unless $watched_shows->{success};
    my $watched = _watched_lookup(
        $watched_movies->{data} || [],
        $watched_shows->{data} || []
    );

    my @watchlist_show_rows = grep { ref(($_ || {})->{show}) eq 'HASH' } @$watchlist_items;
    my @watch_show_ids = map { 0 + ((($_->{show} || {})->{ids} || {})->{trakt} || 0) } @watchlist_show_rows;
    my ($calendar_ok, $upcoming, $calendar_error) = _watchlist_calendar($c, \@watch_show_ids);
    unless ($calendar_ok) {
        return (0, $calendar_error) unless $opts->{calendar_optional};
        $c->app->log->warn("Trakt calendar refresh skipped during list sync: $calendar_error");
        $upcoming = undef;
    }

    eval {
        $c->db->replace_trakt_cache(
            $c->current_user_id,
            $watchlist_trakt_id,
            $upcoming,
            $list_rows,
            \%items_by_list,
            $watched,
            $calendar_ok,
            $sync_revision,
        );
        _invalidate_unwatched_cache($c);
    };
    if ($@) {
        my $sync_error = $@;
        if ($sync_error =~ /TRAKT_SYNC_STALE/) {
            return _sync_user_locked($c, { %$opts, cache_retry => 1 }) unless $opts->{cache_retry};
            return (0, 'Trakt changed while refreshing; please refresh again');
        }
        return (0, 'Connect Trakt first') if $sync_error =~ /TRAKT_SYNC_DISCONNECTED/;
        $c->app->log->error("Trakt cache sync failed: $sync_error");
        return (0, 'Unable to save Trakt sync data');
    }

    return (1, undef);
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
    my ($items) = @_;
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
        stale      => ref $stale eq 'ARRAY' ? $stale : [],
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
        my ($raw_type, $raw_media) = _media_from_cached_row($raw);
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
sub _ensure_token {
    my ($c) = @_;
    my $user_id = $c->current_user_id;
    my $conn = $c->db->get_trakt_connection($user_id);
    return undef unless $conn && ($conn->{status} || '') eq 'connected' && $conn->{access_token};
    return $conn->{access_token} if ($conn->{expires_at} || '') gt _mysql_time($c, 90);

    my $lock_name = 'trakt_token_refresh_' . $user_id;
    my $locked = eval {
        $c->db->{dbh}->selectrow_array("SELECT GET_LOCK(?, 15)", undef, $lock_name);
    };
    my $lock_error = $@;
    unless ($locked) {
        $c->app->log->warn("Unable to acquire Trakt token refresh lock for user $user_id: $lock_error");
        return undef;
    }

    my $token;
    my $refresh_ok = eval {
        $conn = $c->db->get_trakt_connection($user_id);
        if ($conn && ($conn->{status} || '') eq 'connected' && $conn->{access_token}) {
            if (($conn->{expires_at} || '') gt _mysql_time($c, 90)) {
                $token = $conn->{access_token};
            } else {
                my $creds = $c->db->get_trakt_app_credentials();
                my $res = _token_refresh($c, $conn, $creds);
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
                        $token = $res->{access_token};
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
            }
        }
        1;
    };
    my $refresh_error = $@;
    eval { $c->db->{dbh}->selectrow_array("SELECT RELEASE_LOCK(?)", undef, $lock_name) };
    $c->app->log->error("Trakt token refresh failed for user $user_id: $refresh_error")
        unless $refresh_ok;
    return $token;
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
    my $url = $path =~ /^https?:/ ? $path : $TRAKT_API . $path;
    return $c->ua->get_p($url => ($headers || {}))->then(sub {
        my ($tx) = @_;
        my $res = $tx->result;
        die 'Trakt API returned HTTP ' . ($res->code || 500) unless $res->is_success;
        return $res->json // {};
    });
}

# Makes an authenticated HTTP request to the Trakt API and returns { success, data/error }.
sub _trakt_request {
    my ($c, $method, $path, $payload, $override_token) = @_;
    my $creds = $c->db->get_trakt_app_credentials();
    my $token = $override_token || _ensure_token($c);

    unless ($token) {
        my $conn = $c->db->get_trakt_connection($c->current_user_id);
        if ($conn && ($conn->{status} || '') eq 'disconnected') {
            return { success => 0, error => 'Trakt session expired — reconnect your account' };
        }
        return { success => 0, error => 'Unable to refresh the Trakt session; try again' };
    }

    my %headers = (
        'Content-Type'      => 'application/json',
        'trakt-api-version' => '2',
        'trakt-api-key'     => $creds->{client_id} || ''
    );
    $headers{Authorization} = "Bearer $token" if $token;

    my $url = $path =~ /^https?:/ ? $path : $TRAKT_API . $path;
    my $tx = eval {
        my $request;
        if ($method eq 'POST') {
            $request = $c->ua->post($url => \%headers => json => ($payload || {}));
        } elsif ($method eq 'PUT') {
            $request = $c->ua->put($url => \%headers => json => ($payload || {}));
        } elsif ($method eq 'DELETE') {
            $request = $c->ua->delete($url => \%headers);
        } else {
            $request = $c->ua->get($url => \%headers);
        }
        $request;
    };
    if ($@ || !$tx) {
        $c->app->log->warn("Trakt request failed before response: $@") if $@;
        return { success => 0, error => 'Unable to reach Trakt' };
    }

    my $res = $tx->result;
    if (my $err = $tx->error) {
        my $message = $err->{message} || 'Trakt API request failed';
        return { success => 0, error => 'Trakt API error: ' . $message };
    }
    return { success => 1, data => ($res->json // {}) } if $res->is_success;

    my $json = $res->json || {};
    my $message = $json->{error_description} || $json->{error} || $res->message || $res->code || 'network';
    return { success => 0, error => 'Trakt API error: ' . $message };
}

# Exchanges an OAuth authorization code for Trakt access and refresh tokens.
sub _token_exchange {
    my ($c, $args) = @_;
    my $tx = eval {
        $c->ua->post($TRAKT_API . '/oauth/token' => json => {
            code          => $args->{code},
            client_id     => $args->{client_id},
            client_secret => $args->{client_secret},
            redirect_uri  => $args->{redirect_uri},
            grant_type    => 'authorization_code'
        });
    };
    return { success => 0, error => 'Unable to connect Trakt account' } if $@ || !$tx;
    my $res = $tx->result;
    my $json = $res->json || {};
    return { success => 1, %$json } if $res->is_success && $json->{access_token};
    return { success => 0, error => 'Unable to connect Trakt account' };
}

# Refreshes an expired Trakt OAuth token using the stored refresh token.
sub _token_refresh {
    my ($c, $conn, $creds) = @_;
    my $tx = eval {
        $c->ua->post($TRAKT_API . '/oauth/token' => json => {
            refresh_token => $conn->{refresh_token},
            client_id     => $creds->{client_id},
            client_secret => $creds->{client_secret},
            redirect_uri  => _redirect_uri($c),
            grant_type    => 'refresh_token'
        });
    };
    return { success => 0, error => 'Unable to refresh Trakt token' } if $@ || !$tx;
    my $res = $tx->result;
    my $json = $res->json || {};
    return { success => 1, %$json } if $res->is_success && $json->{access_token};

    my $reason = $json->{error} || ($res->is_success ? 'invalid_response' : 'unknown');
    $c->app->log->warn("Trakt token refresh rejected: $reason");
    return { success => 0, error => 'Unable to refresh Trakt token', reason => $reason };
}

# Parses and returns the items JSON array from the request params.
sub _items_from_param {
    my ($c) = @_;
    my $items = eval { from_json($c->param('items') || '[]') };
    return [] if $@ || ref $items ne 'ARRAY';
    return $items;
}

# Builds a Trakt sync payload hash from a list of items with media type and trakt_id.
sub _sync_payload_from_items {
    my ($items) = @_;
    return undef unless ref $items eq 'ARRAY' && @$items;

    my %payload = ( movies => [], shows => [], episodes => [] );
    for my $item (@$items) {
        next unless ref $item eq 'HASH';
        my $type = $item->{media_type} || $item->{type} || '';
        my $id = $item->{trakt_id} || '';
        next unless $id && $id =~ /\A\d+\z/;
        if ($type eq 'movie') {
            push @{$payload{movies}}, { ids => { trakt => 0 + $id } };
        } elsif ($type eq 'show') {
            push @{$payload{shows}}, { ids => { trakt => 0 + $id } };
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
        for my $type (qw(movie show episode)) {
            my $id = ((($row->{$type} || {})->{ids} || {})->{trakt} || 0);
            next unless $id;
            push @items, { media_type => $type, trakt_id => 0 + $id };
            last;
        }
    }

    return _sync_payload_from_items(\@items);
}

# Validates that a Trakt sync history response accepted the expected items.
sub _history_response_accepted {
    my ($data, $payload, $action) = @_;
    $data ||= {};
    return (0, 'Trakt did not return a sync result') unless ref $data eq 'HASH';

    my $not_found = _history_response_count($data->{not_found});
    return (0, 'Trakt could not find one or more selected items') if $not_found;
    return (1, undef) if ($action || '') eq 'remove';

    my $expected = _history_payload_count($payload);
    my $accepted = _history_response_count($data->{added}) + _history_response_count($data->{existing});
    return (1, undef) if $expected && $accepted >= $expected;
    return (0, 'Trakt did not mark the selected items as watched');
}

# Counts the total number of movies, episodes, and shows in a sync payload.
sub _history_payload_count {
    my ($payload) = @_;
    return 0 unless ref $payload eq 'HASH';

    my $count = scalar(@{$payload->{movies} || []}) + scalar(@{$payload->{episodes} || []});
    for my $show (@{$payload->{shows} || []}) {
        if ($show->{seasons}) {
            for my $season (@{$show->{seasons} || []}) {
                $count += scalar(@{$season->{episodes} || []});
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
            my ($type, $media) = _media_from_cached_row($raw);
            $item->{media_type} ||= $type if $type;
            $item->{overview} ||= $media->{overview} || '';
            my $media_images = _normalize_images($media->{images});
            $item->{images} = keys(%$media_images) ? $media_images : _normalize_images($raw->{images});
            if (($item->{media_type} || '') eq 'show') {
                $item->{unwatched_count} = 0 + (($state->{unwatched_counts} || {})->{0 + ($item->{trakt_id} || 0)} || 0);
            }
            if (($item->{media_type} || '') eq 'episode') {
                $item->{show_images} = _normalize_images((($raw || {})->{show} || {})->{images});
                $item->{show_title} ||= (($raw || {})->{show} || {})->{title} || '';
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
    my ($row) = @_;
    $row ||= {};
    for my $type (qw(movie show season episode)) {
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

# Checks whether Trakt app credentials (client_id and client_secret) are configured.
sub _trakt_configured {
    my ($c) = @_;
    my $creds = $c->db->get_trakt_app_credentials();
    return $creds->{client_id} && $creds->{client_secret};
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
