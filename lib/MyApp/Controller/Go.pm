# /lib/MyApp/Controller/Go.pm

package MyApp::Controller::Go;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for the Platform Short-Link management system.
# Features:
#   - Automatic redirection via /g/:keyword
#   - Real-time visit tracking and analytics
#   - Administrative link management (Add, Edit, Delete)
# Integration points:
#   - Depends on DB::Go for data persistence.
#   - Accessible only to users with appropriate authorization.

# Renders the primary management interface.
# Route: GET /go
sub index {
    my $c = shift;
    return $c->redirect_to('/auth') unless $c->is_admin;
    $c->stash(title => 'Go Links');
    $c->render('go');
}

# Returns the complete state of the short-link collection.
# Route: GET /go/api/state
sub api_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    
    my $links = $c->db->get_go_links();
    
    $c->render(json => { 
        success => 1,
        items   => $links 
    });
}

# Resolves a short keyword and redirects to the target destination.
# Route: GET /g/:keyword
# Public Route: No authentication required.
sub resolve {
    my $c = shift;
    my $keyword = lc(trim($c->param('keyword') // ''));
    
    my $link = $c->db->get_go_link($keyword);
    
    if ($link) {
        $c->db->increment_go_link_visits($link->{id});
        return $c->redirect_to($link->{url});
    }
    
    # Fallback: Return to dashboard with error flag
    $c->redirect_to('/go?error=1');
}
# Registers a new redirection mapping.
# Route: POST /go/api/add
sub api_add {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;

    my $keyword = lc(trim($c->param('keyword') // ''));
    my $url = trim($c->param('url') // '');
    my $description = trim($c->param('description') // '');
    my $user_id = $c->current_user_id;

    unless ($keyword && $url) {
        return $c->render(json => { success => 0, error => "Keyword and URL are required" });
    }

    eval {
        $c->db->add_go_link($keyword, $url, $description, $user_id);
        $c->render(json => { success => 1, message => "Go link created" });
    };

    if ($@) {
        $c->app->log->error("Go addition failure: $@");
        $c->render(json => { success => 0, error => "Database failure" });
    }
}

# Updates an existing redirection mapping.
# Route: POST /go/api/edit
sub api_edit {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    
    my $id = $c->param('id');
    my $keyword = lc(trim($c->param('keyword') // ''));
    my $url = trim($c->param('url') // '');
    my $description = trim($c->param('description') // '');

    unless ($id) {
        return $c->render(json => { success => 0, error => "ID is required" });
    }

    my $success = $c->db->update_go_link($id, $keyword, $url, $description);
    
    if ($success) {
        $c->render(json => { success => 1, message => "Go link updated" });
    } else {
        $c->render(json => { success => 0, error => "Update failed" });
    }
}

# Removes a redirection record from the system.
# Route: POST /go/api/delete
sub api_delete {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    
    my $id = $c->param('id');

    unless ($id) {
        return $c->render(json => { success => 0, error => "ID is required" });
    }

    my $success = $c->db->delete_go_link($id);
    
    if ($success) {
        $c->render(json => { success => 1, message => "Go link removed" });
    } else {
        $c->render(json => { success => 0, error => "Deletion failed" });
    }
}

1;
