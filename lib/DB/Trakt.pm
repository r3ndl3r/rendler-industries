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
        q{SELECT trakt_connections.*,
                 GREATEST(TIMESTAMPDIFF(SECOND, last_synced_at, NOW()), 0) AS last_synced_age_seconds
          FROM trakt_connections
          WHERE user_id = ?
          LIMIT 1}
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
            watchlist_trakt_list_id = IF(trakt_user_id <=> VALUES(trakt_user_id), watchlist_trakt_list_id, NULL),
            cache_revision = cache_revision + 1,
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

# Stores rotated OAuth tokens only while the original connection is still current.
# Parameters:
#   $self : DB instance
#   $user_id : User ID
#   $expected_refresh_token : Refresh token used for the remote exchange
#   $conn : Hashref of replacement token fields
# Returns:
#   True when the connected row was updated, false if it changed or disconnected
sub DB::update_trakt_refreshed_connection {
    my ($self, $user_id, $expected_refresh_token, $conn) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        q{UPDATE trakt_connections
          SET access_token = ?, refresh_token = ?, token_type = ?, expires_at = ?, scope = ?,
              cache_revision = cache_revision + 1, updated_at = NOW()
          WHERE user_id = ? AND status = 'connected'
            AND BINARY refresh_token = BINARY ?}
    );
    $sth->execute(
        $conn->{access_token},
        $conn->{refresh_token},
        $conn->{token_type} || 'bearer',
        $conn->{expires_at},
        $conn->{scope} || '',
        $user_id,
        $expected_refresh_token,
    );
    return ($sth->rows || 0) > 0 ? 1 : 0;
}

# Stores the authoritative custom Watchlist Trakt ID for a connected user.
# Parameters:
#   $self : DB instance
#   $user_id : User ID
#   $trakt_list_id : Remote Trakt personal-list ID
# Returns:
#   DBI execute result
sub DB::set_trakt_watchlist_list_id {
    my ($self, $user_id, $trakt_list_id) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        q{UPDATE trakt_connections
          SET watchlist_trakt_list_id = ?, updated_at = NOW()
          WHERE user_id = ?}
    );
    return $sth->execute($trakt_list_id, $user_id);
}

# Returns the mutation revision used to reject stale full-sync snapshots.
# Parameters:
#   $self : DB instance
#   $user_id : User ID
# Returns:
#   Integer cache revision, or undef when no connection exists
sub DB::get_trakt_cache_revision {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    my ($revision) = $self->{dbh}->selectrow_array(
        "SELECT cache_revision FROM trakt_connections WHERE user_id = ?",
        undef,
        $user_id,
    );
    return defined $revision ? 0 + $revision : undef;
}

# Advances the mutation revision before a remote operation that triggers a full sync.
# Parameters:
#   $self : DB instance
#   $user_id : User ID
# Returns:
#   DBI execute result; dies if the connection changed or disconnected
sub DB::bump_trakt_cache_revision {
    my ($self, $user_id) = @_;
    $self->ensure_connection;
    return _bump_cache_revision($self->{dbh}, $user_id);
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
          SET access_token = NULL, refresh_token = NULL, expires_at = NULL,
              status = 'disconnected', cache_revision = cache_revision + 1, updated_at = NOW()
          WHERE user_id = ?}
    );
    return $sth->execute($user_id);
}

# Disconnects only the connection that owns a rejected refresh token.
# Parameters:
#   $self : DB instance
#   $user_id : User ID
#   $expected_refresh_token : Refresh token rejected by Trakt
# Returns:
#   True when that exact connected row was disconnected, otherwise false
sub DB::disconnect_trakt_connection_for_refresh_token {
    my ($self, $user_id, $expected_refresh_token) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        q{UPDATE trakt_connections
          SET access_token = NULL, refresh_token = NULL, expires_at = NULL,
              status = 'disconnected', cache_revision = cache_revision + 1, updated_at = NOW()
          WHERE user_id = ? AND status = 'connected'
            AND BINARY refresh_token = BINARY ?}
    );
    $sth->execute($user_id, $expected_refresh_token);
    return ($sth->rows || 0) > 0 ? 1 : 0;
}

# Deletes all cached Trakt data and episode-notification claims for a user.
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
        $dbh->do("DELETE FROM trakt_episode_notifications WHERE user_id = ?", undef, $user_id);
        $dbh->do("DELETE FROM trakt_list_items WHERE user_id = ?", undef, $user_id);
        $dbh->do("DELETE FROM trakt_lists WHERE user_id = ?", undef, $user_id);
        $dbh->do("DELETE FROM trakt_unwatched_cache WHERE user_id = ?", undef, $user_id);
        $dbh->do("DELETE FROM trakt_watchlist_items WHERE user_id = ?", undef, $user_id);
        $dbh->do("DELETE FROM trakt_upcoming WHERE user_id = ?", undef, $user_id);
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
        last_synced_at => $conn->{last_synced_at},
        last_synced_age_seconds => $conn->{last_synced_age_seconds}
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
        q{SELECT l.id, l.trakt_list_id, l.trakt_slug, l.name, l.description, l.privacy,
                 l.display_numbers, l.allow_comments, l.sort_by, l.sort_how, l.item_count,
                 l.collapsed, l.updated_at,
                 CASE WHEN l.trakt_list_id = c.watchlist_trakt_list_id THEN 1 ELSE 0 END AS is_watchlist
          FROM trakt_lists l
          LEFT JOIN trakt_connections c ON c.user_id = l.user_id
          WHERE l.user_id = ?
          ORDER BY CASE WHEN l.trakt_list_id = c.watchlist_trakt_list_id THEN 0 ELSE 1 END, LOWER(l.name)}
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
        q{SELECT u.id, u.show_trakt_id, u.episode_trakt_id, u.title, u.show_title, u.season, u.episode, u.first_aired, u.network, u.raw_json
          FROM trakt_upcoming u
          INNER JOIN trakt_watchlist_items w
                  ON w.user_id = u.user_id AND w.show_trakt_id = u.show_trakt_id
          WHERE u.user_id = ? AND u.first_aired > UTC_TIMESTAMP()
          ORDER BY u.first_aired ASC, u.show_title ASC
          LIMIT 500}
    );
    $sth->execute($user_id);
    return $sth->fetchall_arrayref({});
}

# Replaces only the cached Trakt calendar rows for a user.
# Parameters:
#   $self     : DB instance
#   $user_id  : User ID
#   $upcoming : Arrayref of Trakt calendar rows
# Returns:
#   1 on success, 0 on invalid input
sub DB::replace_trakt_upcoming_cache {
    my ($self, $user_id, $upcoming) = @_;
    $self->ensure_connection;
    return 0 unless ref $upcoming eq 'ARRAY';

    my $dbh = $self->{dbh};
    local $dbh->{AutoCommit} = 0;
    eval {
        my $watchlist_ids = $dbh->selectcol_arrayref(
            "SELECT show_trakt_id FROM trakt_watchlist_items WHERE user_id = ? FOR UPDATE",
            undef,
            $user_id
        );
        my %watchlist_ids = map { (0 + $_) => 1 } @{$watchlist_ids || []};
        my @current = grep {
            ref $_ eq 'HASH'
                && $watchlist_ids{0 + ((($_->{show} || {})->{ids} || {})->{trakt} || 0)}
        } @$upcoming;

        $dbh->do("DELETE FROM trakt_upcoming WHERE user_id = ?", undef, $user_id);
        _insert_upcoming($dbh, $user_id, \@current);
        $dbh->commit;
    };
    if ($@) {
        my $err = $@;
        eval { $dbh->rollback };
        die $err;
    }
    return 1;
}

# Full cache replacement: purges old watchlist/upcoming/data, inserts fresh data from the Trakt API.
# Uses the designated custom Watchlist as the normalized tracking source.
# Parameters:
#   $self : DB instance
#   $user_id : User ID
#   $watchlist_trakt_list_id : Authoritative custom Watchlist Trakt ID
#   $upcoming       : Upcoming episode data, or undef to preserve existing rows
#   $lists          : User list definitions
#   $items_by_list  : Items grouped by list trakt_id
#   $watched        : Watched status hashref
#   $mark_synced    : Whether to advance the full-sync timestamp (defaults true)
#   $expected_revision : Mutation revision captured before remote hydration
sub DB::replace_trakt_cache {
    my ($self, $user_id, $watchlist_trakt_list_id, $upcoming, $lists, $items_by_list, $watched, $mark_synced, $expected_revision) = @_;
    $self->ensure_connection;
    $mark_synced = 1 unless defined $mark_synced;

    my $dbh = $self->{dbh};
    local $dbh->{AutoCommit} = 0;
    eval {
        my $connection = $dbh->selectrow_hashref(
            "SELECT status, cache_revision FROM trakt_connections WHERE user_id = ? FOR UPDATE",
            undef,
            $user_id,
        );
        die "TRAKT_SYNC_DISCONNECTED\n"
            unless $connection && ($connection->{status} || '') eq 'connected';
        die "TRAKT_SYNC_STALE\n"
            unless defined $expected_revision
                && 0 + ($connection->{cache_revision} || 0) == 0 + $expected_revision;

        $dbh->do("DELETE FROM trakt_watchlist_items WHERE user_id = ?", undef, $user_id);
        $dbh->do("DELETE FROM trakt_upcoming WHERE user_id = ?", undef, $user_id)
            if defined $upcoming;

        _insert_watchlist(
            $dbh,
            $user_id,
            ($items_by_list || {})->{$watchlist_trakt_list_id} || []
        );
        _insert_upcoming($dbh, $user_id, $upcoming || [])
            if defined $upcoming;

        my %seen_lists;
        for my $list (@{$lists || []}) {
            my $list_id = _upsert_list($dbh, $user_id, $list);
            $seen_lists{$list_id} = 1;
            $dbh->do("DELETE FROM trakt_list_items WHERE user_id = ? AND list_id = ?", undef, $user_id, $list_id);
            for my $item (@{($items_by_list || {})->{$list->{ids}{trakt}} || []}) {
                _upsert_list_item($dbh, $user_id, $list_id, $item, $watched || {});
            }
            _refresh_list_item_count($dbh, $user_id, $list_id);
        }

        if (%seen_lists) {
            my $placeholders = join(',', ('?') x keys %seen_lists);
            $dbh->do("DELETE FROM trakt_lists WHERE user_id = ? AND id NOT IN ($placeholders)", undef, $user_id, keys %seen_lists);
        } else {
            $dbh->do("DELETE FROM trakt_lists WHERE user_id = ?", undef, $user_id);
        }

        my $sth = $dbh->prepare($mark_synced
            ? "UPDATE trakt_connections SET last_synced_at = NOW(), updated_at = NOW() WHERE user_id = ?"
            : "UPDATE trakt_connections SET updated_at = NOW() WHERE user_id = ?");
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
        q{SELECT l.*,
                 CASE WHEN l.trakt_list_id = c.watchlist_trakt_list_id THEN 1 ELSE 0 END AS is_watchlist
          FROM trakt_lists l
          LEFT JOIN trakt_connections c ON c.user_id = l.user_id
          WHERE l.user_id = ? AND l.id = ?
          LIMIT 1}
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

# Inserts items into a cached list and updates the normalized Watchlist index when applicable.
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
        _bump_cache_revision($dbh, $user_id);
        for my $item (@$items) {
            _upsert_client_list_item($dbh, $user_id, $list->{id}, $item);
            _upsert_watchlist_show_from_client($dbh, $user_id, $item)
                if $list->{is_watchlist};
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

# Removes items from a cached list, cleaning up Watchlist-derived data when applicable.
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
        _bump_cache_revision($dbh, $user_id);
        my $delete_sth = $dbh->prepare(
            q{DELETE FROM trakt_list_items
              WHERE user_id = ? AND list_id = ? AND media_type = ? AND trakt_id = ? AND season = ? AND episode = ?}
        );
        my $is_watchlist = $list->{is_watchlist} ? 1 : 0;
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

    my $dbh = $self->{dbh};
    local $dbh->{AutoCommit} = 0;
    eval {
        _bump_cache_revision($dbh, $user_id);
        my $sth = $dbh->prepare(
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
        $dbh->commit;
    };
    if ($@) {
        my $err = $@;
        eval { $dbh->rollback };
        die $err;
    }
    return 1;
}

# Retrieves cached unwatched data for a user, if the cache is still fresh relative to last sync.
# Parameters:
#   $self  : DB instance
#   $user_id : User ID
#   $allow_stale : Return cached data even when older than the last full sync
# Returns:
#   Cached data string, or undef if stale/missing
sub DB::get_trakt_unwatched_cache {
    my ($self, $user_id, $allow_stale) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        q{SELECT c.data, c.updated_at, COALESCE(t.last_synced_at, '2000-01-01') AS last_synced_at
          FROM trakt_unwatched_cache c
          LEFT JOIN trakt_connections t ON t.user_id = c.user_id
          WHERE c.user_id = ?}
    );
    $sth->execute($user_id);
    my $row = $sth->fetchrow_hashref;
    return undef unless $row && $row->{data};
    return undef unless $allow_stale || $row->{updated_at} ge $row->{last_synced_at};

    return $row->{data};
}

# Stores or updates the unwatched cache for a connected user.
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
          SELECT ?, ?, NOW()
          FROM trakt_connections
          WHERE user_id = ? AND status = 'connected'
          ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = NOW()}
    );
    $sth->execute($user_id, $encoded, $user_id);
}

# Replaces an unwatched cache generation only if no newer invalidation has occurred.
# Parameters:
#   $self         : DB instance
#   $user_id      : User ID
#   $expected_raw : Exact current cache JSON, or undef when no row should exist
#   $data         : Replacement arrayref or raw JSON string
# Returns:
#   True when the replacement was stored, false when the cache generation changed
sub DB::compare_and_set_trakt_unwatched_cache {
    my ($self, $user_id, $expected_raw, $data) = @_;
    $self->ensure_connection;

    my $encoded = ref $data eq 'ARRAY' ? encode_json($data) : $data;
    my $sth;
    if (defined $expected_raw) {
        $sth = $self->{dbh}->prepare(
            q{UPDATE trakt_unwatched_cache
              SET data = ?, updated_at = NOW()
              WHERE user_id = ? AND data = ?
                AND EXISTS (
                    SELECT 1 FROM trakt_connections
                    WHERE user_id = ? AND status = 'connected'
                )}
        );
        $sth->execute($encoded, $user_id, $expected_raw, $user_id);
    } else {
        $sth = $self->{dbh}->prepare(
            q{INSERT IGNORE INTO trakt_unwatched_cache (user_id, data, updated_at)
              SELECT ?, ?, NOW()
              FROM trakt_connections
              WHERE user_id = ? AND status = 'connected'}
        );
        $sth->execute($user_id, $encoded, $user_id);
    }

    return ($sth->rows || 0) > 0 ? 1 : 0;
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

# Advances a user's cache revision on an existing database handle.
# Parameters:
#   $dbh : Database handle
#   $user_id : User ID
# Returns:
#   DBI execute result; dies if the connection changed or disconnected
sub _bump_cache_revision {
    my ($dbh, $user_id) = @_;
    my $updated = $dbh->do(
        q{UPDATE trakt_connections
          SET cache_revision = cache_revision + 1, updated_at = NOW()
          WHERE user_id = ? AND status = 'connected'},
        undef,
        $user_id,
    );
    die "TRAKT_CONNECTION_CHANGED\n" unless $updated && $updated > 0;
    return $updated;
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
