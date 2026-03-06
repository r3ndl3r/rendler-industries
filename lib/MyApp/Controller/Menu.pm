# /lib/MyApp/Controller/Menu.pm

package MyApp::Controller::Menu;
use Mojo::Base 'Mojolicious::Controller';

# Controller for Dynamic Menu Management and Navigation.
# Handles the administrative interface and API for real-time menu configuration.
#
# Features:
#   - Hierarchical menu management (Drag & Drop nesting).
#   - Real-time link CRUD operations.
#   - AJAX-based visibility and reordering.
#   - Permission-based navigation rendering.
#
# Integration Points:
#   - DB.pm (get_menu_tree) for global helper rendering.
#   - MyApp::Plugin::Icons for semantic navigation icons.
#   - Restricted to 'admin' bridge via router.

# Renders the main menu management interface.
# Route: GET /menu
# Parameters: None
# Returns:
#   Rendered HTML template 'menu/manage' with active links.
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
# Route: POST /menu/add
# Parameters (POST):
#   - label            : Display text.
#   - is_separator     : Boolean (1 for horizontal line).
#   - url              : Destination URL (Defaults to '#').
#   - icon             : Semantic icon key.
#   - parent_id        : (Optional) ID of parent link for nesting.
#   - sort_order       : Integer for display position.
#   - permission_level : Role (guest/user/family/admin).
#   - css_class        : (Optional) Custom styling classes.
#   - target           : Link target ('_self' or '_blank').
#   - is_active        : Boolean (Defaults to 1).
# Returns:
#   JSON success/error status with message.
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
        $c->render(json => { success => 1, message => 'Menu link created successfully' });
    };

    if ($@) {
        $c->app->log->error("Failed to add menu link: $@");
        $c->render(json => { success => 0, error => "Database error: $@" });
    }
}

# API Endpoint: Updates an existing menu link.
# Route: POST /menu/update
# Parameters (POST):
#   - id : Unique link ID (Required).
#   - (Other parameters matching 'add').
# Returns:
#   JSON success/error status with message.
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
        $c->render(json => { success => 1, message => 'Menu link updated successfully' });
    };

    if ($@) {
        $c->app->log->error("Failed to update menu link ($id): $@");
        $c->render(json => { success => 0, error => "Database error: $@" });
    }
}

# API Endpoint: Deletes a menu link and its children.
# Route: POST /menu/delete
# Parameters:
#   - id : Unique link ID (Required).
# Returns:
#   JSON success/error status with message.
sub delete {
    my $c = shift;
    my $id = $c->param('id');

    return $c->render(json => { success => 0, error => 'ID is required' })
        unless $id;

    eval {
        $c->db->delete_menu_link($id);
        $c->render(json => { success => 1, message => 'Menu link deleted successfully' });
    };

    if ($@) {
        $c->app->log->error("Failed to delete menu link ($id): $@");
        $c->render(json => { success => 0, error => "Database error: $@" });
    }
}

# API Endpoint: Bulk updates sort order for drag-and-drop management.
# Route: POST /menu/reorder
# Parameters (JSON POST):
#   - orders : HashRef of { id => sort_order_integer }
# Returns:
#   JSON success/error status with message.
sub reorder {
    my $c = shift;
    my $orders = $c->req->json->{orders};

    eval {
        foreach my $id (keys %$orders) {
            $c->db->update_menu_order($id, $orders->{$id});
        }
        $c->render(json => { success => 1, message => 'Menu reordered successfully' });
    };

    if ($@) {
        $c->app->log->error("Failed to reorder menu: $@");
        $c->render(json => { success => 0, error => "Database error: $@" });
    }
}

# API Endpoint: Retrieves the hierarchical menu tree for the current user.
# Route: GET /menu/api/state
# Parameters: None (Uses session for permissions).
# Returns:
#   JSON object containing 'menu' tree, 'is_logged_in', and 'is_admin' flags.
sub get_state {
    my $c = shift;
    
    my $permission = 'guest';
    if ($c->is_admin) {
        $permission = 'admin';
    } elsif ($c->is_family) {
        $permission = 'family';
    } elsif ($c->is_logged_in) {
        $permission = 'user';
    }
    
    my $menu_tree = $c->db->get_menu_tree($permission);
    
    # Map permission levels to icons for the frontend
    foreach my $item (@$menu_tree) {
        _enrich_menu_item($item);
    }

    $c->render(json => {
        success      => 1,
        menu         => $menu_tree,
        is_logged_in => $c->is_logged_in,
        is_admin     => $c->is_admin,
        current_path => $c->url_for->path->to_string
    });
}

# Recursively enrich menu items with icons and metadata for frontend rendering.
sub _enrich_menu_item {
    my $item = shift;
    
    # Map database permission levels to semantic icon keys
    $item->{perm_icon} = ($item->{url} && $item->{url} ne '#') 
        ? 'perm_' . ($item->{permission_level} // 'user') 
        : '';
        
    if ($item->{children} && @{$item->{children}}) {
        foreach my $child (@{$item->{children}}) {
            _enrich_menu_item($child);
        }
    }
}

1;
