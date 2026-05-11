# /lib/MyApp/Controller/Audiobooks.pm

package MyApp::Controller::Audiobooks;

use Mojo::Base 'Mojolicious::Controller';
use Mojo::File    qw(path);
use Mojo::JSON    qw(decode_json encode_json);
use Mojo::Util    qw(trim);
use Mojo::IOLoop;
use Mojo::Promise;
use Fcntl qw(:flock);
use strict;
use warnings;
use utf8;

# Controller for the Audiobooks player module.
#
# Features:
#   - Filesystem-driven book discovery from assets/audiobooks/<slug>/.
#   - Per-user playback progress (chapter index + position) stored in MariaDB.
#   - Range-aware audio streaming via Mojolicious reply->file (HTTP 206).
#   - Admin-editable book metadata persisted as meta.json alongside audio files.
#   - Chapter extraction: CUE sheet, embedded MP4 atoms (via ffprobe), or filename scan.
#   - ffprobe is called once per new book via Mojo::IOLoop->subprocess; result is
#     cached to meta.json so subsequent loads are instant file reads.
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
    return $value =~ /\A[A-Za-z0-9_(). ,#'\[\]&!-]+\z/ ? 1 : 0;
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

# Writes a metadata HashRef to meta.json inside the book directory.
# Uses exclusive locking to prevent corruption during concurrent writes.
# Parameters:
#   dir  : Mojo::File pointing to the book directory.
#   meta : HashRef to serialise.
# Returns: void
sub _write_meta_json {
    my ($dir, $meta) = @_;
    my $meta_file = $dir->child('meta.json');
    eval {
        open(my $fh, '>', $meta_file->to_string) or die $!;
        flock($fh, LOCK_EX) or die $!;
        print $fh encode_json($meta);
        close($fh);
    };
    if ($@) {
        warn "Failed to write meta.json in $dir: $@";
    }
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

    return {
        slug           => $slug,
        title          => escapeHtmlPerl($meta->{title}       // $slug),
        author         => escapeHtmlPerl($meta->{author}      // ''),
        narrator       => escapeHtmlPerl($meta->{narrator}    // ''),
        description    => escapeHtmlPerl($meta->{description} // ''),
        cover_url      => ($meta->{cover} ? "/audiobooks/api/cover/$slug" : ''),
        chapters       => $chapters,
        total_chapters => scalar @$chapters,
        progress       => $prog,
    };
}

# Reads meta.json for a book, falling back to CUE parsing then directory scan.
# This synchronous path is used by api_save_meta (which needs existing meta
# before updating it). api_state uses the async _build_book_entry_async instead.
# Parameters:
#   dir  : Mojo::File pointing to the book directory.
#   slug : String slug.
# Returns:
#   HashRef: { title, author, narrator, description, cover, chapters => [...] }
sub _read_or_generate_meta {
    my ($dir, $slug) = @_;

    my $meta_file = $dir->child('meta.json');
    if (-f $meta_file) {
        my $raw  = eval { $meta_file->slurp };
        my $meta = ($raw) ? eval { decode_json($raw) } : undef;
        return $meta if ref $meta eq 'HASH';
    }

    my $cue_meta = _parse_cue_file($dir);
    if ($cue_meta) {
        my @ch = @{ $cue_meta->{chapters} };
        my $t  = $cue_meta->{title} || do { (my $s = $slug) =~ s/[-_]/ /g; $s =~ s/\b(\w)/uc($1)/ge; $s };
        return {
            title       => $t,
            author      => ($cue_meta->{author} // ''),
            narrator    => '',
            description => '',
            cover       => _find_cover($dir),
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
        cover       => _find_cover($dir),
        chapters    => \@chapters,
    };
}

# Returns the cover image filename ('cover.jpg', 'cover.png') if found, or empty string.
# Parameters:
#   dir : Mojo::File pointing to the book directory.
# Returns:
#   String filename or ''.
sub _find_cover {
    my ($dir) = @_;
    return 'cover.jpg' if -f $dir->child('cover.jpg');
    return 'cover.png' if -f $dir->child('cover.png');
    return '';
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
        my ($name) = sort grep { /\.(?:$ext_re)$/i && -f $dir->child($_) } readdir($dh);
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
        my ($name) = grep { /\.cue$/i } readdir($dh);
        closedir($dh);
        return undef unless $name;
        $cue_path = $dir->child($name);
    }
    return undef unless $cue_path && -f $cue_path;

    my $text = eval { $cue_path->slurp };
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
        @files = sort grep { /\.(?:$ext_re)$/i && -f $dir->child($_) } readdir($dh);
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

# Runs ffprobe on a file via Mojo::IOLoop->subprocess and resolves a Promise
# with an ArrayRef of chapter HashRefs in the same format as CUE chapters.
# Returns an immediately-resolved empty-array promise if ffprobe fails.
# Parameters:
#   filepath   : Absolute path string to the audio file.
#   audio_file : Basename of the audio file (stored in each chapter's 'file' key).
# Returns:
#   Mojo::Promise resolving to ArrayRef of { file, title, duration, start }.
sub _run_ffprobe {
    my ($filepath, $audio_file) = @_;

    my $promise = Mojo::Promise->new;

    Mojo::IOLoop->subprocess->run(
        sub {
            # Child: exec ffprobe without a shell to avoid injection risk.
            my $out = '';
            open(my $fh, '-|', 'ffprobe', '-v', 'quiet', '-print_format', 'json',
                 '-show_chapters', $filepath) or return '';
            $out .= $_ while <$fh>;
            close($fh);
            return $out;
        },
        sub {
            my (undef, $err, $json) = @_;
            if ($err || !$json) {
                $promise->resolve([]);
                return;
            }
            my $data = eval { decode_json($json) };
            if (!$data || ref $data->{chapters} ne 'ARRAY' || !@{ $data->{chapters} }) {
                $promise->resolve([]);
                return;
            }
            my @chapters = map {
                my $ch = $_;
                {
                    file     => $audio_file,
                    title    => ($ch->{tags}{title} // 'Chapter ' . ($ch->{id} + 1)),
                    duration => (($ch->{end_time}   // 0) - ($ch->{start_time} // 0)),
                    start    => ($ch->{start_time}  // 0) + 0,
                }
            } @{ $data->{chapters} };
            $promise->resolve(\@chapters);
        }
    );

    return $promise;
}

# Attempts to extract embedded cover art from an M4B/M4A file via ffmpeg.
# Only called when no cover image exists on disk.
# Parameters:
#   dir : Mojo::File pointing to the book directory.
# Returns:
#   Mojo::Promise resolving to 'cover.jpg' on success, '' on failure.
sub _maybe_extract_cover {
    my ($dir) = @_;
    my $audio_path = _find_embedded_chapter_candidate($dir);
    return Mojo::Promise->resolve('') unless $audio_path;

    my $cover_dest = $dir->child('cover.jpg')->to_string;
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
#   1. meta.json exists → immediate resolve (cover extraction if cover field is empty).
#   2. CUE file found   → parse sync, write meta.json, cover extraction if needed.
#   3. M4B/M4A found    → ffprobe subprocess, write meta.json, cover extraction if needed.
#   4. Fallback         → scan directory filenames, cover extraction if needed.
#
# After building meta via any path, if no cover is set, _maybe_extract_cover runs
# once to pull embedded art from the audio file; the cover filename is written
# into meta and meta.json is persisted to disk on success.
#
# Parameters:
#   slug : Book directory slug.
#   dir  : Mojo::File pointing to the book directory.
#   prog : Progress HashRef for the current user (may be undef).
# Returns:
#   Mojo::Promise resolving to a book-entry HashRef.
sub _build_book_entry_async {
    my ($slug, $dir, $prog) = @_;

    my $meta_promise;

    # Fast path: meta.json already cached on disk.
    my $meta_file = $dir->child('meta.json');
    if (-f $meta_file) {
        my $raw  = eval { $meta_file->slurp };
        my $meta = $raw ? eval { decode_json($raw) } : undef;
        if (ref $meta eq 'HASH') {
            $meta_promise = Mojo::Promise->resolve($meta);
        }
    }

    # CUE sheet present: synchronous parse, then cache.
    unless ($meta_promise) {
        my $cue_meta = _parse_cue_file($dir);
        if ($cue_meta && @{ $cue_meta->{chapters} }) {
            my $t = $cue_meta->{title} || do {
                (my $s = $slug) =~ s/[-_]/ /g; $s =~ s/\b(\w)/uc($1)/ge; $s
            };
            my $meta = {
                title       => $t,
                author      => ($cue_meta->{author} // ''),
                narrator    => '',
                description => '',
                cover       => _find_cover($dir),
                chapters    => $cue_meta->{chapters},
            };
            _write_meta_json($dir, $meta);
            $meta_promise = Mojo::Promise->resolve($meta);
        }
    }

    # M4B/M4A with embedded chapters: run ffprobe in a subprocess.
    unless ($meta_promise) {
        my $audio_path = _find_embedded_chapter_candidate($dir);
        if ($audio_path) {
            my $audio_file = path($audio_path)->basename;
            my $title = $slug;
            $title =~ s/[-_]/ /g;
            $title =~ s/\b(\w)/uc($1)/ge;

            $meta_promise = _run_ffprobe($audio_path, $audio_file)->then(sub {
                my $chapters = shift;
                my $meta = {
                    title       => $title,
                    author      => '',
                    narrator    => '',
                    description => '',
                    cover       => _find_cover($dir),
                    chapters    => $chapters,
                };
                _write_meta_json($dir, $meta) if @$chapters;
                return $meta;
            });
        }
    }

    # Fallback: list audio filenames as chapters.
    unless ($meta_promise) {
        my @chapters = _scan_chapters($dir);
        my $title = $slug;
        $title =~ s/[-_]/ /g;
        $title =~ s/\b(\w)/uc($1)/ge;
        $meta_promise = Mojo::Promise->resolve({
            title       => $title,
            author      => '',
            narrator    => '',
            description => '',
            cover       => _find_cover($dir),
            chapters    => \@chapters,
        });
    }

    # Common tail: if no cover is set, attempt embedded art extraction once.
    # On success the cover filename is written into meta and meta.json is persisted.
    return $meta_promise->then(sub {
        my $meta = shift;
        return _format_book_entry($slug, $meta, $prog) if $meta->{cover};

        return _maybe_extract_cover($dir)->then(sub {
            my $cover_name = shift;
            if ($cover_name) {
                $meta->{cover} = $cover_name;
                _write_meta_json($dir, $meta);
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

    my $user_id  = $c->current_user_id;
    my $progress = $c->db->get_audiobook_progress_all($user_id);
    my $is_admin = $c->is_admin ? 1 : 0;
    my $root     = _books_root($c);
    my @slugs;

    if (-d $root && opendir(my $dh, $root)) {
        @slugs = sort grep { !/^\./ && -d $root->child($_) } readdir($dh);
        closedir($dh);
    }

    my @promises = map {
        my $slug = $_;
        _safe_component($slug)
            ? _build_book_entry_async($slug, $root->child($slug), $progress->{$slug})
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
    $val =~ s/[<>&"']//g;
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

    my $root = _books_root($c);
    my $dir  = $root->child($slug);

    for my $name (qw(cover.jpg cover.png)) {
        my $cover = $dir->child($name);
        if (-f $cover) {
            unless (CORE::index($cover->to_string, $root->to_string) == 0) {
                return $c->render(json => { error => 'Invalid path' }, status => 400);
            }
            # Allow OS media controller to load artwork for notifications
            $c->res->headers->header('Access-Control-Allow-Origin' => '*');
            return $c->reply->file($cover->to_string);
        }
    }

    return $c->render(json => { error => 'No cover image' }, status => 404);
}

# Saves playback progress for the current user.
# Route: POST /audiobooks/api/progress
# Parameters: book_slug, chapter_idx, position_sec, completed (0|1)
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

    unless (length($book_slug) && _safe_component($book_slug)) {
        return $c->render(json => { success => 0, error => 'Invalid book' }, status => 400);
    }

    $chapter_idx = 0 if $chapter_idx < 0;
    $position    = 0 if $position    < 0;

    eval {
        $c->db->upsert_audiobook_progress($user_id, $book_slug, $chapter_idx, $position, $completed);
    };
    if ($@) {
        $c->app->log->error("Failed to save progress for user $user_id, book $book_slug: $@");
        return $c->render(json => { success => 0, error => 'Database error' }, status => 500);
    }

    $c->render(json => { success => 1 });
}

# Saves edited book metadata to meta.json on disk.
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

    my $meta_file = $dir->child('meta.json');
    my $meta;

    eval {
        open(my $fh, '+>>', $meta_file->to_string) or die $!;
        flock($fh, LOCK_EX) or die $!;
        seek($fh, 0, 0);

        my $raw = do { local $/; <$fh> };
        my $existing = $raw ? eval { decode_json($raw) } : _read_or_generate_meta($dir, $slug);
        die "Invalid JSON in meta.json" if $raw && !$existing;

        my $json_body = $c->req->json // {};
        my $chapters  = (ref $json_body->{chapters} eq 'ARRAY') ? $json_body->{chapters} : ($existing->{chapters} // []);

        $meta = {
            title       => trim($c->param('title')       // $json_body->{title}       // $existing->{title}       // $slug),
            author      => trim($c->param('author')      // $json_body->{author}      // $existing->{author}      // ''),
            narrator    => trim($c->param('narrator')    // $json_body->{narrator}    // $existing->{narrator}    // ''),
            description => trim($c->param('description') // $json_body->{description} // $existing->{description} // ''),
            cover       => ($existing->{cover} // ''),
            chapters    => $chapters,
        };

        truncate($fh, 0);
        seek($fh, 0, 0);
        print $fh encode_json($meta);
        close($fh);
    };

    if ($@) {
        $c->app->log->error("Failed to save metadata for $slug: $@");
        return $c->render(json => { success => 0, error => 'Failed to write metadata' }, status => 500);
    }

    $c->render(json => { success => 1 });
}

# Registers all routes for this controller.
sub register_routes {
    my ($class, $r) = @_;
    $r->{family}->get('/audiobooks')->to('Audiobooks#index');
    $r->{family}->get('/audiobooks/api/state')->to('Audiobooks#api_state');
    $r->{family}->get('/audiobooks/api/stream/:slug/#filename')->to('Audiobooks#api_stream', format => 0);
    $r->{r}->get('/audiobooks/api/cover/:slug')->to('Audiobooks#api_cover');
    $r->{family}->post('/audiobooks/api/progress')->to('Audiobooks#api_save_progress');
    $r->{admin}->post('/audiobooks/api/meta/:slug')->to('Audiobooks#api_save_meta');
}

1;
