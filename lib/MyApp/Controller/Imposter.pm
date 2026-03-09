# /lib/MyApp/Controller/Imposter.pm
package MyApp::Controller::Imposter;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim decode url_escape); 
use Mojo::File 'path';
use List::Util qw(shuffle); 

# Controller for the "Imposter" party game.
# Features:
#   - Manage persistent player lobby (add/edit/remove via DB)
#   - Game flow control (start, next turn, reveal, timer)
#   - Dynamic image generation via Unsplash API with DB storage
# Integration points:
#   - Depends on authentication context
#   - Uses DB helpers for player roster and file storage
#   - Connects to Unsplash API for game assets

# Renders the main game interface.
# Route: GET /imposter
# Parameters: None
# Returns:
#   Rendered HTML template with current game state and lobby roster
sub index {
    my $c = shift;
    
    # Retrieve current game state or initialize default
    my $game = $c->session('imposter_game') // { status => 'lobby' };
    
    # Fetch persistent player list from database
    my $lobby = $c->db->get_all_players(); 
    
    # Handle language preference (default to English)
    my $lang = $c->session('lang') // 'en'; 
    $c->session(lang => $lang);
    
    $c->render('imposter/imposter', game => $game, lobby => $lobby, lang => $lang);
}

# Updates the game language preference.
# Route: POST /imposter/language
# Parameters:
#   lang : Language code ('en' or 'th')
# Returns:
#   Redirects to game page
sub set_language {
    my $c = shift;
    my $lang = $c->param('lang');
    
    # Validate supported languages before saving to session
    if ($lang eq 'en' || $lang eq 'th') {
        $c->session(lang => $lang);
    }
    return $c->redirect_to('/imposter');
}

# Adds a new player to the persistent roster.
# Route: POST /imposter/player/add
# Parameters:
#   player_name : Name of the player (1-40 chars, alphanumeric/symbols)
# Returns:
#   Redirects to game page
sub add_custom_player {
    my $c = shift;
    my $name = Mojo::Util::trim($c->param('player_name') // '');
    
    # Validate name format for security and consistency
    if ($name =~ /^[\p{L}\p{N}\p{M}\p{S}\p{P}\s]{1,40}$/) {
        $c->db->add_imposter_player($name);
    }
    return $c->redirect_to('/imposter');
}

# Edits an existing player's name in the roster.
# Route: POST /imposter/player/edit
# Parameters:
#   old_name : Current name of the player
#   new_name : Desired new name
# Returns:
#   Redirects to game page
sub edit_player {
    my $c = shift;
    my $old_name = Mojo::Util::trim($c->param('old_name') // '');
    my $new_name = Mojo::Util::trim($c->param('new_name') // '');

    # Validate new name format
    if ($new_name =~ /^[\p{L}\p{N}\p{M}\p{S}\p{P}\s]{1,40}$/) {
        # Perform atomic-like swap: remove old, add new
        $c->db->remove_imposter_player($old_name);
        $c->db->add_imposter_player($new_name);
    }
    return $c->redirect_to('/imposter');
}

# Removes a player from the persistent roster.
# Route: POST /imposter/player/remove
# Parameters:
#   player_name : Name of the player to remove
# Returns:
#   Redirects to game page
sub remove_player {
    my $c = shift;
    my $target = Mojo::Util::trim($c->param('player_name') // '');
    
    # Remove from database
    $c->db->remove_imposter_player($target);
    
    return $c->redirect_to('/imposter');
}

# Resets the game state and returns to the lobby.
# Route: POST /imposter/reset
# Parameters: None
# Returns:
#   Redirects to game page
sub clear_lobby {
    my $c = shift;
    
    # Clean up generated image files to save space
    $c->_delete_previous_image();
    
    # Reset session state
    $c->session(imposter_game => { status => 'lobby' });
    
    return $c->redirect_to('/imposter');
}

# Resets game state for a new round (keeping roster).
# Route: POST /imposter/play_again
# Parameters: None
# Returns:
#   Redirects to game page
sub play_again {
    my $c = shift;
    
    # Clean up generated image files
    $c->_delete_previous_image();
    
    # Reset session state
    $c->session(imposter_game => { status => 'lobby' });
    return $c->redirect_to('/imposter');
}

# Initializes a new game round with randomized turn order.
# Route: POST /imposter/start
# Parameters:
#   timer_duration : Length of discussion phase in minutes (1-5)
# Returns:
#   Redirects to game page
sub start_game {
    my $c = shift;
    
    # Ensure no lingering images from previous interrupted sessions
    $c->_delete_previous_image();

    # Retrieve current roster from DB
    my $players = $c->db->get_all_players();
    
    # Validate input: timer duration
    my $minutes = int($c->param('timer_duration') // 1);
    $minutes = 1 if $minutes < 1 || $minutes > 5;
    
    # Validate game rules: minimum 3 players required
    return $c->redirect_to('/imposter') unless scalar @$players >= 3;

    # Randomize turn order so the starting player varies
    my @shuffled_players = shuffle(@$players);
    $players = \@shuffled_players;

    # Reset language to English for standard game start
    $c->session(lang => 'en');
    
    # Load word pool from asset file
    my $word_file = $c->app->home->child('assets', 'imposter_words.txt');
    my @pool;
    if (-e $word_file) {
        my $content = Mojo::Util::decode('UTF-8', Mojo::File::path($word_file)->slurp);
        for my $line (split "\n", $content) {
            chomp $line;
            # Parse valid lines (format: en|hint|th|hint|search)
            next if $line =~ /^\s*#/ || $line !~ /\|/;
            
            my ($we, $he, $wt, $ht, $search) = split /\|/, $line, 5;
            push @pool, { 
                en => { 
                    word => Mojo::Util::trim($we // ''), 
                    hint => Mojo::Util::trim($he // '') 
                },
                th => { 
                    word => Mojo::Util::trim($wt // ''), 
                    hint => Mojo::Util::trim($ht // '') 
                },
                search_term => Mojo::Util::trim($search // $we)
            };
        }
    }

    # Handle missing word file graceful failure
    unless (@pool) {
        @pool = ({ 
            en => { word => "Error", hint => "File Missing" }, 
            th => { word => "Error", hint => "ไม่พบไฟล์" },
            search_term => "error"
        });
    }

    # Select random word and generate image
    my $selected = $pool[rand @pool];
    my $search_term = $selected->{search_term} || $selected->{en}->{word};
    
    $c->render_later;
    $c->fetch_and_store_image_p($search_term)->then(sub {
        my $image_id = shift;
        
        # Generate serve URL if image generation succeeded
        my $image_url = $image_id ? "/files/serve/$image_id" : undef;

        # Initialize game session
        $c->session(imposter_game => {
            players       => $players,
            imposter      => $players->[rand @$players],
            word_data     => $selected,
            image_url     => $image_url,
            image_file_id => $image_id,  # Stored for later cleanup
            current_index => 0,
            show_secret   => 0,
            status        => 'passing',
            timer_seconds => $minutes * 60
        });
        $c->redirect_to('/imposter');
    })->catch(sub {
        $c->redirect_to('/imposter');
    });
}

# Toggles the visibility of the secret word/role for the current player.
# Route: POST /imposter/toggle
# Parameters: None
# Returns:
#   Redirects to game page
sub toggle_view {
    my $c = shift;
    my $game = $c->session('imposter_game');
    
    # Only allow toggling during the "passing" phase
    return $c->redirect_to('/imposter') unless $game->{status} eq 'passing';

    $game->{show_secret} = $game->{show_secret} ? 0 : 1;
    $c->session(imposter_game => $game);
    return $c->redirect_to('/imposter');
}

# Advances the game to the next player.
# Route: POST /imposter/next
# Parameters: None
# Returns:
#   Redirects to game page
sub next_player {
    my $c = shift;
    my $game = $c->session('imposter_game');
    return $c->redirect_to('/imposter') unless $game->{status} eq 'passing';
    
    # Advance index and hide secret immediately
    $game->{current_index}++;
    $game->{show_secret} = 0;

    # Reset language to prevents cues from previous player
    $c->session(lang => 'en');

    # Check if all players have seen their role
    if ($game->{current_index} >= scalar @{$game->{players}}) {
        $game->{status} = 'timer';
        # Pick a random player to start the discussion
        my @p = @{$game->{players}};
        $game->{starter} = $p[rand @p];
    }

    $c->session(imposter_game => $game);
    return $c->redirect_to('/imposter');
}

# Skips the countdown timer and ends the game immediately.
# Route: POST /imposter/end_timer
# Parameters: None
# Returns:
#   Redirects to game page
sub end_game_early {
    my $c = shift;
    my $game = $c->session('imposter_game');
    
    if ($game && $game->{status} eq 'timer') {
        $game->{timer_seconds} = 0;
        $game->{status} = 'finished';
        $c->session(imposter_game => $game);
        return $c->redirect_to('/imposter'); 
    }
    return $c->redirect_to('/imposter');
}

# Transitions game to result screen.
# Route: POST /imposter/reveal
# Parameters: None
# Returns:
#   Redirects to game page
sub reveal_results {
    my $c = shift;
    my $game = $c->session('imposter_game');
    
    $game->{status} = 'finished';
    $c->session(imposter_game => $game);
    return $c->redirect_to('/imposter');
}

# Internal Helper: Fetches image from API and stores in DB.
# Parameters:
#   search_term : Term to query Unsplash API
# Returns:
#   file_id : ID of the stored file in DB, or undef on failure
sub fetch_and_store_image_p {
    my ($c, $search_term) = @_;
    
    my $api_key = $c->db->get_unsplash_key() || '';
    my $image_url;
    my $promise = Mojo::Promise->new;

    # Step 1: Get Image URL
    my $get_url_p;
    if ($api_key && $api_key ne '') {
        my $api_url = "https://api.unsplash.com/photos/random?query=" 
                      . Mojo::Util::url_escape($search_term) 
                      . "&orientation=landscape&content_filter=high&client_id=$api_key";
        
        $get_url_p = $c->ua->request_timeout(5)->get_p($api_url)->then(sub {
            my $tx = shift;
            if ($tx->result->is_success) {
                return $tx->result->json->{urls}->{regular};
            } else {
                $c->app->log->warn("Unsplash API failed, using fallback.");
                return "https://picsum.photos/800/600?random=" . time();
            }
        })->catch(sub {
            $c->app->log->warn("Unsplash API exception, using fallback.");
            return "https://picsum.photos/800/600?random=" . time();
        });
    } else {
        $get_url_p = Mojo::Promise->resolve("https://picsum.photos/800/600?random=" . time());
    }

    # Step 2: Download Image
    $get_url_p->then(sub {
        my $url = shift;
        return Mojo::Promise->resolve(undef) unless $url;
        
        return $c->ua->request_timeout(5)->get_p($url)->then(sub {
            my $img_tx = shift;
            my $img_res = $img_tx->result;

            if ($img_res && $img_res->is_success) {
                my $data = $img_res->body;
                my $size = length($data);
                my $mime = $img_res->headers->content_type || 'image/jpeg';
                
                my $ext = 'jpg';
                $ext = 'png' if $mime =~ /png/i;
                $ext = 'gif' if $mime =~ /gif/i;
                
                my $filename = "imposter_" . time() . "_" . int(rand(10000)) . ".$ext";
                
                my $file_id = eval {
                    $c->db->store_file(
                        $filename, $filename, $mime, $size, $data, 'system', undef
                    );
                };
                
                if ($@) {
                    $c->app->log->error("Failed to store imposter image: $@");
                    return undef;
                }
                return $file_id;
            } else {
                $c->app->log->error("Failed to download imposter image.");
                return undef;
            }
        });
    })->then(sub {
        my $file_id = shift;
        $promise->resolve($file_id);
    })->catch(sub {
        my $err = shift;
        $c->app->log->error("Image fetch pipeline error: $err");
        $promise->resolve(undef);
    });

    return $promise;
}

# Internal Helper: Deletes the game image from the database.
# Parameters: None (Uses session data)
# Returns: Void
sub _delete_previous_image {
    my $c = shift;
    my $game = $c->session('imposter_game');
    
    if ($game && $game->{image_file_id}) {
        # Execute DB deletion to prevent storage bloat
        eval {
            $c->db->delete_file_record($game->{image_file_id});
            $c->app->log->info("Deleted old imposter image ID: " . $game->{image_file_id});
        };
    }
}

1;