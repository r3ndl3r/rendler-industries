# /lib/MyApp/Controller/Go.pm

package MyApp::Controller::Go;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for the internal Platform Short-Link management system.
#
# Features:
#   - Automatic redirection via /g/:keyword.
#   - Real-time visit analytics and popularity tracking.
#   - Administrative link management (Add, Edit, Delete).
#
# Integration Points:
#   - Depends on DB::Go for all persistent data operations.
#   - Restricted to system administrators for management functions.
#   - Resolution endpoint (/g/) is public by design.

# Renders the primary short-link management dashboard.
# Route: GET /go
# Returns: Template (go.html.ep)
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_admin;
    
    $c->render('go');
}

# Returns the complete state of the short-link registry.
# Route: GET /go/api/state
# Returns: JSON object { items, success }
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in && $c->is_admin;
    
    my $links = $c->db->get_go_links();
    
    $c->render(json => { 
        success => 1,
        items   => $links 
    });
}

# Resolves a short keyword and orchestrates the redirection.
# Route: GET /g/:keyword
# Returns: Redirect or Dashboard fallback
sub resolve {
    my $c = shift;
    my $keyword = lc(trim($c->param('keyword') // ''));
    
    my $link = $c->db->get_go_link($keyword);
    
    if ($link) {
        $c->db->increment_go_link_visits($link->{id});
        return $c->redirect_to($link->{url});
    }
    
    # Fallback: Return to management view with error context
    $c->redirect_to('/admin/go?error=1');
}

# Registers a new short-link redirection mapping.
# Route: POST /admin/go/api/add
# Returns: JSON object { success, message, error }
sub api_add {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in && $c->is_admin;

    my $keyword = lc(trim($c->param('keyword') // ''));
    my $url = trim($c->param('url') // '');
    my $description = trim($c->param('description') // '');
    my $user_id = $c->current_user_id;

    unless ($keyword && $url) {
        return $c->render(json => { success => 0, error => "Keyword and URL are required" });
    }

    # Verify keyword uniqueness
    my $existing = $c->db->get_go_link($keyword);
    if ($existing) {
        return $c->render(json => { success => 0, error => "Keyword 'g/$keyword' is already in use" });
    }

    if ($c->db->add_go_link($keyword, $url, $description, $user_id)) {
        $c->render(json => { success => 1, message => "Go link created" });
    } else {
        $c->render(json => { success => 0, error => "Database failure" });
    }
}

# Updates the metadata for an existing short-link record.
# Route: POST /admin/go/api/edit
# Returns: JSON object { success, message, error }
sub api_edit {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in && $c->is_admin;
    
    my $id = $c->param('id');
    my $keyword = lc(trim($c->param('keyword') // ''));
    my $url = trim($c->param('url') // '');
    my $description = trim($c->param('description') // '');

    unless ($id) {
        return $c->render(json => { success => 0, error => "ID is required" });
    }

    # Verify keyword uniqueness (excluding the current record)
    my $existing = $c->db->get_go_link($keyword);
    if ($existing && $existing->{id} != $id) {
        return $c->render(json => { success => 0, error => "Keyword 'g/$keyword' is already in use" });
    }

    if ($c->db->update_go_link($id, $keyword, $url, $description)) {
        $c->render(json => { success => 1, message => "Go link updated" });
    } else {
        $c->render(json => { success => 0, error => "Update failed" });
    }
}

# Permanently removes a short-link record from the system.
# Route: POST /admin/go/api/delete
# Returns: JSON object { success, message, error }
sub api_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) 
        unless $c->is_logged_in && $c->is_admin;
    
    my $id = $c->param('id');

    unless ($id) {
        return $c->render(json => { success => 0, error => "ID is required" });
    }

    if ($c->db->delete_go_link($id)) {
        $c->render(json => { success => 1, message => "Go link removed" });
    } else {
        $c->render(json => { success => 0, error => "Deletion failed" });
    }
}


sub register_routes {
    my ($class, $r) = @_;
    $r->{r}->get('/g/:keyword')->to('go#resolve');
    $r->{admin}->get('/go')->to('go#index');
    $r->{admin}->get('/go/api/state')->to('go#api_state');
    $r->{admin}->post('/go/api/add')->to('go#api_add');
    $r->{admin}->post('/go/api/edit')->to('go#api_edit');
    $r->{admin}->post('/go/api/delete')->to('go#api_delete');
}

1;
