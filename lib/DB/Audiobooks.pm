# /lib/DB/Audiobooks.pm

package DB::Audiobooks;

use strict;
use warnings;

# Database library for per-user audiobook playback progress.
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

1;
