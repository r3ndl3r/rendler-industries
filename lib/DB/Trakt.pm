# /lib/DB/Trakt.pm

package DB::Trakt;

use strict;
use warnings;
use Mojo::JSON qw(encode_json);

# Database Library for the Trakt module.
#
# Features:
#   - Per-user OAuth token management with automatic refresh support.
#   - Full sync cache replacement for lists, watchlist, and upcoming episodes.
#   - Cached dashboard state assembly for the Trakt interface.
#   - Transactional integrity for cache replacement and user data clearing.
#
# Integration Points:
#   - Extends the core DB package via package injection.
#   - Acts as the primary data source for the Trakt controller.
#   - Provides data payloads for Trakt state-driven responses.
#   - Coordinates with the Trakt API through the controller for data synchronization.

sub DB::get_trakt_connection {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "SELECT * FROM trakt_connections WHERE user_id = ? LIMIT 1"
    );
    $sth->execute($user_id);
    return $sth->fetchrow_hashref || undef;
}

# Creates or updates a Trakt OAuth connection record for a user.
# Uses INSERT ... ON DUPLICATE KEY UPDATE to handle reconnection.
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
#   $conn  : Hashref of connection fields (access_token, refresh_token, etc.)
sub DB::upsert_trakt_connection {
    my ($self, $user_id, $conn) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        q{INSERT INTO trakt_connections
          (user_id, trakt_user_id, trakt_username, access_token, refresh_token, token_type, expires_at, scope, status, connected_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'connected', NOW(), NOW())
          ON DUPLICATE KEY UPDATE
            trakt_user_id = VALUES(trakt_user_id),
            trakt_username = VALUES(trakt_username),
            access_token = VALUES(access_token),
            refresh_token = VALUES(refresh_token),
            token_type = VALUES(token_type),
            expires_at = VALUES(expires_at),
            scope = VALUES(scope),
            status = 'connected',
            updated_at = NOW()}
    );
    $sth->execute(
        $user_id,
        $conn->{trakt_user_id},
        $conn->{trakt_username},
        $conn->{access_token},
        $conn->{refresh_token},
        $conn->{token_type} || 'bearer',
        $conn->{expires_at},
        $conn->{scope} || ''
    );
}

# Disconnects a Trakt connection by nullifying tokens and setting status to 'disconnected'.
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
sub DB::disconnect_trakt_connection {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        q{UPDATE trakt_connections
          SET access_token = NULL, refresh_token = NULL, expires_at = NULL, status = 'disconnected', updated_at = NOW()
          WHERE user_id = ?}
    );
    return $sth->execute($user_id);
}

# Deletes all cached Trakt data for a user (lists, items, upcoming, watchlist).
# Runs inside a transaction; rolls back on failure.
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
sub DB::clear_trakt_user_cache {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    my $dbh = $self->{dbh};
    local $dbh->{AutoCommit} = 0;
    eval {
        $dbh->do("DELETE FROM trakt_assignments WHERE user_id = ?", undef, $user_id);
        $dbh->do("DELETE FROM trakt_list_items WHERE user_id = ?", undef, $user_id);
        $dbh->do("DELETE FROM trakt_lists WHERE user_id = ?", undef, $user_id);
        $dbh->do("DELETE FROM trakt_unwatched_cache WHERE user_id = ?", undef, $user_id);
        $dbh->do("DELETE FROM trakt_upcoming WHERE user_id = ?", undef, $user_id);
        $dbh->do("DELETE FROM trakt_watchlist_items WHERE user_id = ?", undef, $user_id);
        $dbh->commit;
    };
    if ($@) {
        my $err = $@;
        eval { $dbh->rollback };
        die $err;
    }
}

# Assembles the full dashboard state: connection info, lists, upcoming, and unwatched.
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
# Returns:
#   Hashref with keys: connection, lists, upcoming, unwatched
sub DB::get_trakt_dashboard_state {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    return {
        connection  => $self->get_trakt_public_connection($user_id),
        lists       => $self->get_trakt_lists($user_id),
        upcoming    => $self->get_trakt_upcoming($user_id),
        unwatched   => []
    };
}

# Returns a safe public subset of the connection (no tokens).
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
# Returns:
#   Hashref with connected flag, username, expiration, and last_synced_at
sub DB::get_trakt_public_connection {
    my ($self, $user_id) = @_;
    my $conn = $self->get_trakt_connection($user_id);
    return { connected => 0 } unless $conn && ($conn->{status} || '') eq 'connected';

    return {
        connected      => 1,
        trakt_username => $conn->{trakt_username} || '',
        expires_at     => $conn->{expires_at},
        last_synced_at => $conn->{last_synced_at}
    };
}

# Fetches all Trakt lists for a user, each populated with its items.
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
# Returns:
#   Arrayref of list hashrefs, each containing an 'items' arrayref
sub DB::get_trakt_lists {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    my $list_sth = $self->{dbh}->prepare(
        q{SELECT id, trakt_list_id, trakt_slug, name, description, privacy, display_numbers, allow_comments, sort_by, sort_how, item_count, collapsed, updated_at,
                 CASE WHEN trakt_list_id = 0 THEN 1 ELSE 0 END AS is_watchlist
          FROM trakt_lists
          WHERE user_id = ?
          ORDER BY CASE WHEN trakt_list_id = 0 THEN 0 ELSE 1 END, LOWER(name)}
    );
    my $item_sth = $self->{dbh}->prepare(
        q{SELECT id, list_id, media_type, trakt_id, imdb_id, tmdb_id, title, year, season, episode, watched, raw_json
          FROM trakt_list_items
          WHERE user_id = ? AND list_id = ?
          ORDER BY LOWER(title), season, episode}
    );

    $list_sth->execute($user_id);
    my @lists;
    while (my $list = $list_sth->fetchrow_hashref) {
        $item_sth->execute($user_id, $list->{id});
        $list->{items} = $item_sth->fetchall_arrayref({});
        push @lists, $list;
    }

    return \@lists;
}

# Fetches upcoming episodes for a user, ordered by first_aired.
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
# Returns:
#   Arrayref of upcoming episode hashrefs (max 500)
sub DB::get_trakt_upcoming {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        q{SELECT id, show_trakt_id, episode_trakt_id, title, show_title, season, episode, first_aired, network, raw_json
          FROM trakt_upcoming
          WHERE user_id = ?
          ORDER BY first_aired ASC, show_title ASC
          LIMIT 500}
    );
    $sth->execute($user_id);
    return $sth->fetchall_arrayref({});
}

# Full cache replacement: purges old watchlist/upcoming/data, inserts fresh data from the Trakt API.
# Manages the special watchlist list, user lists, and list items inside a transaction.
# Parameters:
#   $self : DB instance
#   $user_id : User ID
#   $watchlist_shows : Shows for the watchlist summary
#   $watchlist_all  : All watchlist items (including non-show)
#   $upcoming       : Upcoming episode data
#   $lists          : User list definitions
#   $items_by_list  : Items grouped by list trakt_id
#   $watched        : Watched status hashref
sub DB::replace_trakt_cache {
    my ($self, $user_id, $watchlist_shows, $watchlist_all, $upcoming, $lists, $items_by_list, $watched) = @_;
    $self->ensure_connection;

    my $dbh = $self->{dbh};
    local $dbh->{AutoCommit} = 0;
    eval {
        $dbh->do("DELETE FROM trakt_watchlist_items WHERE user_id = ?", undef, $user_id);
        $dbh->do("DELETE FROM trakt_upcoming WHERE user_id = ?", undef, $user_id);

        _insert_watchlist($dbh, $user_id, $watchlist_shows || []);
        _insert_upcoming($dbh, $user_id, $upcoming || []);

        my %seen_lists;
        my $watchlist_id = _upsert_list($dbh, $user_id, {
            ids => { trakt => 0, slug => 'watchlist' },
            name => 'Watchlist',
            description => 'Special Trakt watchlist',
            privacy => 'private',
            display_numbers => 1,
            allow_comments => 0,
            sort_by => 'rank',
            sort_how => 'asc',
            item_count => scalar(@{$watchlist_all || []})
        });
        $seen_lists{$watchlist_id} = 1;
        $dbh->do("DELETE FROM trakt_list_items WHERE user_id = ? AND list_id = ?", undef, $user_id, $watchlist_id);
        for my $item (@{$watchlist_all || []}) {
            _upsert_list_item($dbh, $user_id, $watchlist_id, $item, $watched || {});
        }

        for my $list (@{$lists || []}) {
            my $list_id = _upsert_list($dbh, $user_id, $list);
            $seen_lists{$list_id} = 1;
            $dbh->do("DELETE FROM trakt_list_items WHERE user_id = ? AND list_id = ?", undef, $user_id, $list_id);
            for my $item (@{($items_by_list || {})->{$list->{ids}{trakt}} || []}) {
                _upsert_list_item($dbh, $user_id, $list_id, $item, $watched || {});
            }
        }

        if (%seen_lists) {
            my $placeholders = join(',', ('?') x keys %seen_lists);
            $dbh->do("DELETE FROM trakt_lists WHERE user_id = ? AND id NOT IN ($placeholders)", undef, $user_id, keys %seen_lists);
        } else {
            $dbh->do("DELETE FROM trakt_lists WHERE user_id = ?", undef, $user_id);
        }

        my $sth = $dbh->prepare("UPDATE trakt_connections SET last_synced_at = NOW(), updated_at = NOW() WHERE user_id = ?");
        $sth->execute($user_id);
        $dbh->commit;
    };
    if ($@) {
        my $err = $@;
        eval { $dbh->rollback };
        die $err;
    }
}

# Fetches a single list by user_id and list id, verifying ownership.
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
#   $id    : List ID
# Returns:
#   Hashref or undef
sub DB::get_trakt_list_for_owner {
    my ($self, $user_id, $id) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "SELECT * FROM trakt_lists WHERE user_id = ? AND id = ? LIMIT 1"
    );
    $sth->execute($user_id, $id);
    return $sth->fetchrow_hashref || undef;
}

# Updates the collapsed state of a user's list.
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
#   $list_id : List ID
#   $collapsed : Boolean collapsed state
sub DB::set_trakt_list_collapsed {
    my ($self, $user_id, $list_id, $collapsed) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "UPDATE trakt_lists SET collapsed = ? WHERE user_id = ? AND id = ?"
    );
    return $sth->execute($collapsed ? 1 : 0, $user_id, $list_id);
}

# Fetches a single list item by user_id and item id, verifying ownership.
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
#   $id    : Item ID
# Returns:
#   Hashref or undef
sub DB::get_trakt_list_item_for_owner {
    my ($self, $user_id, $id) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "SELECT * FROM trakt_list_items WHERE user_id = ? AND id = ? LIMIT 1"
    );
    $sth->execute($user_id, $id);
    return $sth->fetchrow_hashref || undef;
}

# Inserts items into a cached list, with optional watchlist sync for the special watchlist.
# Runs inside a transaction; refreshes the list item count on completion.
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
#   $list  : List hashref
#   $items : Arrayref of item hashrefs
# Returns:
#   1 on success, 0 on invalid input
sub DB::add_trakt_cached_list_items {
    my ($self, $user_id, $list, $items) = @_;
    $self->ensure_connection;
    return 0 unless $list && $list->{id} && ref $items eq 'ARRAY';

    my $dbh = $self->{dbh};
    local $dbh->{AutoCommit} = 0;
    eval {
        for my $item (@$items) {
            _upsert_client_list_item($dbh, $user_id, $list->{id}, $item);
            _upsert_watchlist_show_from_client($dbh, $user_id, $item)
                if ($list->{trakt_list_id} || 0) == 0;
        }
        _refresh_list_item_count($dbh, $user_id, $list->{id});
        $dbh->commit;
    };
    if ($@) {
        my $err = $@;
        eval { $dbh->rollback };
        die $err;
    }
    return 1;
}

# Removes items from a cached list, cleaning up watchlist/upcoming if they belong to the special watchlist.
# Runs inside a transaction; refreshes the list item count on completion.
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
#   $list  : List hashref
#   $items : Arrayref of item hashrefs
# Returns:
#   1 on success, 0 on invalid input
sub DB::remove_trakt_cached_list_items {
    my ($self, $user_id, $list, $items) = @_;
    $self->ensure_connection;
    return 0 unless $list && $list->{id} && ref $items eq 'ARRAY';

    my $dbh = $self->{dbh};
    local $dbh->{AutoCommit} = 0;
    eval {
        my $delete_sth = $dbh->prepare(
            q{DELETE FROM trakt_list_items
              WHERE user_id = ? AND list_id = ? AND media_type = ? AND trakt_id = ? AND season = ? AND episode = ?}
        );
        my $is_watchlist = ($list->{trakt_list_id} || 0) == 0;
        for my $item (@$items) {
            next unless ref $item eq 'HASH';
            my $type = $item->{media_type} || $item->{type} || '';
            my $id = $item->{trakt_id} || 0;
            next unless $type && $id;
            my $season = $item->{season} || 0;
            my $episode = $item->{episode} || 0;
            $delete_sth->execute($user_id, $list->{id}, $type, $id, $season, $episode);
            if ($is_watchlist && $type eq 'show') {
                $dbh->do("DELETE FROM trakt_watchlist_items WHERE user_id = ? AND show_trakt_id = ?", undef, $user_id, $id);
                $dbh->do("DELETE FROM trakt_upcoming WHERE user_id = ? AND show_trakt_id = ?", undef, $user_id, $id);
            }
        }
        _refresh_list_item_count($dbh, $user_id, $list->{id});
        $dbh->commit;
    };
    if ($@) {
        my $err = $@;
        eval { $dbh->rollback };
        die $err;
    }
    return 1;
}

# Bulk-updates the watched flag on cached list items.
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
#   $items : Arrayref of item hashrefs
#   $watched : Boolean watched state
# Returns:
#   1 on success, 0 on invalid input
sub DB::set_trakt_cached_items_watched {
    my ($self, $user_id, $items, $watched) = @_;
    $self->ensure_connection;
    return 0 unless ref $items eq 'ARRAY';

    my $sth = $self->{dbh}->prepare(
        q{UPDATE trakt_list_items
          SET watched = ?, updated_at = NOW()
          WHERE user_id = ? AND media_type = ? AND trakt_id = ? AND season = ? AND episode = ?}
    );
    for my $item (@$items) {
        next unless ref $item eq 'HASH';
        my $type = $item->{media_type} || $item->{type} || '';
        my $id = $item->{trakt_id} || 0;
        next unless $type && $id;
        $sth->execute($watched ? 1 : 0, $user_id, $type, $id, $item->{season} || 0, $item->{episode} || 0);
    }
    return 1;
}

# Retrieves cached unwatched data for a user, if the cache is still fresh relative to last sync.
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
# Returns:
#   Cached data string, or undef if stale/missing
sub DB::get_trakt_unwatched_cache {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        q{SELECT c.data, c.updated_at, COALESCE(t.last_synced_at, '2000-01-01') AS last_synced_at
          FROM trakt_unwatched_cache c
          LEFT JOIN trakt_connections t ON t.user_id = c.user_id
          WHERE c.user_id = ?}
    );
    $sth->execute($user_id);
    my $row = $sth->fetchrow_hashref;
    return undef unless $row && $row->{data} && $row->{updated_at} ge $row->{last_synced_at};

    return $row->{data};
}

# Stores or updates the unwatched cache for a user.
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
#   $data  : Arrayref or raw JSON string
sub DB::set_trakt_unwatched_cache {
    my ($self, $user_id, $data) = @_;
    $self->ensure_connection;

    my $encoded = ref $data eq 'ARRAY' ? encode_json($data) : $data;
    my $sth = $self->{dbh}->prepare(
        q{INSERT INTO trakt_unwatched_cache (user_id, data, updated_at)
          VALUES (?, ?, NOW())
          ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = NOW()}
    );
    $sth->execute($user_id, $encoded);
}

# Deletes the unwatched cache row for a user.
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
sub DB::delete_trakt_unwatched_cache {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    $self->{dbh}->do("DELETE FROM trakt_unwatched_cache WHERE user_id = ?", undef, $user_id);
}

# Batch-inserts watchlist show items into trakt_watchlist_items.
# Parameters:
#   $dbh     : Database handle
#   $user_id : User ID
#   $items   : Arrayref of Trakt API watchlist rows
sub _insert_watchlist {
    my ($dbh, $user_id, $items) = @_;
    my $sth = $dbh->prepare(
        q{INSERT INTO trakt_watchlist_items (user_id, show_trakt_id, show_title, year, raw_json, updated_at)
          VALUES (?, ?, ?, ?, ?, NOW())}
    );
    for my $row (@$items) {
        my $show = $row->{show} || next;
        $sth->execute($user_id, $show->{ids}{trakt}, $show->{title} || '', $show->{year}, encode_json($row));
    }
}

# Batch-inserts upcoming episode items into trakt_upcoming.
# Parameters:
#   $dbh     : Database handle
#   $user_id : User ID
#   $items   : Arrayref of Trakt API upcoming rows
sub _insert_upcoming {
    my ($dbh, $user_id, $items) = @_;
    my $sth = $dbh->prepare(
        q{INSERT INTO trakt_upcoming
          (user_id, show_trakt_id, episode_trakt_id, title, show_title, season, episode, first_aired, network, raw_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())}
    );
    for my $row (@$items) {
        my $show = $row->{show} || {};
        my $episode = $row->{episode} || {};
        $sth->execute(
            $user_id,
            $show->{ids}{trakt},
            $episode->{ids}{trakt},
            $episode->{title} || '',
            $show->{title} || '',
            $episode->{season},
            $episode->{number},
            _mysql_datetime($episode->{first_aired}),
            $show->{network} || '',
            encode_json($row)
        );
    }
}

# Inserts or updates a list record. Returns the list id.
# Parameters:
#   $dbh     : Database handle
#   $user_id : User ID
#   $list    : List hashref from Trakt API
# Returns:
#   Integer list id (via LAST_INSERT_ID)
sub _upsert_list {
    my ($dbh, $user_id, $list) = @_;
    my $ids = $list->{ids} || {};
    my $sth = $dbh->prepare(
        q{INSERT INTO trakt_lists
          (user_id, trakt_list_id, trakt_slug, name, description, privacy, display_numbers, allow_comments, sort_by, sort_how, item_count, raw_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            id = LAST_INSERT_ID(id),
            trakt_slug = VALUES(trakt_slug),
            name = VALUES(name),
            description = VALUES(description),
            privacy = VALUES(privacy),
            display_numbers = VALUES(display_numbers),
            allow_comments = VALUES(allow_comments),
            sort_by = VALUES(sort_by),
            sort_how = VALUES(sort_how),
            item_count = VALUES(item_count),
            raw_json = VALUES(raw_json),
            updated_at = NOW()}
    );
    $sth->execute(
        $user_id,
        $ids->{trakt},
        $ids->{slug} || '',
        $list->{name} || '',
        $list->{description} || '',
        $list->{privacy} || '',
        $list->{display_numbers} ? 1 : 0,
        $list->{allow_comments} ? 1 : 0,
        $list->{sort_by} || '',
        $list->{sort_how} || '',
        $list->{item_count} || 0,
        encode_json($list)
    );
    return $dbh->last_insert_id(undef, undef, 'trakt_lists', undef);
}

# Inserts or updates a list item with watched status.
# Extracts media type from the row and determines watched state via _is_watched_row.
# Parameters:
#   $dbh     : Database handle
#   $user_id : User ID
#   $list_id : Parent list ID
#   $row     : Trakt API item row
#   $watched : Watched status hashref
sub _upsert_list_item {
    my ($dbh, $user_id, $list_id, $row, $watched) = @_;
    my ($type, $media) = _media_from_row($row);
    return unless $type && $media;

    my $ids = $media->{ids} || {};
    my $episode = $row->{episode} || {};
    my $sth = $dbh->prepare(
        q{INSERT INTO trakt_list_items
          (user_id, list_id, media_type, trakt_id, imdb_id, tmdb_id, title, year, season, episode, watched, raw_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            id = LAST_INSERT_ID(id),
            imdb_id = VALUES(imdb_id),
            tmdb_id = VALUES(tmdb_id),
            title = VALUES(title),
            year = VALUES(year),
            season = VALUES(season),
            episode = VALUES(episode),
            watched = VALUES(watched),
            raw_json = VALUES(raw_json),
            updated_at = NOW()}
    );
    my $watched_flag = _is_watched_row($type, $row, $watched) ? 1 : 0;
    $sth->execute(
        $user_id,
        $list_id,
        $type,
        $ids->{trakt},
        $ids->{imdb},
        $ids->{tmdb},
        $media->{title} || '',
        $media->{year},
        $episode->{season} || 0,
        $episode->{number} || 0,
        $watched_flag,
        encode_json($row)
    );
}

# Inserts or updates a list item submitted from the client.
# Parameters:
#   $dbh     : Database handle
#   $user_id : User ID
#   $list_id : Parent list ID
#   $item    : Client-submitted item hashref
sub _upsert_client_list_item {
    my ($dbh, $user_id, $list_id, $item) = @_;
    return unless ref $item eq 'HASH';
    my $type = $item->{media_type} || $item->{type} || '';
    my $id = $item->{trakt_id} || 0;
    return unless $type =~ /\A(?:movie|show|season|episode)\z/ && $id;

    my $sth = $dbh->prepare(
        q{INSERT INTO trakt_list_items
          (user_id, list_id, media_type, trakt_id, title, year, season, episode, watched, raw_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            title = VALUES(title),
            year = VALUES(year),
            watched = VALUES(watched),
            raw_json = VALUES(raw_json),
            updated_at = NOW()}
    );
    $sth->execute(
        $user_id,
        $list_id,
        $type,
        $id,
        $item->{title} || '',
        $item->{year},
        $item->{season} || 0,
        $item->{episode} || 0,
        $item->{watched} ? 1 : 0,
        encode_json($item)
    );
}

# Inserts or updates a watchlist show record from client data.
# Only processes items with media_type 'show'.
# Parameters:
#   $dbh     : Database handle
#   $user_id : User ID
#   $item    : Client-submitted item hashref
sub _upsert_watchlist_show_from_client {
    my ($dbh, $user_id, $item) = @_;
    return unless ref $item eq 'HASH';
    return unless ($item->{media_type} || $item->{type} || '') eq 'show';
    my $id = $item->{trakt_id} || 0;
    return unless $id;

    my $sth = $dbh->prepare(
        q{INSERT INTO trakt_watchlist_items (user_id, show_trakt_id, show_title, year, raw_json, updated_at)
          VALUES (?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            show_title = VALUES(show_title),
            year = VALUES(year),
            raw_json = VALUES(raw_json),
            updated_at = NOW()}
    );
    $sth->execute($user_id, $id, $item->{title} || '', $item->{year}, encode_json($item));
}

# Recalculates and updates the item_count for a list.
# Parameters:
#   $dbh     : Database handle
#   $user_id : User ID
#   $list_id : List ID to update
sub _refresh_list_item_count {
    my ($dbh, $user_id, $list_id) = @_;
    $dbh->do(
        q{UPDATE trakt_lists
          SET item_count = (
              SELECT COUNT(*) FROM trakt_list_items
              WHERE user_id = ? AND list_id = ?
          ), updated_at = NOW()
          WHERE user_id = ? AND id = ?},
        undef,
        $user_id,
        $list_id,
        $user_id,
        $list_id
    );
}

# Extracts the media type and data hash from a Trakt API row.
# Checks for movie/show/season/episode keys in order.
# Parameters:
#   $row : Trakt API item row
# Returns:
#   (type, media_hashref) or undef
sub _media_from_row {
    my ($row) = @_;
    for my $type (qw(movie show season episode)) {
        return ($type, $row->{$type}) if ref $row->{$type} eq 'HASH';
    }
    return;
}

# Determines whether an item row should be marked watched based on the watched hashref.
# Handles movie, show, and episode types with different lookup strategies.
# Parameters:
#   $type    : Media type (movie|show|episode)
#   $row     : Trakt API item row
#   $watched : Watched status hashref {movies => {}, shows => {}, episodes => {}}
# Returns:
#   1 if watched, 0 otherwise
sub _is_watched_row {
    my ($type, $row, $watched) = @_;
    return 0 unless ref $watched eq 'HASH' && ref $row eq 'HASH';

    if ($type eq 'movie') {
        my $movie_id = (($row->{movie} || {})->{ids} || {})->{trakt};
        return $movie_id && $watched->{movies}{$movie_id} ? 1 : 0;
    }

    if ($type eq 'show') {
        my $show_id = (($row->{show} || {})->{ids} || {})->{trakt};
        return $show_id && $watched->{shows}{$show_id} ? 1 : 0;
    }

    if ($type eq 'episode') {
        my $show_id = (($row->{show} || {})->{ids} || {})->{trakt};
        my $episode = $row->{episode} || {};
        my $season = $episode->{season};
        my $number = $episode->{number};
        return 0 unless $show_id && defined $season && defined $number;
        my $key = join(':', $show_id, $season, $number);
        return $watched->{episodes}{$key} ? 1 : 0;
    }

    return 0;
}

# Converts an ISO 8601 datetime string to MySQL-compatible format (YYYY-MM-DD HH:MM:SS).
# Parameters:
#   $value : ISO 8601 string
# Returns:
#   MySQL datetime string, or undef if input is empty/undef
sub _mysql_datetime {
    my ($value) = @_;
    return undef unless defined $value && length $value;
    $value =~ s/T/ /;
    $value =~ s/Z$//;
    $value =~ s/\.\d+$//;
    return substr($value, 0, 19);
}

1;
