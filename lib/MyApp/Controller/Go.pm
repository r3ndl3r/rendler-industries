# /lib/MyApp/Controller/Go.pm

package MyApp::Controller::Go;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::Util qw(trim);

# Controller for the internal "Go Links" URL shortener.
# Features:
#   - Redirection engine for short keywords
#   - Link lifecycle management (Add, Edit, Delete)
#   - Visit tracking delegation
# Integration points:
#   - Depends on authentication context for management actions
#   - Uses DB::Go helpers for persistence
#   - Handles dynamic routing via /g/:keyword

# Renders the go links management interface.
# Route: GET /go
# Parameters: None
# Returns:
#   Rendered HTML template 'go/list' with active links
sub index {
    my $c = shift;
    
    # Retrieve current list state
    my $links = $c->db->get_go_links();
    
    $c->stash(
        links => $links,
        username => $c->session('user')
    );
    
    $c->render('go');
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
    
    # Extract and normalize the keyword
    my $keyword = trim($c->param('keyword') // '');
    $keyword = lc($keyword);
    
    my $link = $c->db->get_go_link($keyword);
    
    if ($link) {
        # Increment visits
        $c->db->increment_go_link_visits($link->{id});
        
        # Perform the actual redirection
        return $c->redirect_to($link->{url});
    }
    
    # Fallback if keyword does not exist
    $c->flash(error => "Go link 'go/$keyword' not found.");
    $c->redirect_to('/go');
}

# Adds a new go link to the system.
# Route: POST /go/add
# Parameters:
#   keyword     : Short identifier (max 50 chars, no spaces)
#   url         : Destination URL
#   description : Brief description of the target
# Returns:
#   Redirects to list view
#   Renders error on validation failure
sub add {
    my $c = shift;
    
    my $keyword     = trim($c->param('keyword') // '');
    my $url         = trim($c->param('url') // '');
    my $description = trim($c->param('description') // '');
    my $added_by    = $c->session('user') || 'System';
    
    # Normalize keyword (lowercase, replace spaces with hyphens)
    $keyword = lc($keyword);
    $keyword =~ s/\s+/-/g;
    
    # Basic validation
    unless (length $keyword && length $url) {
        return $c->render_error('Keyword and URL are strictly required');
    }
    
    # Ensure URL has a scheme if missing
    unless ($url =~ m{^https?://} || $url =~ m{^/}) {
        $url = "http://$url";
    }
    
    # Check for duplicates before inserting
    if ($c->db->get_go_link($keyword)) {
        $c->flash(error => "Keyword '$keyword' already exists.");
        return $c->redirect_to('/go');
    }
    
    # Execute insertion
    $c->db->add_go_link($keyword, $url, $description, $added_by);
    $c->redirect_to('/go');
}

# Updates an existing go link.
# Route: POST /go/edit
# Parameters:
#   id          : Unique Link ID
#   keyword     : New short string
#   url         : New destination URL
#   description : New description
# Returns:
#   Redirects to list view
#   Renders error on validation failure
sub edit {
    my $c = shift;
    
    my $id          = $c->param('id');
    my $keyword     = trim($c->param('keyword') // '');
    my $url         = trim($c->param('url') // '');
    my $description = trim($c->param('description') // '');
    
    # Validate ID format
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render_error('Invalid link ID');
    }
    
    $keyword = lc($keyword);
    $keyword =~ s/\s+/-/g;
    
    unless (length $keyword && length $url) {
        return $c->render_error('Keyword and URL are strictly required');
    }
    
    unless ($url =~ m{^https?://} || $url =~ m{^/}) {
        $url = "http://$url";
    }
    
    # Execute update
    $c->db->update_go_link($id, $keyword, $url, $description);
    $c->redirect_to('/go');
}

# Removes a single go link.
# Route: POST /go/delete
# Parameters:
#   id : Unique ID of the link to delete
# Returns:
#   Redirects to list view
sub delete {
    my $c = shift;
    
    my $id = $c->param('id');
    
    # Validate ID format
    unless (defined $id && $id =~ /^\d+$/) {
        return $c->render_error('Invalid link ID');
    }
    
    # Execute deletion
    $c->db->delete_go_link($id);
    $c->redirect_to('/go');
}

1;