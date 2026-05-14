# /lib/DB/Audiobooks.pm

package DB::Audiobooks;

use strict;
use warnings;
use Mojo::JSON qw(encode_json decode_json);

# Database library for audiobook metadata and per-user playback progress.
#
# Features:
#   - Stores and retrieves per-user position (chapter index + offset in seconds).
#   - Upsert pattern (INSERT ... ON DUPLICATE KEY UPDATE) for atomic progress saves.
#   - Completed flag tracks books the user has finished.
#
# Integration Points:
#   - Extends the core DB package via package injection.
#   - Used exclusively by MyApp::Controller::Audiobooks.
#   - Privacy: all queries are scoped to a single user_id.

# Returns all progress records for a user as a hash keyed by book_slug.
# Parameters:
#   user_id : Integer ID of the current user.
# Returns:
#   HashRef: { book_slug => { chapter_idx, position_sec, completed, updated_at }, ... }
#   Returns an empty hashref when no records exist.
sub DB::get_audiobook_progress_all {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "SELECT book_slug, chapter_idx, position_sec, completed,
                DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
         FROM audiobook_progress
         WHERE user_id = ?"
    );
    $sth->execute($user_id);

    my %map;
    while (my $row = $sth->fetchrow_hashref) {
        $map{ $row->{book_slug} } = {
            chapter_idx  => $row->{chapter_idx}  + 0,
            position_sec => $row->{position_sec} + 0,
            completed    => $row->{completed}    + 0,
            updated_at   => $row->{updated_at}   // '',
        };
    }
    return \%map;
}

# Returns the progress record for a single book.
# Parameters:
#   user_id   : Integer ID of the current user.
#   book_slug : String identifier for the book directory.
# Returns:
#   HashRef with keys { chapter_idx, position_sec, completed, updated_at },
#   or undef if no record exists.
sub DB::get_audiobook_book_progress {
    my ($self, $user_id, $book_slug) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "SELECT chapter_idx, position_sec, completed,
                DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
         FROM audiobook_progress
         WHERE user_id = ? AND book_slug = ?"
    );
    $sth->execute($user_id, $book_slug);
    my $row = $sth->fetchrow_hashref;
    return undef unless $row;

    return {
        chapter_idx  => $row->{chapter_idx}  + 0,
        position_sec => $row->{position_sec} + 0,
        completed    => $row->{completed}    + 0,
        updated_at   => $row->{updated_at}   // '',
    };
}

# Atomically creates or updates a user's progress for a book.
# Parameters:
#   user_id     : Integer ID of the current user.
#   book_slug   : String identifier for the book directory.
#   chapter_idx : Zero-based chapter index (SMALLINT).
#   position_sec: Playback offset in seconds (FLOAT).
#   completed   : 1 if the book is finished, 0 otherwise.
# Returns:
#   1 on success; propagates DBI exception on failure.
sub DB::upsert_audiobook_progress {
    my ($self, $user_id, $book_slug, $chapter_idx, $position_sec, $completed) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "INSERT INTO audiobook_progress
             (user_id, book_slug, chapter_idx, position_sec, completed)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
             chapter_idx  = VALUES(chapter_idx),
             position_sec = VALUES(position_sec),
             completed    = VALUES(completed)"
    );
    $sth->execute($user_id, $book_slug, $chapter_idx, $position_sec, $completed);
    return 1;
}

# Deletes a user's saved progress for a book.
# Parameters:
#   user_id   : Integer ID of the current user.
#   book_slug : String identifier for the book directory.
# Returns:
#   Number of rows deleted (0 or 1).
sub DB::delete_audiobook_progress {
    my ($self, $user_id, $book_slug) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "DELETE FROM audiobook_progress WHERE user_id = ? AND book_slug = ?"
    );
    $sth->execute($user_id, $book_slug);
    return $sth->rows;
}

# Returns all progress records for every family member, grouped by book slug.
# Used by the admin panel to display per-user reading status across the library.
# Parameters: none
# Returns:
#   HashRef: { book_slug => [ { user_id, username, chapter_idx, position_sec, completed }, ... ] }
#   Users with no progress records for a given slug are absent from that slug's array.
sub DB::get_all_users_audiobook_progress {
    my ($self) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "SELECT p.book_slug, p.user_id, u.username,
                p.chapter_idx, p.position_sec, p.completed
         FROM audiobook_progress p
         JOIN users u ON u.id = p.user_id
         WHERE u.is_family = 1
         ORDER BY p.book_slug, u.username"
    );
    $sth->execute();

    my %map;
    while (my $row = $sth->fetchrow_hashref) {
        push @{ $map{ $row->{book_slug} } }, {
            user_id      => $row->{user_id}      + 0,
            username     => $row->{username}     // '',
            chapter_idx  => $row->{chapter_idx}  + 0,
            position_sec => $row->{position_sec} + 0,
            completed    => $row->{completed}    + 0,
        };
    }
    return \%map;
}

# Returns all book metadata records as a hash keyed by slug.
# Used by api_state and api_admin_state to pre-fetch all known books in one query,
# avoiding per-book queries during the async promise fan-out.
# Parameters: none
# Returns:
#   HashRef: { slug => { title, author, narrator, description, series, series_index,
#                        cover, chapters, date_added }, ... }
sub DB::get_all_audiobooks {
    my ($self) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "SELECT slug, title, author, narrator, description, series,
                series_index, cover, chapters, date_added
         FROM audiobooks"
    );
    $sth->execute();

    my %map;
    while (my $row = $sth->fetchrow_hashref) {
        my $chapters = eval { decode_json($row->{chapters}) } // [];
        $map{ $row->{slug} } = {
            title        => $row->{title}         // '',
            author       => $row->{author}        // '',
            narrator     => $row->{narrator}      // '',
            description  => $row->{description}   // '',
            series       => $row->{series}        // '',
            series_index => ($row->{series_index} // 0) + 0,
            cover        => $row->{cover}         // '',
            chapters     => $chapters,
            date_added   => ($row->{date_added}   // 0) + 0,
        };
    }
    return \%map;
}

# Returns the metadata record for a single book by slug.
# Parameters:
#   slug : Book directory slug.
# Returns:
#   HashRef with keys { title, author, narrator, description, series, series_index,
#                       cover, chapters, date_added }, or undef if no record exists.
sub DB::get_audiobook_meta {
    my ($self, $slug) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare(
        "SELECT title, author, narrator, description, series,
                series_index, cover, chapters, date_added
         FROM audiobooks WHERE slug = ?"
    );
    $sth->execute($slug);
    my $row = $sth->fetchrow_hashref;
    return undef unless $row;

    my $chapters = eval { decode_json($row->{chapters}) } // [];
    return {
        title        => $row->{title}         // '',
        author       => $row->{author}        // '',
        narrator     => $row->{narrator}      // '',
        description  => $row->{description}   // '',
        series       => $row->{series}        // '',
        series_index => ($row->{series_index} // 0) + 0,
        cover        => $row->{cover}         // '',
        chapters     => $chapters,
        date_added   => ($row->{date_added}   // 0) + 0,
    };
}

# Atomically creates or updates the metadata record for a book.
# Parameters:
#   slug : Book directory slug (unique key).
#   meta : HashRef with keys title, author, narrator, description, series,
#          series_index, cover, chapters (ArrayRef), date_added.
# Returns:
#   1 on success; propagates DBI exception on failure.
sub DB::upsert_audiobook_meta {
    my ($self, $slug, $meta) = @_;
    $self->ensure_connection;

    my $chapters_json = encode_json(
        (ref $meta->{chapters} eq 'ARRAY') ? $meta->{chapters} : []
    );

    my $sth = $self->{dbh}->prepare(
        "INSERT INTO audiobooks
             (slug, title, author, narrator, description, series, series_index,
              cover, chapters, date_added)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
             title        = VALUES(title),
             author       = VALUES(author),
             narrator     = VALUES(narrator),
             description  = VALUES(description),
             series       = VALUES(series),
             series_index = VALUES(series_index),
             cover        = VALUES(cover),
             chapters     = VALUES(chapters),
             date_added   = VALUES(date_added)"
    );
    $sth->execute(
        $slug,
        $meta->{title}        // '',
        $meta->{author}       // '',
        $meta->{narrator}     // '',
        $meta->{description}  // '',
        $meta->{series}       // '',
        ($meta->{series_index} // 0) + 0,
        $meta->{cover}        // '',
        $chapters_json,
        ($meta->{date_added}  // 0) + 0,
    );
    return 1;
}

# Deletes the metadata record for a single book by slug.
# Called by api_admin_rescan to force re-discovery on next state fetch.
# Parameters:
#   slug : Book directory slug.
# Returns:
#   Number of rows deleted (0 or 1).
sub DB::delete_audiobook_meta {
    my ($self, $slug) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("DELETE FROM audiobooks WHERE slug = ?");
    $sth->execute($slug);
    return $sth->rows;
}

# Deletes all metadata records, forcing re-discovery for every book.
# Called by api_admin_rescan when no slug is supplied.
# Returns:
#   Number of rows deleted.
sub DB::delete_all_audiobook_meta {
    my ($self) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("DELETE FROM audiobooks");
    $sth->execute();
    return $sth->rows;
}

1;
