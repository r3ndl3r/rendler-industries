# /lib/MyApp/Controller/Go.pm

package MyApp::Controller::Go;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);
use HTML::Entities qw(encode_entities);

# Controller for the internal "Go Links" URL shortener.
# Features:
#   - Redirection engine for short keywords
#   - Link lifecycle management (Add, Edit, Delete)
#   - Visit tracking delegation
# Integration points:
#   - Depends on authentication context for management actions
#   - Uses DB::Go helpers for persistence
#   - Handles dynamic routing via /g/:keyword

# Renders the go links management interface (Skeleton).
# Route: GET /go
# Parameters: None
# Returns: Rendered HTML template 'go'.
sub index {
    my $c = shift;
    
    # Handle AJAX state request
    if ($c->req->headers->header('X-Requested-With') && $c->req->headers->header('X-Requested-With') eq 'XMLHttpRequest') {
        return $c->api_state();
    }

    $c->render('go');
}

# Returns the complete state for the Go Links module.
# Route: GET /go/api/state
# Parameters: None
# Returns: JSON object { success, items }
sub api_state {
    my $c = shift;
    my $links = $c->db->get_go_links();
    $c->render(json => { success => 1, items => $links });
}

# Resolves a keyword and redirects the user to the destination URL.
# Route: GET /g/:keyword
# Parameters:
#   keyword : The short string mapped to the URL
# Returns:
#   HTTP 302 Redirect to destination
#   Redirects to management interface with error if not found
sub resolve {
    my $c = shift;
    my $keyword = lc(trim($c->param('keyword') // ''));
    
    my $link = $c->db->get_go_link($keyword);
    
    if ($link) {
        $c->db->increment_go_link_visits($link->{id});
        return $c->redirect_to($link->{url});
    }
    
    # Fallback: Redirect to Go dashboard with error
    $c->flash(error => "Go link 'go/$keyword' not found.");
    $c->redirect_to('/go');
}

# Adds a new go link to the system via AJAX.
# Route: POST /go/api/add
# Parameters:
#   keyword     : Short identifier
#   url         : Destination URL
#   description : Brief description
# Returns: JSON object { success, message }
sub add {
    my $c = shift;
    
    my $keyword     = lc(trim($c->param('keyword') // ''));
    my $url         = trim($c->param('url') // '');
    my $description = trim($c->param('description') // '');
    my $added_by    = $c->session('user') || 'System';
    
    # Logic: normalize keyword for URL safety
    $keyword =~ s/\s+/-/g;
    $keyword = encode_entities($keyword);
    $description = encode_entities($description);
    
    unless (length $keyword && length $url) {
        return $c->render(json => { success => 0, error => "Keyword and URL are required" });
    }
    
    # Context: ensure URL has a protocol scheme
    unless ($url =~ m{^https?://} || $url =~ m{^/}) {
        $url = "http://$url";
    }
    
    if ($c->db->get_go_link($keyword)) {
        return $c->render(json => { success => 0, error => "Keyword '$keyword' already exists" });
    }
    
    $c->db->add_go_link($keyword, $url, $description, $added_by);
    $c->render(json => { success => 1, message => "Go link '$keyword' created" });
}

# Updates an existing go link via AJAX.
# Route: POST /go/api/edit
# Parameters:
#   id          : Unique Link ID
#   keyword     : New short string
#   url         : New destination URL
#   description : New description
# Returns: JSON object { success, message }
sub edit {
    my $c = shift;
    
    my $id          = $c->param('id');
    my $keyword     = lc(trim($c->param('keyword') // ''));
    my $url         = trim($c->param('url') // '');
    my $description = trim($c->param('description') // '');
    
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => "Invalid ID" });
    }
    
    $keyword =~ s/\s+/-/g;
    
    unless (length $keyword && length $url) {
        return $c->render(json => { success => 0, error => "Keyword and URL are required" });
    }
    
    unless ($url =~ m{^https?://} || $url =~ m{^/}) {
        $url = "http://$url";
    }
    
    $c->db->update_go_link($id, $keyword, $url, $description);
    $c->render(json => { success => 1, message => "Go link updated" });
}

# Removes a single go link via AJAX.
# Route: POST /go/api/delete
# Parameters:
#   id : Unique ID of the link to delete
# Returns: JSON object { success, message }
sub delete {
    my $c = shift;
    my $id = $c->param('id');
    
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render(json => { success => 0, error => "Invalid ID" });
    }
    
    $c->db->delete_go_link($id);
    $c->render(json => { success => 1, message => "Go link deleted" });
}

1;