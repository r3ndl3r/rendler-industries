# /lib/MyApp/Controller/Trakt.pm

package MyApp::Controller::Trakt;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::JSON qw(decode_json from_json);
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

# Renders the Trakt dashboard skeleton.
# Route: GET /trakt
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family;
    $c->render('trakt');
}

# Returns the full Trakt dashboard state for the current user.
# Route: GET /trakt/api/state
# Returns: JSON { success, configured, connection, lists, upcoming, unwatched }
sub api_state {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);

    my $opts = {};
    $opts->{skip_unwatched} = 1 if $c->param('skip_unwatched');
    my $state = eval { _dashboard_state($c, $opts) };
    if ($@) {
        $c->app->log->error("Trakt state failed: $@");
        return $c->render(json => { success => 0, error => 'Trakt tables are not ready' });
    }

    $state->{success} = 1;
    $state->{configured} = _trakt_configured($c) ? 1 : 0;
    return $c->render(json => $state);
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
    $c->db->delete_trakt_unwatched_cache($c->current_user_id);
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
    return $c->render(json => { success => 1, state => _dashboard_state($c, { skip_unwatched => 1 }) });
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

    my $res = _trakt_request($c, 'POST', '/users/me/lists', {
        name => $name,
        description => trim($c->param('description') // ''),
        privacy => 'private'
    });
    return _json_error($c, $res->{error}) unless $res->{success};

    my ($synced, $sync_error) = _sync_user($c);
    return _json_error($c, $sync_error || 'Unable to sync Trakt') unless $synced;
    return $c->render(json => { success => 1, state => _dashboard_state($c, { skip_unwatched => 1 }) });
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
    return _json_error($c, 'Watchlist name cannot be changed') unless ($list->{trakt_list_id} || 0) != 0;

    my $name = trim($c->param('name') // $list->{name});
    return _json_error($c, 'List name is required') unless $name;

    my $res = _trakt_request($c, 'PUT', '/users/me/lists/' . $list->{trakt_list_id}, {
        name => $name,
        description => trim($c->param('description') // $list->{description} // ''),
        privacy => $list->{privacy} || 'private'
    });
    return _json_error($c, $res->{error}) unless $res->{success};

    my ($synced, $sync_error) = _sync_user($c);
    return _json_error($c, $sync_error || 'Unable to sync Trakt') unless $synced;
    return $c->render(json => { success => 1, state => _dashboard_state($c, { skip_unwatched => 1 }) });
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
    return _json_error($c, 'Watchlist cannot be deleted') unless ($list->{trakt_list_id} || 0) != 0;

    my $res = _trakt_request($c, 'DELETE', '/users/me/lists/' . $list->{trakt_list_id});
    return _json_error($c, $res->{error}) unless $res->{success};

    my ($synced, $sync_error) = _sync_user($c);
    return _json_error($c, $sync_error || 'Unable to sync Trakt') unless $synced;
    return $c->render(json => { success => 1, state => _dashboard_state($c, { skip_unwatched => 1 }) });
}

# Toggles the collapsed state of a list section for the current user.
# Route: POST /trakt/api/lists/:id/collapse
# Parameters: id (list DB id), collapsed (0 or 1)
# Returns: JSON { success, state }
sub api_list_collapse {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);

    my $list_id = $c->param('id');
    my $collapsed = ($c->param('collapsed') // 1) ? 1 : 0;
    my $ok = $c->db->set_trakt_list_collapsed($c->current_user_id, $list_id, $collapsed);
    return _json_error($c, 'List not found') unless $ok;

    return $c->render(json => { success => 1, state => _dashboard_state($c, { skip_unwatched => 1 }) });
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

    my $path = ($list->{trakt_list_id} || 0) == 0
        ? '/sync/watchlist'
        : '/users/me/lists/' . $list->{trakt_list_id} . '/items';
    my $res = _trakt_request($c, 'POST', $path, $payload);
    return _json_error($c, $res->{error}) unless $res->{success};

    eval { $c->db->add_trakt_cached_list_items($c->current_user_id, $list, $items) };
    return _json_error($c, 'Unable to update Trakt cache') if $@;
    $c->db->delete_trakt_unwatched_cache($c->current_user_id) if ($list->{trakt_list_id} || 0) == 0;
    return $c->render(json => { success => 1, state => _dashboard_state($c, { skip_unwatched => 1 }) });
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

    my $path = ($list->{trakt_list_id} || 0) == 0
        ? '/sync/watchlist/remove'
        : '/users/me/lists/' . $list->{trakt_list_id} . '/items/remove';
    my $res = _trakt_request($c, 'POST', $path, $payload);
    return _json_error($c, $res->{error}) unless $res->{success};

    eval { $c->db->remove_trakt_cached_list_items($c->current_user_id, $list, $items) };
    return _json_error($c, 'Unable to update Trakt cache') if $@;
    $c->db->delete_trakt_unwatched_cache($c->current_user_id) if ($list->{trakt_list_id} || 0) == 0;
    return $c->render(json => { success => 1, state => _dashboard_state($c, { skip_unwatched => 1 }) });
}

# Marks items as watched in Trakt history.
# Route: POST /trakt/api/history/add
# Parameters: items (JSON array of {media_type, trakt_id}), watchlist_show_ids (JSON array of show trakt_ids)
# Returns: JSON { success, message, state }
sub api_history_add {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);
    return _json_error($c, 'Connect Trakt first') unless _ensure_token($c);

    my $items = _items_from_param($c);
    my $payload = _sync_payload_from_items($items);
    my $watchlist_shows = _watchlist_show_ids_from_param($c);
    return _json_error($c, 'Select at least one item') unless $payload;

    my $res = _trakt_request($c, 'POST', '/sync/history', $payload);
    return _json_error($c, $res->{error}) unless $res->{success};
    my ($accepted, $accept_error) = _history_response_accepted($res->{data}, $payload, 'add');
    return _json_error($c, $accept_error) unless $accepted;
    my $preserve = _preserve_watchlist_shows($c, $watchlist_shows);
    return _json_error($c, $preserve->{error}) unless $preserve->{success};
    eval { $c->db->set_trakt_cached_items_watched($c->current_user_id, $items, 1) };
    return _json_error($c, 'Unable to update Trakt cache') if $@;
    $c->db->delete_trakt_unwatched_cache($c->current_user_id);
    return $c->render(json => { success => 1, message => 'Marked watched', state => _dashboard_state($c, { skip_unwatched => 1 }) });
}

# Marks items as unwatched in Trakt history.
# Route: POST /trakt/api/history/remove
# Parameters: items (JSON array of {media_type, trakt_id}), watchlist_show_ids (JSON array of show trakt_ids)
# Returns: JSON { success, message, state }
sub api_history_remove {
    my $c = shift;
    return _unauthorized($c) unless _authorized($c);
    return _json_error($c, 'Connect Trakt first') unless _ensure_token($c);

    my $items = _items_from_param($c);
    my $payload = _sync_payload_from_items($items);
    my $watchlist_shows = _watchlist_show_ids_from_param($c);
    return _json_error($c, 'Select at least one item') unless $payload;

    my $res = _trakt_request($c, 'POST', '/sync/history/remove', $payload);
    return _json_error($c, $res->{error}) unless $res->{success};
    my ($accepted, $accept_error) = _history_response_accepted($res->{data}, $payload, 'remove');
    return _json_error($c, $accept_error) unless $accepted;
    my $preserve = _preserve_watchlist_shows($c, $watchlist_shows);
    return _json_error($c, $preserve->{error}) unless $preserve->{success};
    eval { $c->db->set_trakt_cached_items_watched($c->current_user_id, $items, 0) };
    return _json_error($c, 'Unable to update Trakt cache') if $@;
    $c->db->delete_trakt_unwatched_cache($c->current_user_id);
    return $c->render(json => { success => 1, message => 'Marked unwatched', state => _dashboard_state($c, { skip_unwatched => 1 }) });
}

sub _sync_user {
    my ($c) = @_;
    return (0, 'Connect Trakt first') unless _ensure_token($c);

    my $watchlist_shows = _trakt_request($c, 'GET', '/sync/watchlist/shows?extended=full');
    return (0, $watchlist_shows->{error}) unless $watchlist_shows->{success};

    my $watchlist_movies = _trakt_request($c, 'GET', '/sync/watchlist/movies?extended=full');
    return (0, $watchlist_movies->{error}) unless $watchlist_movies->{success};

    my $lists = _trakt_request($c, 'GET', '/users/me/lists');
    return (0, $lists->{error}) unless $lists->{success};

    my %items_by_list;
    for my $list (@{$lists->{data} || []}) {
        my $trakt_id = $list->{ids}{trakt};
        next unless $trakt_id;
        my $items = _trakt_request($c, 'GET', '/users/me/lists/' . $trakt_id . '/items?extended=full');
        return (0, $items->{error}) unless $items->{success};
        $items_by_list{$trakt_id} = $items->{data} || [];
    }

    my $watched_movies = _trakt_request($c, 'GET', '/sync/watched/movies?extended=full');
    my $watched_shows = _trakt_request($c, 'GET', '/sync/watched/shows?extended=full');
    return (0, $watched_movies->{error}) unless $watched_movies->{success};
    return (0, $watched_shows->{error}) unless $watched_shows->{success};
    my $watched = _watched_lookup(
        $watched_movies->{data} || [],
        $watched_shows->{data} || []
    );

    my @watchlist_show_rows = @{$watchlist_shows->{data} || []};
    my @watchlist_movie_rows = @{$watchlist_movies->{data} || []};
    _enrich_watchlist_rows($c, \@watchlist_show_rows, 'show');
    _enrich_watchlist_rows($c, \@watchlist_movie_rows, 'movie');
    my @watchlist_all_rows = (@watchlist_show_rows, @watchlist_movie_rows);
    my %watch_show_ids = map { (($_->{show} || {})->{ids} || {})->{trakt} => 1 } @watchlist_show_rows;
    delete $watch_show_ids{''};
    my $start = $c->now->ymd;
    my $calendar = _trakt_request($c, 'GET', "/calendars/my/shows/$start/130?extended=full");
    my @upcoming = $calendar->{success}
        ? grep { $watch_show_ids{(($_->{show} || {})->{ids} || {})->{trakt} || ''} } @{$calendar->{data} || []}
        : ();

    eval {
        $c->db->replace_trakt_cache(
            $c->current_user_id,
            \@watchlist_show_rows,
            \@watchlist_all_rows,
            \@upcoming,
            $lists->{data} || [],
            \%items_by_list,
            $watched
        );
    };
    if ($@) {
        $c->app->log->error("Trakt cache sync failed: $@");
        return (0, 'Unable to save Trakt sync data');
    }

    return (1, undef);
}

sub _dashboard_state {
    my ($c, $opts) = @_;
    $opts ||= {};
    my $state = $c->db->get_trakt_dashboard_state($c->current_user_id);
    $state->{unwatched} = !$opts->{skip_unwatched} && $state->{connection}{connected}
        ? _watchlist_unwatched_state($c, $state->{lists})
        : [];
    delete $state->{unwatched} if $opts->{skip_unwatched};

    my $cached_raw = $c->db->get_trakt_unwatched_cache($c->current_user_id);
    if ($cached_raw) {
        my $cached = eval { decode_json($cached_raw) };
        if (ref $cached eq 'ARRAY') {
            my %counts;
            for my $ep (@$cached) {
                $counts{0 + ($ep->{show_trakt_id} || 0)}++;
            }
            $state->{unwatched_counts} = \%counts;
        }
    }

    return _normalize_dashboard_state($state);
}

sub _watchlist_unwatched_state {
    my ($c, $lists) = @_;
    $lists ||= [];

    my $cached_raw = $c->db->get_trakt_unwatched_cache($c->current_user_id);
    if ($cached_raw) {
        my $cached = eval { decode_json($cached_raw) };
        return $cached if ref $cached eq 'ARRAY';
    }

    my ($watchlist) = grep { ($_->{trakt_list_id} || 0) == 0 } @{$lists};
    return [] unless $watchlist;

    my %watchlist_show_ids = map { ($_->{trakt_id} || 0) => 1 }
        grep { ($_->{media_type} || '') eq 'show' && ($_->{trakt_id} || 0) }
        @{ $watchlist->{items} || [] };
    return [] unless %watchlist_show_ids;

    my @items;
    for my $show_id (sort { $a <=> $b } keys %watchlist_show_ids) {
        my $show = _trakt_request($c, 'GET', '/shows/' . $show_id . '?extended=full');
        next unless $show->{success};

        my $seasons = _trakt_request($c, 'GET', '/shows/' . $show_id . '/seasons?extended=full,episodes');
        next unless $seasons->{success};

        my $progress = _trakt_request($c, 'GET', '/shows/' . $show_id . '/progress/watched?hidden=false&specials=false&count_specials=false');
        my $watched = _show_progress_lookup($progress->{success} ? $progress->{data} : {});
        my $show_title = ($show->{data} || {})->{title} || '';
        my $show_year = ($show->{data} || {})->{year};

        for my $season (@{$seasons->{data} || []}) {
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
                    show_title    => $show_title,
                    show_images   => _normalize_images((($show->{data} || {})->{images} || {})),
                    title         => $episode->{title} || '',
                    year          => $show_year,
                    season        => $season_num,
                    episode       => $episode_num,
                    first_aired   => $episode->{first_aired},
                    list_name     => 'Watchlist'
                };
            }
        }
    }

    @items = sort { ($b->{first_aired} || '') cmp ($a->{first_aired} || '') } @items;

    $c->db->set_trakt_unwatched_cache($c->current_user_id, \@items);
    return \@items;
}

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

sub _enrich_watchlist_rows {
    my ($c, $rows, $type) = @_;
    return unless ref $rows eq 'ARRAY' && @$rows;
    return unless ($type || '') eq 'show' || ($type || '') eq 'movie';

    my %details;
    for my $row (@$rows) {
        next unless ref $row eq 'HASH';
        my $media = $row->{$type} || next;
        next if _normalize_images($media->{images})->{poster};
        my $trakt_id = (($media->{ids} || {})->{trakt} || 0);
        next unless $trakt_id;
        if (!$details{$trakt_id}) {
            my $detail = _trakt_request($c, 'GET', '/' . $type . 's/' . $trakt_id . '?extended=full');
            $details{$trakt_id} = $detail->{success} && ref $detail->{data} eq 'HASH' ? $detail->{data} : {};
        }
        my $fallback = $details{$trakt_id} || {};
        $media->{images} ||= $fallback->{images} if ref $fallback->{images} eq 'HASH';
    }
}

sub _episode_is_aired {
    my ($c, $first_aired) = @_;
    return 0 unless $first_aired;
    my $episode_time = substr($first_aired, 0, 19);
    my $now = $c->now->clone;
    $now->set_time_zone('UTC');
    my $now_utc = $now->strftime('%Y-%m-%dT%H:%M:%S');
    return $episode_time le $now_utc ? 1 : 0;
}

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

sub _ensure_token {
    my ($c) = @_;
    my $conn = $c->db->get_trakt_connection($c->current_user_id);
    return undef unless $conn && ($conn->{status} || '') eq 'connected' && $conn->{access_token};
    return $conn->{access_token} if ($conn->{expires_at} || '') gt _mysql_time($c, 90);

    my $creds = $c->db->get_trakt_app_credentials();
    my $res = _token_refresh($c, $conn, $creds);
    unless ($res->{success}) {
        $c->app->log->warn("Trakt token refresh failed for user " . $c->current_user_id . ", disconnecting");
        eval { $c->db->disconnect_trakt_connection($c->current_user_id) };
        return undef;
    }

    $c->db->upsert_trakt_connection($c->current_user_id, {
        trakt_user_id  => $conn->{trakt_user_id},
        trakt_username => $conn->{trakt_username},
        access_token   => $res->{access_token},
        refresh_token  => $res->{refresh_token},
        token_type     => $res->{token_type},
        expires_at     => _mysql_time($c, $res->{expires_in} || 0),
        scope          => $res->{scope}
    });
    return $res->{access_token};
}

sub _trakt_request {
    my ($c, $method, $path, $payload, $override_token) = @_;
    my $creds = $c->db->get_trakt_app_credentials();
    my $token = $override_token || _ensure_token($c);

    unless ($token) {
        my $conn = $c->db->get_trakt_connection($c->current_user_id);
        if ($conn && ($conn->{status} || '') eq 'disconnected') {
            return { success => 0, error => 'Trakt session expired — reconnect your account' };
        }
        return { success => 0, error => 'Connect Trakt first' };
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
    return { success => 1, %{$res->json || {}} } if $res->is_success;
    return { success => 0, error => 'Unable to connect Trakt account' };
}

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
    return { success => 1, %{$res->json || {}} } if $res->is_success;

    my $json = $res->json || {};
    my $reason = $json->{error} || 'unknown';
    $c->app->log->warn("Trakt token refresh rejected: $reason");
    return { success => 0, error => 'Unable to refresh Trakt token', reason => $reason };
}

sub _sync_payload_from_param {
    my ($c) = @_;
    return _sync_payload_from_items(_items_from_param($c));
}

sub _items_from_param {
    my ($c) = @_;
    my $items = eval { from_json($c->param('items') || '[]') };
    return [] if $@ || ref $items ne 'ARRAY';
    return $items;
}

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

sub _watchlist_show_ids_from_param {
    my ($c) = @_;
    my $ids = eval { decode_json($c->param('watchlist_show_ids') || '[]') };
    return [] if $@ || ref $ids ne 'ARRAY';

    my %allowed;
    eval {
        for my $list (@{$c->db->get_trakt_lists($c->current_user_id) || []}) {
            next unless ($list->{trakt_list_id} || 0) == 0;
            for my $item (@{$list->{items} || []}) {
                next unless ($item->{media_type} || '') eq 'show' && ($item->{trakt_id} || 0);
                $allowed{0 + $item->{trakt_id}} = 1;
            }
        }
    };

    my (%seen, @out);
    for my $id (@$ids) {
        next unless defined $id && $id =~ /\A\d+\z/;
        $id = 0 + $id;
        next unless $allowed{$id} && !$seen{$id}++;
        push @out, $id;
    }
    return \@out;
}

sub _preserve_watchlist_shows {
    my ($c, $show_ids) = @_;
    $show_ids ||= [];
    return { success => 1 } unless @$show_ids;

    my @shows = map { { ids => { trakt => 0 + $_ } } } @$show_ids;
    my $res = _trakt_request($c, 'POST', '/sync/watchlist', { shows => \@shows });
    return $res->{success} ? { success => 1 } : $res;
}

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

sub _decode_raw_json {
    my ($raw) = @_;
    return {} unless defined $raw && length $raw;
    my $data = eval { decode_json($raw) };
    return ref $data eq 'HASH' ? $data : {};
}

sub _media_from_cached_row {
    my ($row) = @_;
    $row ||= {};
    for my $type (qw(movie show season episode)) {
        return ($type, $row->{$type}) if ref $row->{$type} eq 'HASH';
    }
    return (undef, {});
}

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

sub _trakt_configured {
    my ($c) = @_;
    my $creds = $c->db->get_trakt_app_credentials();
    return $creds->{client_id} && $creds->{client_secret};
}

sub _redirect_uri {
    my ($c) = @_;
    return $c->url_for('/trakt/oauth')->to_abs->to_string;
}

sub _mysql_time {
    my ($c, $offset_seconds) = @_;
    my $dt = $c->now->clone;
    $dt->add(seconds => $offset_seconds || 0);
    return $dt->strftime('%Y-%m-%d %H:%M:%S');
}

sub _unauthorized {
    my ($c) = @_;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403);
}

sub _authorized {
    my ($c) = @_;
    return $c->is_logged_in && $c->is_family;
}

sub _json_error {
    my ($c, $error) = @_;
    return $c->render(json => { success => 0, error => $error || 'Trakt request failed' });
}

sub register_routes {
    my ($class, $r) = @_;
    $r->{family}->get('/trakt')->to('trakt#index');
    $r->{family}->get('/trakt/api/state')->to('trakt#api_state');
    $r->{family}->get('/trakt/oauth/start')->to('trakt#oauth_start');
    $r->{family}->get('/trakt/oauth')->to('trakt#oauth_callback');
    $r->{family}->post('/trakt/api/oauth/disconnect')->to('trakt#api_disconnect');
    $r->{family}->post('/trakt/api/sync')->to('trakt#api_sync');
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
