# /lib/MyApp/Controller/Audiobooks.pm

package MyApp::Controller::Audiobooks;

use Mojo::Base 'Mojolicious::Controller';
use Mojo::File    qw(path);
use Mojo::JSON    qw(decode_json encode_json);
use Mojo::Util    qw(trim url_escape);
use Mojo::IOLoop;
use Mojo::Promise;
use Encode        qw(decode_utf8);
use strict;
use warnings;
use utf8;

# Controller for the Audiobooks player module.
#
# Features:
#   - Filesystem-driven book discovery from assets/audiobooks/<slug>/.
#   - Per-user playback progress (chapter index + position) stored in MariaDB.
#   - Range-aware audio streaming via Mojolicious reply->file (HTTP 206).
#   - Admin-editable book metadata persisted in the audiobooks DB table.
#   - Chapter extraction: CUE sheet, embedded MP4 atoms (via ffprobe), or filename scan.
#   - ffprobe is called once per new book via Mojo::IOLoop->subprocess; result is
#     cached to DB so subsequent loads are instant.
#
# Integration Points:
#   - Restricted to family members via $family router bridge.
#   - Metadata write endpoints restricted to $admin bridge.
#   - Depends on DB::Audiobooks for progress persistence.

my @AUDIO_EXTS         = qw(mp3 m4a m4b ogg flac wav);
my @EMBEDDED_CH_EXTS   = qw(m4b m4a);   # formats that commonly carry embedded chapter atoms

# Validates that a path component contains only safe characters.
# Rejects any value containing path traversal sequences or characters outside
# the explicit allowlist.
# Parameters:
#   value : The string to validate.
# Returns:
#   1 if safe, 0 otherwise.
sub _safe_component {
    my ($value) = @_;
    return 0 unless defined $value && length $value;
    return 0 if $value =~ /\.\./;
    return 0 if $value =~ m{[/\\\x00]};
    return 1;
}

# Infers series name and index from a book directory slug following the common
# "Author - Series - N - Title" naming convention.
# Returns an empty string and 0 when the pattern is not matched.
# Parameters:
#   slug : Book directory name string.
# Returns:
#   (series_name, series_index) — e.g. ('Harry Potter', 3)
sub _parse_slug_series {
    my ($slug) = @_;
    my @parts = split / - /, $slug;
    return ('', 0) unless @parts >= 4 && $parts[2] =~ /^\d+$/;
    return ($parts[1], $parts[2] + 0);
}

# Resolves the book root directory for the application.
# Parameters:
#   c : Mojolicious controller instance.
# Returns:
#   Mojo::File pointing to assets/audiobooks/.
sub _books_root {
    my ($c) = @_;
    return $c->app->home->child('assets', 'audiobooks');
}

# Resolves the local cover image directory (not SMB-mounted).
# Covers are stored as <slug>.jpg or <slug>.png, separate from audio files.
# Parameters:
#   c : Mojolicious controller instance.
# Returns:
#   Mojo::File pointing to assets/audiobooks_covers/.
sub _covers_root {
    my ($c) = @_;
    return $c->app->home->child('assets', 'audiobooks_covers');
}


# Constructs the book hashref pushed into the state response.
# Parameters:
#   slug : Book directory slug.
#   meta : HashRef with title, author, narrator, description, cover, chapters.
#   prog : HashRef with chapter_idx, position_sec, completed (may be undef).
# Returns:
#   HashRef ready for JSON serialisation.
sub _format_book_entry {
    my ($slug, $meta, $prog) = @_;
    $prog //= { chapter_idx => 0, position_sec => 0, completed => 0 };

    my $chapters = (ref $meta->{chapters} eq 'ARRAY') ? $meta->{chapters} : [];
    return undef unless @$chapters;

    my $str = sub { my $v = shift; (defined $v && !ref $v) ? $v : '' };
    return {
        slug           => $slug,
        title          => ($str->($meta->{title})       || $slug),
        author         => ($str->($meta->{author})      // ''),
        narrator       => ($str->($meta->{narrator})    // ''),
        description    => ($str->($meta->{description}) // ''),
        series         => ($str->($meta->{series})      // ''),
        series_index   => ($meta->{series_index}              // 0) + 0,
        cover_url      => ($meta->{cover} ? '/audiobooks/api/cover/' . Mojo::Util::url_escape($slug) : ''),
        chapters       => $chapters,
        total_chapters => scalar @$chapters,
        progress       => $prog,
        date_added     => ($meta->{date_added} // 0) + 0,
    };
}

# Generates metadata for a book from disk sources (CUE sheet or directory scan).
# Used by api_save_meta as a fallback when no DB record exists for the book.
# Parameters:
#   dir  : Mojo::File pointing to the book directory.
#   slug : String slug.
# Returns:
#   HashRef: { title, author, narrator, description, cover, chapters => [...] }
sub _read_or_generate_meta {
    my ($dir, $slug, $covers_root) = @_;

    my $cue_meta = _parse_cue_file($dir);
    if ($cue_meta) {
        my @ch = @{ $cue_meta->{chapters} };
        my $t  = $cue_meta->{title} || do { (my $s = $slug) =~ s/[-_]/ /g; $s =~ s/\b(\w)/uc($1)/ge; $s };
        return {
            title       => $t,
            author      => ($cue_meta->{author} // ''),
            narrator    => '',
            description => '',
            cover       => _find_cover($covers_root, $slug),
            chapters    => \@ch,
        };
    }

    my @chapters = _scan_chapters($dir);
    my $title = $slug;
    $title =~ s/[-_]/ /g;
    $title =~ s/\b(\w)/uc($1)/ge;

    return {
        title       => $title,
        author      => '',
        narrator    => '',
        description => '',
        cover       => _find_cover($covers_root, $slug),
        chapters    => \@chapters,
    };
}

# Returns the cover image filename ('cover.jpg', 'cover.png') if found in the local
# covers directory, or empty string. Checks by slug name, not inside the book dir.
# Parameters:
#   covers_root : Mojo::File pointing to assets/audiobooks_covers/.
#   slug        : Book directory slug.
# Returns:
#   String filename or ''.
sub _find_cover {
    my ($covers_root, $slug) = @_;
    return 'cover.jpg' if -f $covers_root->child("$slug.jpg");
    return 'cover.png' if -f $covers_root->child("$slug.png");
    return '';
}

# Scans the book directory for any jpg/png image file and moves the first one found
# to assets/audiobooks_covers/<slug>.jpg. Uses Mojo::File->move_to to handle
# cross-filesystem moves (SMB → local disk) transparently.
# Parameters:
#   covers_root : Mojo::File pointing to assets/audiobooks_covers/.
#   slug        : Book directory slug (used as the destination filename).
#   dir         : Mojo::File pointing to the SMB book directory.
# Returns:
#   'cover.jpg' on success, '' if no image found or move failed.
sub _claim_cover_from_dir {
    my ($covers_root, $slug, $dir) = @_;
    my $found;
    if (opendir(my $dh, $dir)) {
        ($found) = sort grep { /\.(jpe?g|png)$/i && -f $dir->child($_) }
                        map  { decode_utf8($_, Encode::FB_DEFAULT) } readdir($dh);
        closedir($dh);
    }
    return '' unless $found;

    my $dest = $covers_root->child("$slug.jpg");
    eval { $dir->child($found)->move_to($dest) };
    return $@ ? '' : 'cover.jpg';
}

# Returns the path to the first M4B/M4A file in the directory, or undef.
# Used to detect candidates for embedded-chapter extraction via ffprobe.
# Parameters:
#   dir : Mojo::File pointing to the book directory.
# Returns:
#   String absolute path or undef.
sub _find_embedded_chapter_candidate {
    my ($dir) = @_;
    my $ext_re = join '|', @EMBEDDED_CH_EXTS;
    if (opendir(my $dh, $dir)) {
        my ($name) = sort grep { /\.(?:$ext_re)$/i && -f $dir->child($_) }
                          map  { decode_utf8($_, Encode::FB_DEFAULT) } readdir($dh);
        closedir($dh);
        return $dir->child($name)->to_string if $name;
    }
    return undef;
}

# Parses a CUE sheet in the book directory and extracts track/chapter metadata.
# CUE timestamps are in MM:SS:FF (frames at 75fps); converted to fractional seconds.
# Parameters:
#   dir : Mojo::File pointing to the book directory.
# Returns:
#   HashRef { title, author, chapters => [...] } or undef if no .cue file exists.
sub _parse_cue_file {
    my ($dir) = @_;

    my $cue_path;
    if (opendir(my $dh, $dir)) {
        my ($name) = grep { /\.cue$/i }
                     map  { decode_utf8($_, Encode::FB_DEFAULT) } readdir($dh);
        closedir($dh);
        return undef unless $name;
        $cue_path = $dir->child($name);
    }
    return undef unless $cue_path && -f $cue_path;

    my $text = eval { $cue_path->slurp('UTF-8') };
    return undef unless $text;

    $text =~ s/\r\n/\n/g;
    $text =~ s/\r/\n/g;

    my ($album_title, $album_artist, $audio_file);
    my @chapters;
    my ($track_title, $track_start_sec);

    for my $line (split /\n/, $text) {
        $line =~ s/^\s+|\s+$//g;

        if (!$audio_file && $line =~ /^FILE\s+"?([^"]+)"?\s+/i) {
            $audio_file = $1;
            next;
        }
        if ($line =~ /^TITLE\s+"?(.+?)"?\s*$/i) {
            my $val = $1;
            if (!@chapters && !defined $track_title) { $album_title = $val }
            else                                      { $track_title = $val }
            next;
        }
        if ($line =~ /^PERFORMER\s+"?(.+?)"?\s*$/i) {
            $album_artist //= $1;
            next;
        }
        if ($line =~ /^TRACK\s+\d+\s+AUDIO/i) {
            if (defined $track_start_sec && defined $track_title) {
                push @chapters, { file => ($audio_file // ''), title => $track_title,
                                  duration => 0, start => $track_start_sec };
            }
            $track_title = undef;
            next;
        }
        if ($line =~ /^INDEX\s+01\s+(\d+):(\d+):(\d+)/i) {
            $track_start_sec = ($1 + 0) * 60 + ($2 + 0) + ($3 + 0) / 75;
            next;
        }
    }

    if (defined $track_start_sec && defined $track_title) {
        push @chapters, { file => ($audio_file // ''), title => $track_title,
                          duration => 0, start => $track_start_sec };
    }

    return undef unless @chapters;
    return { title => ($album_title // ''), author => ($album_artist // ''), chapters => \@chapters };
}

# Scans a book directory for audio files and returns a sorted chapter list.
# Parameters:
#   dir : Mojo::File pointing to the book directory.
# Returns:
#   Array of HashRefs: { file, title, duration }
sub _scan_chapters {
    my ($dir) = @_;

    my $ext_re = join '|', @AUDIO_EXTS;
    my @files;

    if (opendir(my $dh, $dir)) {
        @files = sort grep { /\.(?:$ext_re)$/i && -f $dir->child($_) }
                      map  { decode_utf8($_, Encode::FB_DEFAULT) } readdir($dh);
        closedir($dh);
    }

    return map {
        my $fname = $_;
        my $title = $fname;
        $title =~ s/\.[^.]+$//;
        $title =~ s/^\d+[-_.\s]+//;
        { file => $fname, title => $title, duration => 0 }
    } @files;
}


# Async counterpart to _scan_chapters that populates real durations via ffprobe.
# All files are probed inside a single Mojo::IOLoop->subprocess so the event loop
# is never blocked regardless of how many files the book contains.
# The absence of a 'start' key in each chapter keeps the player in multi-file mode.
# Parameters:
#   dir : Mojo::File pointing to the book directory.
# Returns:
#   Mojo::Promise resolving to ArrayRef of { file, title, duration }.
sub _scan_chapters_async {
    my ($dir) = @_;

    my $ext_re = join '|', @AUDIO_EXTS;
    my @files;
    if (opendir(my $dh, $dir)) {
        @files = sort grep { /\.(?:$ext_re)$/i && -f $dir->child($_) }
                      map  { decode_utf8($_, Encode::FB_DEFAULT) } readdir($dh);
        closedir($dh);
    }

    return Mojo::Promise->resolve([]) unless @files;

    my @paths   = map { $dir->child($_)->to_string } @files;
    my $promise = Mojo::Promise->new;

    Mojo::IOLoop->subprocess->run(
        sub {
            my @durations;
            for my $path (@paths) {
                my $out = '';
                open(my $fh, '-|', 'ffprobe', '-v', 'quiet', '-print_format', 'json',
                     '-show_format', $path) or do { push @durations, 0; next };
                $out .= $_ while <$fh>;
                close($fh);
                my $data = eval { decode_json($out) } // {};
                push @durations, ($data->{format}{duration} // 0) + 0;
            }
            return encode_json(\@durations);
        },
        sub {
            my (undef, $err, $json) = @_;
            my $durations = (!$err && $json) ? (eval { decode_json($json) } // []) : [];

            my @chapters;
            for my $i (0 .. $#files) {
                my $fname = $files[$i];
                (my $title = $fname) =~ s/\.[^.]+$//;
                $title =~ s/^\d+[-_.\s]+//;
                push @chapters, {
                    file     => $fname,
                    title    => $title,
                    duration => ($durations->[$i] // 0) + 0,
                };
            }
            $promise->resolve(\@chapters);
        }
    );

    return $promise;
}

# Runs ffprobe on a file via Mojo::IOLoop->subprocess and resolves a Promise
# with an ArrayRef of chapter HashRefs in the same format as CUE chapters.
# Returns an immediately-resolved empty result if ffprobe fails.
# Parameters:
#   filepath   : Absolute path string to the audio file.
#   audio_file : Basename of the audio file (stored in each chapter's 'file' key).
# Returns:
#   Mojo::Promise resolving to HashRef:
#     chapters => ArrayRef of { file, title, duration, start }
#     title    => String from embedded title/album tag, or ''
#     author   => String from embedded artist/album_artist tag, or ''
sub _run_ffprobe {
    my ($filepath, $audio_file) = @_;

    my $promise = Mojo::Promise->new;

    Mojo::IOLoop->subprocess->run(
        sub {
            # Child: exec ffprobe without a shell to avoid injection risk.
            my $out = '';
            open(my $fh, '-|', 'ffprobe', '-v', 'quiet', '-print_format', 'json',
                 '-show_chapters', '-show_format', $filepath) or return '';
            $out .= $_ while <$fh>;
            close($fh);
            return $out;
        },
        sub {
            my (undef, $err, $json) = @_;
            my $empty = { chapters => [], title => '', author => '', narrator => '', series => '', series_index => 0, duration => 0 };
            if ($err || !$json) {
                $promise->resolve($empty);
                return;
            }
            my $data = eval { decode_json($json) };
            if (!$data) {
                $promise->resolve($empty);
                return;
            }

            my @chapters;
            if (ref $data->{chapters} eq 'ARRAY' && @{ $data->{chapters} }) {
                @chapters = map {
                    my $ch = $_;
                    {
                        file     => $audio_file,
                        title    => ($ch->{tags}{title} // 'Chapter ' . ($ch->{id} + 1)),
                        duration => (($ch->{end_time}   // 0) - ($ch->{start_time} // 0)),
                        start    => ($ch->{start_time}  // 0) + 0,
                    }
                } @{ $data->{chapters} };
            }

            my $tags         = (ref $data->{format}{tags} eq 'HASH') ? $data->{format}{tags} : {};
            my $title        = $tags->{title}    || $tags->{album}        || '';
            my $author       = $tags->{artist}   || $tags->{album_artist} || '';
            my $narrator     = $tags->{composer} || $tags->{narrator}     || '';
            my $series       = $tags->{grouping} || $tags->{GROUPING}     || '';
            my $series_index = 0;
            if ($series =~ m{^(.+?)/(\d+)$}) {
                ($series, $series_index) = ($1, $2 + 0);
            }

            $promise->resolve({
                chapters     => \@chapters,
                title        => $title,
                author       => $author,
                narrator     => $narrator,
                series       => $series,
                series_index => $series_index,
                duration     => ($data->{format}{duration} // 0) + 0,
            });
        }
    );

    return $promise;
}

# Attempts to extract embedded cover art from an M4B/M4A file via ffmpeg.
# Writes to the local covers directory (not the SMB book directory).
# Only called when no cover exists in the covers directory for this slug.
# Parameters:
#   covers_root : Mojo::File pointing to assets/audiobooks_covers/.
#   slug        : Book directory slug (used as the output filename).
#   dir         : Mojo::File pointing to the SMB book directory (audio source only).
# Returns:
#   Mojo::Promise resolving to 'cover.jpg' on success, '' on failure.
sub _maybe_extract_cover {
    my ($covers_root, $slug, $dir) = @_;
    my $audio_path = _find_embedded_chapter_candidate($dir);
    return Mojo::Promise->resolve('') unless $audio_path;

    my $cover_dest = $covers_root->child("$slug.jpg")->to_string;
    my $promise    = Mojo::Promise->new;

    Mojo::IOLoop->subprocess->run(
        sub {
            system('ffmpeg', '-y', '-loglevel', 'quiet', '-i', $audio_path,
                   '-an', '-vframes', '1', $cover_dest);
            return (-f $cover_dest && -s $cover_dest > 500) ? 1 : 0;
        },
        sub {
            my (undef, $err, $result) = @_;
            if ($err || !$result) {
                unlink $cover_dest if -f $cover_dest;
                return $promise->resolve('');
            }
            $promise->resolve('cover.jpg');
        }
    );

    return $promise;
}

# Builds a book entry for api_state, running ffprobe asynchronously when needed.
# Resolution order:
#   1. Any DB record exists → immediate resolve; ffprobe never runs again.
#   2. CUE file found       → parse sync, cache to DB, cover extraction if needed.
#   3. Single M4B/M4A      → ffprobe subprocess, cache to DB, cover extraction if needed.
#   4. Multi-file audio     → async directory scan with ffprobe durations, cache to DB.
#   5. Fallback             → async directory scan with ffprobe durations, cache to DB.
#
# After building meta via any path, if no cover is set, _maybe_extract_cover runs
# once to pull embedded art from the audio file; the cover filename is persisted to DB.
#
# Parameters:
#   slug : Book directory slug.
#   dir  : Mojo::File pointing to the book directory.
#   prog : Progress HashRef for the current user (may be undef).
# Returns:
#   Mojo::Promise resolving to a book-entry HashRef.
sub _build_book_entry_async {
    my ($slug, $dir, $prog, $db, $existing_meta, $covers_root) = @_;

    my $meta_promise;

    # Fast path: any DB record means the book has already been probed.
    # Trust stored metadata completely and never re-run ffprobe or any filesystem scan.
    if (ref $existing_meta eq 'HASH') {
        my $meta    = $existing_meta;
        my $changed = 0;

        if (!$meta->{series}) {
            my ($series, $idx) = _parse_slug_series($slug);
            if ($series) {
                $meta->{series}       = $series;
                $meta->{series_index} = $idx;
                $changed = 1;
            }
        }

        $db->upsert_audiobook_meta($slug, $meta) if $changed;
        $meta_promise = Mojo::Promise->resolve($meta);
    }

    # CUE sheet present: synchronous parse, then cache to DB.
    unless ($meta_promise) {
        my $cue_meta = _parse_cue_file($dir);
        if ($cue_meta && @{ $cue_meta->{chapters} }) {
            my $t = $cue_meta->{title} || do {
                (my $s = $slug) =~ s/[-_]/ /g; $s =~ s/\b(\w)/uc($1)/ge; $s
            };
            my ($slug_series, $slug_idx) = _parse_slug_series($slug);
            my $meta = {
                title        => $t,
                author       => ($cue_meta->{author} // ''),
                narrator     => '',
                description  => '',
                series       => $slug_series,
                series_index => $slug_idx,
                cover        => _find_cover($covers_root, $slug),
                chapters     => $cue_meta->{chapters},
                date_added   => time(),
            };
            $db->upsert_audiobook_meta($slug, $meta);
            $meta_promise = Mojo::Promise->resolve($meta);
        }
    }

    # M4B/M4A present: behaviour differs by file count.
    #   Multi-file: each audio file is one chapter — skip ffprobe and scan the directory.
    #   Single-file: run ffprobe for embedded chapter atoms.  When none exist, synthesize
    #     a single chapter spanning the whole file so the player is always functional.
    unless ($meta_promise) {
        my $audio_path = _find_embedded_chapter_candidate($dir);
        if ($audio_path) {
            my $audio_file = path($audio_path)->basename;
            my $title = $slug;
            $title =~ s/[-_]/ /g;
            $title =~ s/\b(\w)/uc($1)/ge;

            my $ext_re     = join '|', @AUDIO_EXTS;
            my $audio_count = 0;
            if (opendir(my $dh, $dir)) {
                $audio_count = scalar grep { /\.(?:$ext_re)$/i && -f $dir->child($_) }
                                       map { decode_utf8($_, Encode::FB_DEFAULT) } readdir($dh);
                closedir($dh);
            }

            if ($audio_count > 1) {
                $meta_promise = _scan_chapters_async($dir)->then(sub {
                    my $chapters          = shift;
                    my ($slug_s, $slug_i) = _parse_slug_series($slug);
                    my $meta = {
                        title        => $title,
                        author       => '',
                        narrator     => '',
                        description  => '',
                        series       => $slug_s,
                        series_index => $slug_i,
                        cover        => _find_cover($covers_root, $slug),
                        chapters     => $chapters,
                        date_added   => time(),
                    };
                    $db->upsert_audiobook_meta($slug, $meta) if @$chapters;
                    return $meta;
                });
            } else {
                $meta_promise = _run_ffprobe($audio_path, $audio_file)->then(sub {
                    my $result            = shift;
                    my $chapters          = $result->{chapters};
                    my ($slug_s, $slug_i) = _parse_slug_series($slug);

                    # No embedded chapter atoms: the whole file is one chapter.
                    # Using the format duration lets the player show accurate progress.
                    unless (@$chapters) {
                        $chapters = [{
                            file     => $audio_file,
                            title    => ($result->{title} || $title),
                            start    => 0,
                            duration => $result->{duration} + 0,
                        }];
                    }

                    my $meta = {
                        title        => ($result->{title}        || $title),
                        author       => ($result->{author}       || ''),
                        narrator     => ($result->{narrator}     || ''),
                        description  => '',
                        series       => ($result->{series}       || $slug_s),
                        series_index => ($result->{series_index} || $slug_i),
                        cover        => _find_cover($covers_root, $slug),
                        chapters     => $chapters,
                        date_added   => time(),
                    };
                    $db->upsert_audiobook_meta($slug, $meta);
                    return $meta;
                });
            }
        }
    }

    # Fallback: scan directory audio files with real durations via ffprobe, then cache to DB.
    unless ($meta_promise) {
        my $title = $slug;
        $title =~ s/[-_]/ /g;
        $title =~ s/\b(\w)/uc($1)/ge;
        my ($slug_s, $slug_i) = _parse_slug_series($slug);

        $meta_promise = _scan_chapters_async($dir)->then(sub {
            my $chapters = shift;
            my $meta = {
                title        => $title,
                author       => '',
                narrator     => '',
                description  => '',
                series       => $slug_s,
                series_index => $slug_i,
                cover        => _find_cover($covers_root, $slug),
                chapters     => $chapters,
                date_added   => time(),
            };
            $db->upsert_audiobook_meta($slug, $meta) if @$chapters;
            return $meta;
        });
    }

    # Common tail: if no cover is set, attempt embedded art extraction once.
    # On success the cover filename is persisted to DB.
    return $meta_promise->then(sub {
        my $meta = shift;

        return _format_book_entry($slug, $meta, $prog) if $meta->{cover};

        my $claimed = _claim_cover_from_dir($covers_root, $slug, $dir);
        if ($claimed) {
            $meta->{cover} = $claimed;
            $db->upsert_audiobook_meta($slug, $meta);
            return _format_book_entry($slug, $meta, $prog);
        }

        return _maybe_extract_cover($covers_root, $slug, $dir)->then(sub {
            my $cover_name = shift;
            if ($cover_name) {
                $meta->{cover} = $cover_name;
                $db->upsert_audiobook_meta($slug, $meta);
            }
            return _format_book_entry($slug, $meta, $prog);
        });
    });
}

# Renders the main audiobooks SPA skeleton.
# Route: GET /audiobooks
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family;
    $c->render('audiobooks');
}

# Returns consolidated state: all books with metadata and current user's progress.
# Route: GET /audiobooks/api/state
# Uses render_later + Mojo::Promise::all so ffprobe subprocesses for books
# without cached metadata do not block the event loop.
# Returns:
#   JSON: { books: [...], is_admin: 0|1, success: 1 }
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_family;

    $c->render_later;

    my $user_id   = $c->current_user_id;
    my $progress  = $c->db->get_audiobook_progress_all($user_id);
    my $books_map = $c->db->get_all_audiobooks();
    my $is_admin  = $c->is_admin ? 1 : 0;
    my $root      = _books_root($c);
    my @slugs;

    if (-d $root && opendir(my $dh, $root)) {
        @slugs = sort grep { !/^\./ && -d $root->child($_) }
                      map  { decode_utf8($_, Encode::FB_DEFAULT) } readdir($dh);
        closedir($dh);
    }

    my $db      = $c->db;
    my $covers  = _covers_root($c);
    my @promises = map {
        my $slug = $_;
        _safe_component($slug)
            ? _build_book_entry_async($slug, $root->child($slug), $progress->{$slug}, $db, $books_map->{$slug}, $covers)
            : Mojo::Promise->resolve(undef);
    } @slugs;

    Mojo::Promise->all(@promises)->then(sub {
        my @books = grep { defined } map { $_->[0] } @_;
        $c->render(json => { books => \@books, is_admin => $is_admin, success => 1 });
    })->catch(sub {
        my $err = shift;
        $c->app->log->error("Audiobooks api_state error: $err");
        $c->render(json => { success => 0, error => 'Internal error' }, status => 500);
    });
}

# Strips HTML-unsafe characters from a string before embedding in JSON.
# The JS layer calls escapeHtml() on render for XSS protection; this strips
# obvious injection characters at the source.
# Parameters:
#   val : Input string or undef.
# Returns:
#   Sanitised string, or empty string if undef.
sub escapeHtmlPerl {
    my ($val) = @_;
    return '' unless defined $val;
    $val =~ s/&/&amp;/g;
    $val =~ s/</&lt;/g;
    $val =~ s/>/&gt;/g;
    $val =~ s/"/&quot;/g;
    $val =~ s/'/&#39;/g;
    return $val;
}

# Streams an audio chapter file with Range request support (HTTP 206).
# Route: GET /audiobooks/api/stream/:slug/:filename
# Security: slug and filename are validated against a strict allowlist pattern.
sub api_stream {
    my $c = shift;

    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_family;

    my $slug     = $c->param('slug');
    my $filename = $c->param('filename');

    unless (_safe_component($slug) && _safe_component($filename)) {
        return $c->render(json => { error => 'Invalid path' }, status => 400);
    }

    my $root = _books_root($c);
    my $path = $root->child($slug)->child($filename);

    unless (CORE::index($path->to_string, $root->to_string) == 0) {
        return $c->render(json => { error => 'Invalid path' }, status => 400);
    }

    unless (-f $path) {
        return $c->render(json => { error => 'Not found' }, status => 404);
    }

    # Allow OS media controller to access metadata for notifications
    $c->res->headers->header('Access-Control-Allow-Origin' => '*');

    # Mojolicious does not include m4b/m4a in its built-in MIME map.
    my %mime = (
        mp3  => 'audio/mpeg',
        m4a  => 'audio/mp4',
        m4b  => 'audio/mp4',
        ogg  => 'audio/ogg',
        flac => 'audio/flac',
        wav  => 'audio/wav',
    );
    my ($ext) = lc($filename) =~ /\.([^.]+)$/;
    if ($ext && $mime{$ext}) {
        $c->res->headers->content_type($mime{$ext});
    }

    $c->reply->file($path->to_string);
}

# Serves the cover image for a book.
# Route: GET /audiobooks/api/cover/:slug
# Publicly accessible without session so OS media controllers can fetch artwork
# for lock-screen notifications. Security is enforced by strict slug validation.
sub api_cover {
    my $c = shift;

    my $slug = $c->param('slug');
    unless (_safe_component($slug)) {
        return $c->render(json => { error => 'Invalid path' }, status => 400);
    }

    my $covers = _covers_root($c);
    for my $ext (qw(jpg png)) {
        my $cover = $covers->child("$slug.$ext");
        if (-f $cover) {
            # Allow OS media controller to load artwork for notifications
            $c->res->headers->header('Access-Control-Allow-Origin' => '*');
            return $c->reply->file($cover->to_string);
        }
    }

    return $c->render(json => { error => 'No cover image' }, status => 404);
}

# Saves playback progress for the current user.
# Route: POST /audiobooks/api/progress
# Parameters: book_slug, chapter_idx, position_sec, completed (0|1), client_updated_ms
# Returns: JSON { success: 1 }
sub api_save_progress {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_family;

    my $user_id     = $c->current_user_id;
    my $book_slug   = trim($c->param('book_slug')  // '');
    my $chapter_idx = int($c->param('chapter_idx') // 0);
    my $position    = ($c->param('position_sec') // 0) + 0;
    my $completed   = ($c->param('completed')    // 0) ? 1 : 0;
    my $client_ms   = int($c->param('client_updated_ms') // 0);

    unless (length($book_slug) && _safe_component($book_slug)) {
        return $c->render(json => { success => 0, error => 'Invalid book' }, status => 400);
    }

    $chapter_idx = 0 if $chapter_idx < 0;
    $position    = 0 if $position    < 0;
    $client_ms   = int($c->now->epoch * 1000) if $client_ms <= 0;

    my $applied = eval {
        $c->db->upsert_audiobook_progress($user_id, $book_slug, $chapter_idx, $position, $completed, $client_ms);
    };
    if ($@) {
        $c->app->log->error("Failed to save progress for user $user_id, book $book_slug: $@");
        return $c->render(json => { success => 0, error => 'Database error' }, status => 500);
    }

    $c->render(json => { success => 1, applied => $applied ? 1 : 0 });
}

# Deletes playback progress for the current user.
# Route: POST /audiobooks/api/progress/delete
# Parameters: book_slug
# Returns: JSON { success: 1 }
sub api_delete_progress {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_family;

    my $user_id   = $c->current_user_id;
    my $book_slug = trim($c->param('book_slug') // '');

    unless (length($book_slug) && _safe_component($book_slug)) {
        return $c->render(json => { success => 0, error => 'Invalid book' }, status => 400);
    }

    eval {
        $c->db->delete_audiobook_progress($user_id, $book_slug);
    };
    if ($@) {
        $c->app->log->error("Failed to delete progress for user $user_id, book $book_slug: $@");
        return $c->render(json => { success => 0, error => 'Database error' }, status => 500);
    }

    $c->render(json => { success => 1 });
}

# Saves edited book metadata to the DB.
# Route: POST /audiobooks/api/meta/:slug
# Restricted to admin users.
# Parameters: title, author, narrator, description; chapters array (JSON body)
# Returns: JSON { success: 1 }
sub api_save_meta {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_admin;

    my $slug = $c->param('slug');
    unless (_safe_component($slug)) {
        return $c->render(json => { error => 'Invalid slug' }, status => 400);
    }

    my $root = _books_root($c);
    my $dir  = $root->child($slug);

    unless (-d $dir) {
        return $c->render(json => { error => 'Book not found' }, status => 404);
    }

    my $existing  = $c->db->get_audiobook_meta($slug) // _read_or_generate_meta($dir, $slug, _covers_root($c));
    my $json_body = $c->req->json // {};
    my $chapters  = (ref $json_body->{chapters} eq 'ARRAY') ? $json_body->{chapters} : ($existing->{chapters} // []);

    my $meta = {
        title        => trim($c->param('title')       // $json_body->{title}       // $existing->{title}       // $slug),
        author       => trim($c->param('author')      // $json_body->{author}      // $existing->{author}      // ''),
        narrator     => trim($c->param('narrator')    // $json_body->{narrator}    // $existing->{narrator}    // ''),
        description  => trim($c->param('description') // $json_body->{description} // $existing->{description} // ''),
        series       => trim($c->param('series')      // $json_body->{series}      // $existing->{series}      // ''),
        series_index => (($c->param('series_index') // $json_body->{series_index} // $existing->{series_index} // 0) + 0),
        cover        => ($existing->{cover} // ''),
        chapters     => $chapters,
        ($existing->{date_added} ? (date_added => $existing->{date_added}) : ()),
    };

    eval { $c->db->upsert_audiobook_meta($slug, $meta) };
    if ($@) {
        $c->app->log->error("Failed to save metadata for $slug: $@");
        return $c->render(json => { success => 0, error => 'Failed to write metadata' }, status => 500);
    }

    $c->render(json => { success => 1 });
}

# Renders the audiobooks admin panel skeleton.
# Route: GET /audiobooks/admin
sub admin_index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_admin;
    $c->render('audiobooks/admin');
}

# Returns all books with admin-level flags for the admin panel.
# Route: GET /audiobooks/admin/api/state
# Each book entry includes:
#   meta_cached    : 1 if a DB record existed before this request, 0 otherwise.
#   has_cover_file : 1 if cover.jpg or cover.png exists on disk, 0 otherwise.
# Returns:
#   JSON: { books: [...], success: 1 }
sub api_admin_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_admin;

    $c->render_later;

    my $root      = _books_root($c);
    my $books_map = $c->db->get_all_audiobooks();
    my @slugs;

    if (-d $root && opendir(my $dh, $root)) {
        @slugs = sort grep { !/^\./ && -d $root->child($_) }
                      map  { decode_utf8($_, Encode::FB_DEFAULT) } readdir($dh);
        closedir($dh);
    }

    my $db     = $c->db;
    my $covers = _covers_root($c);
    my @promises = map {
        my $slug = $_;
        _safe_component($slug)
            ? _build_book_entry_async($slug, $root->child($slug), undef, $db, $books_map->{$slug}, $covers)
            : Mojo::Promise->resolve(undef);
    } @slugs;

    Mojo::Promise->all(@promises)->then(sub {
        my @books        = grep { defined } map { $_->[0] } @_;
        my $prog_by_slug = $c->db->get_all_users_audiobook_progress();
        for my $book (@books) {
            $book->{meta_cached}    = (defined $books_map->{ $book->{slug} }) ? 1 : 0;
            $book->{has_cover_file} = ($book->{cover_url} ne '')               ? 1 : 0;
            $book->{user_progress}  = $prog_by_slug->{ $book->{slug} }        // [];
        }
        $c->render(json => { books => \@books, success => 1 });
    })->catch(sub {
        my $err = shift;
        $c->app->log->error("Audiobooks api_admin_state error: $err");
        $c->render(json => { success => 0, error => 'Internal error' }, status => 500);
    });
}

# Removes the DB metadata record for one or all books, forcing re-discovery
# on the next api_state or api_admin_state request.
# Route: POST /audiobooks/admin/api/rescan
# Parameters:
#   slug : (optional) book directory slug — omit to rescan all books.
# Returns:
#   JSON: { success: 1, rescanned: N }
sub api_admin_rescan {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_admin;

    my $slug  = trim($c->param('slug') // '');
    my $count = 0;

    if ($slug) {
        return $c->render(json => { error => 'Invalid slug' }, status => 400)
            unless _safe_component($slug);
        $count = $c->db->delete_audiobook_meta($slug);
    } else {
        $count = $c->db->delete_all_audiobook_meta();
    }

    $c->render(json => { success => 1, rescanned => $count });
}

# Replaces the cover image for a book via a multipart file upload.
# Route: POST /audiobooks/admin/api/cover/:slug
# Accepts: multipart field 'cover' — JPEG or PNG only, max 5 MB.
# Sets the cover field in meta.json if the file exists.
# Returns:
#   JSON: { success: 1, cover_url: '...' }
sub api_admin_upload_cover {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless $c->is_admin;

    my $slug = $c->param('slug');
    return $c->render(json => { error => 'Invalid slug' }, status => 400)
        unless _safe_component($slug);

    my $covers = _covers_root($c);
    return $c->render(json => { error => 'Book not found' }, status => 404)
        unless $c->db->get_audiobook_meta($slug);

    my $upload = $c->req->upload('cover');
    return $c->render(json => { error => 'No file uploaded' }, status => 400)
        unless $upload && $upload->size > 0;

    return $c->render(json => { error => 'Image exceeds 5 MB limit' }, status => 400)
        if $upload->size > 5 * 1024 * 1024;

    my $mime = $upload->headers->content_type // '';
    my $ext;
    if    ($mime =~ /jpeg|jpg/i) { $ext = 'jpg' }
    elsif ($mime =~ /png/i)      { $ext = 'png' }
    else {
        my $fname = $upload->filename // '';
        if    ($fname =~ /\.jpe?g$/i) { $ext = 'jpg' }
        elsif ($fname =~ /\.png$/i)   { $ext = 'png' }
        else {
            return $c->render(json => { error => 'Only JPEG and PNG images are accepted' }, status => 400);
        }
    }

    # Remove any existing cover before saving the replacement.
    for my $old_ext (qw(jpg png)) {
        my $old = $covers->child("$slug.$old_ext");
        unlink $old->to_string if -f $old;
    }

    my $dest = $covers->child("$slug.$ext");
    eval { $upload->move_to($dest->to_string) };
    if ($@) {
        $c->app->log->error("Cover upload failed for $slug: $@");
        return $c->render(json => { error => 'Failed to save image' }, status => 500);
    }

    # Persist the cover field in DB so the player shows the new image immediately.
    my $meta = $c->db->get_audiobook_meta($slug) // {
        title        => $slug,
        author       => '',
        narrator     => '',
        description  => '',
        series       => '',
        series_index => 0,
        chapters     => [],
        date_added   => time(),
    };
    $meta->{cover} = "cover.$ext";
    eval { $c->db->upsert_audiobook_meta($slug, $meta) };
    $c->app->log->error("Failed to update cover in DB for $slug: $@") if $@;

    $c->render(json => {
        success   => 1,
        cover_url => '/audiobooks/api/cover/' . Mojo::Util::url_escape($slug),
    });
}

# Registers all routes for this controller.
sub register_routes {
    my ($class, $r) = @_;
    $r->{family}->get('/audiobooks')->to('Audiobooks#index');
    $r->{family}->get('/audiobooks/api/state')->to('Audiobooks#api_state');
    $r->{family}->get('/audiobooks/api/stream/#slug/#filename')->to('Audiobooks#api_stream', format => 0);
    $r->{r}->get('/audiobooks/api/cover/#slug')->to('Audiobooks#api_cover');
    $r->{family}->post('/audiobooks/api/progress')->to('Audiobooks#api_save_progress');
    $r->{family}->post('/audiobooks/api/progress/delete')->to('Audiobooks#api_delete_progress');
    $r->{admin}->post('/audiobooks/api/meta/#slug')->to('Audiobooks#api_save_meta');
    $r->{admin}->get('/audiobooks/admin')->to('Audiobooks#admin_index');
    $r->{admin}->get('/audiobooks/admin/api/state')->to('Audiobooks#api_admin_state');
    $r->{admin}->post('/audiobooks/admin/api/rescan')->to('Audiobooks#api_admin_rescan');
    $r->{admin}->post('/audiobooks/admin/api/cover/#slug')->to('Audiobooks#api_admin_upload_cover');
}

1;
