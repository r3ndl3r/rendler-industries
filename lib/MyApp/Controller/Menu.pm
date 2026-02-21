# /lib/MyApp/Controller/Menu.pm

package MyApp::Controller::Menu;
use Mojo::Base 'Mojolicious::Controller';

# Menu Controller
# Handles the administrative interface and API for dynamic menu management.
# Features:
#   - Hierarchical menu management (Drag & Drop)
#   - Link CRUD operations
#   - AJAX-based visibility and reordering

# Renders the main menu management interface.
# Parameters: None
# Returns:
#   Renders 'menu/manage' template with links and potential parents.
sub manage {
    my $c = shift;
    
    my $links = $c->db->get_all_menu_links();
    
    # Get possible parents (only top-level items can be parents for now)
    my $parents = [ grep { !$_->{parent_id} } @$links ];
    
    $c->stash(
        links   => $links,
        parents => $parents,
        title   => 'Manage Menu'
    );
    
    $c->render('menu/manage');
}

# API Endpoint: Adds a new menu link.
# Parameters (POST):
#   label            : Display text
#   url              : Destination URL
#   icon             : Icon class/key
#   parent_id        : Parent item ID (if nested)
#   sort_order       : Display position
#   permission_level : Visibility role (guest/user/admin)
#   css_class        : Custom styling class
#   target           : Link target (_self/_blank)
#   is_active        : Boolean
# Returns:
#   JSON: { success => 1 } or { success => 0, error => $msg }
sub add {
    my $c = shift;
    
    my $data = {
        label            => $c->param('label'),
        is_separator     => $c->param('is_separator') ? 1 : 0,
        url              => $c->param('url') // '#',
        icon             => $c->param('icon') // '',
        parent_id        => $c->param('parent_id') || undef,
        sort_order       => $c->param('sort_order') // 0,
        permission_level => $c->param('permission_level') // 'user',
        css_class        => $c->param('css_class') // '',
        target           => $c->param('target') // '_self',
        is_active        => $c->param('is_active') // 1
    };

    eval {
        $c->db->add_menu_link($data);
        $c->render(json => { success => 1 });
    };

    if ($@) {
        $c->app->log->error("Failed to add menu link: $@");
        $c->render(json => { success => 0, error => "Database error: $@" });
    }
}

# API Endpoint: Updates an existing menu link.
# Parameters (POST):
#   id               : Link ID (Required)
#   label            : Display text
#   ... (other attributes same as add)
# Returns:
#   JSON: { success => 1 } or { success => 0, error => $msg }
sub update {
    my $c = shift;
    my $id = $c->param('id');
    
    return $c->render(json => { success => 0, error => 'ID is required' })
        unless $id;
    
    my $data = {
        label            => $c->param('label'),
        is_separator     => $c->param('is_separator') ? 1 : 0,
        url              => $c->param('url'),
        icon             => $c->param('icon'),
        parent_id        => $c->param('parent_id') || undef,
        sort_order       => $c->param('sort_order'),
        permission_level => $c->param('permission_level'),
        css_class        => $c->param('css_class'),
        target           => $c->param('target'),
        is_active        => $c->param('is_active')
    };

    eval {
        $c->db->update_menu_link($id, $data);
        $c->render(json => { success => 1 });
    };

    if ($@) {
        $c->app->log->error("Failed to update menu link ($id): $@");
        $c->render(json => { success => 0, error => "Database error: $@" });
    }
}

# API Endpoint: Deletes a menu link.
# Parameters (POST):
#   id : Link ID (Required)
# Returns:
#   JSON: { success => 1 } or { success => 0, error => $msg }
sub delete {
    my $c = shift;
    my $id = $c->param('id');

    return $c->render(json => { success => 0, error => 'ID is required' })
        unless $id;

    eval {
        $c->db->delete_menu_link($id);
        $c->render(json => { success => 1 });
    };

    if ($@) {
        $c->app->log->error("Failed to delete menu link ($id): $@");
        $c->render(json => { success => 0, error => "Database error: $@" });
    }
}

# API Endpoint: Bulk updates sort order for drag-and-drop.
# Parameters (JSON POST):
#   orders : HashRef of { id => order }
# Returns:
#   JSON: { success => 1 } or { success => 0, error => $msg }
sub reorder {
    my $c = shift;
    my $orders = $c->req->json->{orders};

    eval {
        foreach my $id (keys %$orders) {
            $c->db->update_menu_order($id, $orders->{$id});
        }
        $c->render(json => { success => 1 });
    };

    if ($@) {
        $c->app->log->error("Failed to reorder menu: $@");
        $c->render(json => { success => 0, error => "Database error: $@" });
    }
}

1;
