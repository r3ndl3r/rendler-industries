# /lib/MyApp/Controller/Imposter.pm
package MyApp::Controller::Imposter;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim decode url_escape); 
use Mojo::File 'path';
use List::Util qw(shuffle); 

# Controller for the "Imposter" party game.
# 
# Features:
# - Persistent player lobby management via MariaDB.
# - Dynamic session-based game state orchestration.
# - AI-powered visual asset generation via Unsplash API.
# - Multi-language support (English/Thai).
# - Real-time discussion timer orchestration.

# Interface: index
# Serves the primary SPA skeleton for the Imposter game.
# 
# @returns {Template} Rendered imposter.html.ep
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_family;
    
    return $c->render('imposter');
}

# API: api_state
# Retrieves the unified source of truth for the current game state.
# 
# @returns {JSON} { success, game, lobby, lang }
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;

    my $game_orig = $c->session('imposter_game') // { status => 'lobby' };
    my $lobby = $c->db->get_all_players(); 
    my $lang = $c->session('lang') // 'en'; 
    $c->session(lang => $lang);

    # Security: Mask sensitive information unless game is finished
    my $game = { %$game_orig }; # Shallow clone
    if ($game->{status} && $game->{status} ne 'finished') {
        delete $game->{imposter};
        delete $game->{word_data} if $game->{status} eq 'lobby';
    }

    # Identify if current passing player is the imposter without leaking the full identity
    if ($game->{status} && $game->{status} eq 'passing' && $game->{show_secret}) {
        my $current_player = $game->{players}->[$game->{current_index}];
        $game->{is_current_imposter} = ($current_player eq $game_orig->{imposter}) ? 1 : 0;
    }

    return $c->render(json => {
        success => 1,
        game    => $game,
        lobby   => $lobby,
        lang    => $lang,
        now     => time()
    });
}

# API: api_set_lang
# Updates the game language preference in the user session.
# 
# @param {string} lang - Language code ('en' or 'th')
# @returns {JSON} { success }
sub api_set_lang {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $data = $c->req->json || $c->req->params->to_hash;
    my $lang = $data->{lang} // 'en';
    
    if ($lang eq 'en' || $lang eq 'th') {
        $c->session(lang => $lang);
    }

    return $c->render(json => { success => 1 });
}

# API: api_add_player
# Adds a new player to the persistent roster.
# 
# @param {string} player_name - Name of the player
# @returns {JSON} { success }
sub api_add_player {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $data = $c->req->json || $c->req->params->to_hash;
    my $name = trim($data->{player_name} // '');
    
    if ($name =~ /^[\p{L}\p{N}\p{M}\p{S}\p{P}\s]{1,40}$/) {
        $c->db->add_imposter_player($name);
    }
    
    return $c->render(json => { success => 1 });
}

# API: api_edit_player
# Edits an existing player's name in the roster.
# 
# @param {string} old_name - Current name
# @param {string} new_name - New name
# @returns {JSON} { success }
sub api_edit_player {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $data = $c->req->json || $c->req->params->to_hash;
    my $old_name = trim($data->{old_name} // '');
    my $new_name = trim($data->{new_name} // '');

    if ($new_name =~ /^[\p{L}\p{N}\p{M}\p{S}\p{P}\s]{1,40}$/) {
        $c->db->update_imposter_player($old_name, $new_name);
    }
    
    return $c->render(json => { success => 1 });
}

# API: api_remove_player
# Removes a player from the persistent roster.
# 
# @param {string} player_name - Name to remove
# @returns {JSON} { success }
sub api_remove_player {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $data = $c->req->json || $c->req->params->to_hash;
    my $target = trim($data->{player_name} // '');
    
    $c->db->remove_imposter_player($target);
    
    return $c->render(json => { success => 1 });
}

# API: api_reset
# Resets the game state and returns to the lobby.
# 
# @returns {JSON} { success }
sub api_reset {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    $c->_delete_previous_image();
    $c->session(imposter_game => { status => 'lobby' });
    
    return $c->render(json => { success => 1 });
}

# API: api_start
# Initializes a new game round with randomized turn order and assets.
# 
# @param {number} timer_duration - Discussion phase length (1-5 minutes)
# @returns {JSON} { success }
sub api_start {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $data = $c->req->json || $c->req->params->to_hash;
    my $minutes = int($data->{timer_duration} // 1);
    $minutes = 1 if $minutes < 1 || $minutes > 5;

    $c->_delete_previous_image();
    my $players = $c->db->get_all_players();
    return $c->render(json => { success => 0, error => 'At least 3 players required' }) unless scalar @$players >= 3;

    my @shuffled_players = shuffle(@$players);
    $players = \@shuffled_players;
    $c->session(lang => 'en');
    
    my $word_file = $c->app->home->child('assets', 'imposter_words.txt');
    my @pool;
    if (-e $word_file) {
        my $content = decode('UTF-8', path($word_file)->slurp);
        for my $line (split "\n", $content) {
            chomp $line;
            next if $line =~ /^\s*#/ || $line !~ /\|/;
            my ($we, $he, $wt, $ht, $search) = split /\|/, $line, 5;
            push @pool, { 
                en => { word => trim($we // ''), hint => trim($he // '') },
                th => { word => trim($wt // ''), hint => trim($ht // '') },
                search_term => trim($search // $we)
            };
        }
    }

    unless (@pool) {
        @pool = ({ 
            en => { word => "Error", hint => "File Missing" }, 
            th => { word => "Error", hint => "ไม่พบไฟล์" },
            search_term => "error"
        });
    }

    my $selected = $pool[rand @pool];
    my $search_term = $selected->{search_term} || $selected->{en}->{word};
    
    $c->render_later;
    $c->fetch_and_store_image_p($search_term)->then(sub {
        my $image_id = shift;
        my $image_url = $image_id ? "/files/serve/$image_id" : undef;

        $c->session(imposter_game => {
            players       => $players,
            imposter      => $players->[rand @$players],
            word_data     => $selected,
            image_url     => $image_url,
            image_file_id => $image_id,
            current_index => 0,
            show_secret   => 0,
            status        => 'passing',
            timer_duration_seconds => $minutes * 60
        });
        $c->render(json => { success => 1 });
    })->catch(sub {
        $c->render(json => { success => 0, error => 'Failed to initialize game assets' });
    });
}

# API: api_toggle_view
# Toggles the visibility of the secret word/role.
# 
# @returns {JSON} { success }
sub api_toggle_view {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $game = $c->session('imposter_game');
    return $c->render(json => { success => 0, error => 'Game not in passing phase' }) unless $game->{status} eq 'passing';

    $game->{show_secret} = $game->{show_secret} ? 0 : 1;
    $c->session(imposter_game => $game);
    
    return $c->render(json => { success => 1 });
}

# API: api_next_player
# Advances the game to the next player in sequence.
# 
# @returns {JSON} { success }
sub api_next_player {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $game = $c->session('imposter_game');
    return $c->render(json => { success => 0, error => 'Game not in passing phase' }) unless $game->{status} eq 'passing';
    
    $game->{current_index}++;
    $game->{show_secret} = 0;
    $c->session(lang => 'en');

    if ($game->{current_index} >= scalar @{$game->{players}}) {
        $game->{status} = 'timer';
        my @p = @{$game->{players}};
        $game->{starter} = $p[rand @p];
        # Set absolute end time for the timer
        $game->{timer_ends_at} = time() + ($game->{timer_duration_seconds} || 60);
    }

    $c->session(imposter_game => $game);
    return $c->render(json => { success => 1 });
}

# API: api_end_early
# Skips the discussion phase and proceeds to reveal.
# 
# @returns {JSON} { success }
sub api_end_early {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $game = $c->session('imposter_game');
    if ($game && $game->{status} eq 'timer') {
        $game->{status} = 'finished';
        $c->session(imposter_game => $game);
        return $c->render(json => { success => 1 });
    }
    
    return $c->render(json => { success => 0, error => 'Not in timer phase' });
}

# API: api_reveal
# Transitions the game to the result screen.
# 
# @returns {JSON} { success }
sub api_reveal {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_family;
    
    my $game = $c->session('imposter_game');
    $game->{status} = 'finished';
    $c->session(imposter_game => $game);
    
    return $c->render(json => { success => 1 });
}

# Helper: fetch_and_store_image_p
# Asynchronously downloads an image and stores it in the platform file vault.
# 
# @param {string} search_term - Query for the Unsplash API
# @returns {Promise} Resolves to file_id or undef
sub fetch_and_store_image_p {
    my ($c, $search_term) = @_;
    my $api_key = $c->db->get_unsplash_key() || '';
    my $promise = Mojo::Promise->new;

    my $get_url_p;
    if ($api_key && $api_key ne '') {
        my $api_url = "https://api.unsplash.com/photos/random?query=" 
                      . url_escape($search_term) 
                      . "&orientation=landscape&content_filter=high&client_id=$api_key";
        
        $get_url_p = $c->ua->request_timeout(5)->get_p($api_url)->then(sub {
            my $tx = shift;
            return $tx->result->is_success ? $tx->result->json->{urls}->{regular} : "https://picsum.photos/800/600?random=" . time();
        })->catch(sub {
            return "https://picsum.photos/800/600?random=" . time();
        });
    } else {
        $get_url_p = Mojo::Promise->resolve("https://picsum.photos/800/600?random=" . time());
    }

    $get_url_p->then(sub {
        my $url = shift;
        return Mojo::Promise->resolve(undef) unless $url;
        
        return $c->ua->request_timeout(5)->get_p($url)->then(sub {
            my $img_tx = shift;
            my $img_res = $img_tx->result;

            if ($img_res && $img_res->is_success) {
                my $data = $img_res->body;
                my $mime = $img_res->headers->content_type || 'image/jpeg';
                my $ext = $mime =~ /png/i ? 'png' : $mime =~ /gif/i ? 'gif' : 'jpg';
                my $filename = "imposter_" . time() . "_" . int(rand(10000)) . ".$ext";
                
                return eval { $c->db->store_file($filename, $filename, $mime, length($data), $data, 'system', undef) };
            }
            return undef;
        });
    })->then(sub {
        $promise->resolve(shift);
    })->catch(sub {
        $promise->resolve(undef);
    });

    return $promise;
}

# Helper: _delete_previous_image
# Deletes transient game assets to preserve storage quota.
sub _delete_previous_image {
    my $c = shift;
    my $game = $c->session('imposter_game');
    if ($game && $game->{image_file_id}) {
        eval { $c->db->delete_file_record($game->{image_file_id}) };
    }
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{family}->get('/imposter')->to('imposter#index');
    $r->{family}->get('/imposter/api/state')->to('imposter#api_state');
    $r->{family}->post('/imposter/api/add_player')->to('imposter#api_add_player');
    $r->{family}->post('/imposter/api/edit_player')->to('imposter#api_edit_player');
    $r->{family}->post('/imposter/api/remove_player')->to('imposter#api_remove_player');
    $r->{family}->post('/imposter/api/clear_lobby')->to('imposter#api_reset');
    $r->{family}->post('/imposter/api/start')->to('imposter#api_start');
    $r->{family}->post('/imposter/api/toggle_view')->to('imposter#api_toggle_view');
    $r->{family}->post('/imposter/api/set_lang')->to('imposter#api_set_lang');
    $r->{family}->post('/imposter/api/next_player')->to('imposter#api_next_player');
    $r->{family}->post('/imposter/api/end_game_early')->to('imposter#api_end_early');
    $r->{family}->post('/imposter/api/reveal')->to('imposter#api_reveal');
    $r->{family}->post('/imposter/api/play_again')->to('imposter#api_reset');
}

1;
