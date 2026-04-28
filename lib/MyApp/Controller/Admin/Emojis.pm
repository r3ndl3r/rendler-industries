# /lib/MyApp/Controller/Admin/Emojis.pm

package MyApp::Controller::Admin::Emojis;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for Emoji Dictionary Management and AI Training Sandbox.
#
# Features:
#   - Monitoring of emoji processing queue depth across whitelisted modules.
#   - Management of the AI learned dictionary (ai_emoji_dictionary).
#   - Interactive AI Sandbox for testing and seeding new mappings.
#
# Security:
#   - All endpoints are restricted to 'admin' users.
#   - Explicit permission verification on every state and modification endpoint.

# Renders the main management interface.
# Route: GET /admin/emojis
sub index {
    my $c = shift;
    
    # Authenticate session
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_admin;
    
    $c->render('admin/emojis');
}

# Returns the consolidated state (stats + initial dictionary batch).
# Route: GET /admin/emojis/api/state
# Parameters: search (Optional)
sub api_state {
    my $c = shift;
    
    # Authorize administrative access
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    
    my $stats = $c->db->get_emoji_stats();
    my $search = $c->param('search') || '';
    my $dictionary = $c->db->get_emoji_dictionary_list(20, 0, $search);
    
    $c->render(json => {
        success    => 1,
        stats      => $stats,
        dictionary => $dictionary
    });
}

# Returns a paginated list of dictionary entries.
# Route: GET /admin/emojis/api/list
# Parameters: search, offset, limit
sub api_list {
    my $c = shift;
    
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    
    my $search = $c->param('search') || '';
    my $offset = $c->param('offset') // 0;
    my $limit  = $c->param('limit')  // 20;
    
    my $list = $c->db->get_emoji_dictionary_list($limit, $offset, $search);
    
    $c->render(json => {
        success    => 1,
        dictionary => $list,
        has_more   => (scalar @$list >= $limit ? 1 : 0)
    });
}

# Updates or creates a manual dictionary mapping.
# Route: POST /admin/emojis/api/update
# Parameters: keyword, emoji
sub api_update {
    my $c = shift;
    
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    
    my $keyword = trim($c->param('keyword') // '');
    my $emoji   = trim($c->param('emoji')   // '');
    
    if (!$keyword || !$emoji) {
        return $c->render(json => { success => 0, error => "Keyword and Emoji are required" });
    }
    
    if ($c->db->update_dictionary_entry($keyword, $emoji)) {
        $c->render(json => { success => 1, message => "Mapping saved" });
    } else {
        $c->render(json => { success => 0, error => "Failed to save mapping" });
    }
}

# Removes a specific mapping from the dictionary.
# Route: POST /admin/emojis/api/delete
# Parameters: keyword
sub api_delete {
    my $c = shift;
    
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    
    my $keyword = $c->param('keyword');
    
    if ($c->db->delete_dictionary_entry($keyword)) {
        $c->render(json => { success => 1, message => "Mapping removed" });
    } else {
        $c->render(json => { success => 0, error => "Failed to remove mapping" });
    }
}

# Interactive AI Sandbox: Predicts an emoji for a given phrase.
# Route: POST /admin/emojis/api/test
# Parameters: text
sub api_test {
    my $c = shift;
    
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    
    my $text = trim($c->param('text') // '');
    return $c->render(json => { success => 0, error => "Enter text to test" }) unless $text;
    
    $c->render_later;
    
    $c->gemini_generate_emoji($text)->then(sub {
        my $data = shift;
        
        if ($data && $data->{candidates} && @{$data->{candidates}}) {
            my $emoji = trim($data->{candidates}[0]{content}{parts}[0]{text} // '');
            $emoji =~ s/^['"]+|['"]+$//g;
            
            # Validation: Ensure it's not a long string (AI hallucination)
            if (length($emoji) > 0 && length($emoji) <= 10 && $emoji !~ /[a-zA-Z]{3,}/) {
                $c->render(json => { success => 1, emoji => $emoji });
            } else {
                $c->render(json => { success => 0, error => "AI returned invalid response: $emoji" });
            }
        } else {
            $c->render(json => { success => 0, error => "AI service failed to respond" });
        }
    })->catch(sub {
        my $err = shift;
        $c->render(json => { success => 0, error => "Gemini Error: $err" });
    });
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{admin}->get('/admin/emojis')->to('admin-emojis#index');
    $r->{admin}->get('/admin/emojis/api/state')->to('admin-emojis#api_state');
    $r->{admin}->get('/admin/emojis/api/list')->to('admin-emojis#api_list');
    $r->{admin}->post('/admin/emojis/api/update')->to('admin-emojis#api_update');
    $r->{admin}->post('/admin/emojis/api/delete')->to('admin-emojis#api_delete');
    $r->{admin}->post('/admin/emojis/api/test')->to('admin-emojis#api_test');
}

1;
