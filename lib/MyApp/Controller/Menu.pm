# /lib/MyApp/Controller/Menu.pm

package MyApp::Controller::Menu;
use Mojo::Base 'Mojolicious::Controller';

# Controller for managing the hierarchical navigation menu.
#
# Features:
#   - Synchronized state-driven interface for link management.
#   - Real-time drag-and-drop reordering with sort_order persistence.
#   - Role-based visibility and permission-level configuration.
#   - Cascaded deletion support for nested structures.
#
# Integration Points:
#   - Depends on DB::Menu for all hierarchical data persistence.
#   - Provides the data source for the global navigation sidebar.

# Renders the menu management interface skeleton.
# Route: GET /menu
sub manage {
    shift->render('menu');
}

# API Endpoint: Returns the full synchronized state for the menu module.
# Route: GET /menu/api/state
# Returns: JSON object { success, links, parents, is_admin }
sub api_state {
    my $c = shift;
    
    my $links = $c->db->get_all_menu_links();
    
    # Get possible parents (only top-level items can be parents for now)
    my @parents = grep { !$_->{parent_id} } @$links;
    
    $c->render(json => {
        success  => 1,
        links    => $links,
        parents  => \@parents,
        is_admin => $c->is_admin ? 1 : 0
    });
}

# API Endpoint: Creates a new menu link.
# Route: POST /menu/api/add
sub api_add {
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
    };

    if ($@) {
        $c->app->log->error("Failed to add menu link: $@");
        return $c->render(json => { success => 0, error => "Database failure" });
    }

    $c->render(json => { success => 1, message => 'Menu link created' });
}

# API Endpoint: Updates an existing menu link.
# Route: POST /menu/api/update
sub api_update {
    my $c = shift;
    my $id = $c->param('id');
    
    unless ($id) {
        return $c->render(json => { success => 0, error => 'ID is required' });
    }
    
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
    };

    if ($@) {
        $c->app->log->error("Failed to update menu link ($id): $@");
        return $c->render(json => { success => 0, error => "Update failed" });
    }

    $c->render(json => { success => 1, message => 'Menu link updated' });
}

# API Endpoint: Permanently removes a menu link.
# Route: POST /menu/api/delete
sub api_delete {
    my $c = shift;
    my $id = $c->param('id');

    unless ($id) {
        return $c->render(json => { success => 0, error => 'ID is required' });
    }

    eval {
        $c->db->delete_menu_link($id);
    };

    if ($@) {
        $c->app->log->error("Failed to delete menu link ($id): $@");
        return $c->render(json => { success => 0, error => "Deletion failed" });
    }

    $c->render(json => { success => 1, message => 'Menu link removed' });
}

# API Endpoint: Bulk updates sort order.
# Route: POST /menu/api/reorder
sub api_reorder {
    my $c = shift;
    my $json = $c->req->json;
    my $orders = $json ? $json->{orders} : undef;

    unless ($orders) {
        return $c->render(json => { success => 0, error => 'Order data missing' });
    }

    eval {
        foreach my $id (keys %$orders) {
            $c->db->update_menu_order($id, $orders->{$id});
        }
    };

    if ($@) {
        $c->app->log->error("Failed to reorder menu: $@");
        return $c->render(json => { success => 0, error => "Reorder failed" });
    }

    $c->render(json => { success => 1, message => 'Menu sequence updated' });
}

# API Endpoint: Retrieves the hierarchical menu tree for the current user.
# Route: GET /menu/api/menubar
# Returns: JSON object containing 'menu' tree, 'is_logged_in', and 'is_admin' flags.
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
