# /lib/DB/Menu.pm

package DB::Menu;

use strict;
use warnings;
use utf8;

# Database helper for Dynamic Menu Management.
# Features:
#   - Hierarchical menu structure (Parent/Child)
#   - Role-based visibility filtering
#   - Custom sorting and CSS class injection
#   - AJAX-ready reordering support
# Integration points:
#   - Extends DB package via package injection
#   - Used by menubar.html.ep for rendering
#   - Used by Controller/Menu.pm for administration

# Retrieves the hierarchical menu structure filtered by permission.
# Parameters:
#   $permission : Current user level ('guest', 'user', 'admin')
# Returns:
#   ArrayRef of HashRefs containing nested menu items
sub DB::get_menu_tree {
    my ($self, $permission) = @_;
    $self->ensure_connection;

    # Logic to determine which levels are visible
    # admin sees everything; user sees guest+user; guest sees guest.
    my @allowed_levels = ('guest');
    push @allowed_levels, 'user' if $permission eq 'user' || $permission eq 'admin';
    push @allowed_levels, 'admin' if $permission eq 'admin';
    
    my $placeholders = join ',', map { '?' } @allowed_levels;

    my $sql = "SELECT * FROM menu_links 
               WHERE is_active = 1 
               AND permission_level IN ($placeholders)
               ORDER BY parent_id ASC, sort_order ASC";
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(@allowed_levels);
    my $links = $sth->fetchall_arrayref({});

    # Build the tree
    my %lookup;
    my @tree;

    # First pass: Create lookup and initialize children arrays
    foreach my $link (@$links) {
        # Explicitly decode UTF8 from DB to ensure emojis work
        utf8::decode($link->{label}) if $link->{label};
        $link->{children} = [];
        $lookup{$link->{id}} = $link;
    }

    # Second pass: Associate children with parents
    foreach my $link (@$links) {
        if ($link->{parent_id} && $lookup{$link->{parent_id}}) {
            push @{$lookup{$link->{parent_id}}->{children}}, $link;
        } else {
            push @tree, $link;
        }
    }

    return \@tree;
}

# Retrieves all menu links in a flat list for management.
# Child items are sorted directly under their parents.
# Parameters: None
# Returns:
#   ArrayRef of HashRefs
sub DB::get_all_menu_links {
    my ($self) = @_;
    $self->ensure_connection;

    # Smart sort: 
    # 1. Group by parent's sort_order (or own if top-level)
    # 2. Put parent before its children
    # 3. Sort children by their own sort_order
    my $sql = "SELECT m.*, p.label as parent_label 
               FROM menu_links m 
               LEFT JOIN menu_links p ON m.parent_id = p.id
               ORDER BY IFNULL(p.sort_order, m.sort_order) ASC, 
                        m.parent_id IS NOT NULL, 
                        m.sort_order ASC";
               
    my $links = $self->{dbh}->selectall_arrayref($sql, { Slice => {} });

    # Decode UTF8 for labels
    foreach my $link (@$links) {
        utf8::decode($link->{label}) if $link->{label};
        utf8::decode($link->{parent_label}) if $link->{parent_label};
    }

    return $links;
}

# Adds a new menu link entry.
# Parameters:
#   $data : HashRef containing link attributes
# Returns:
#   Last inserted ID
sub DB::add_menu_link {
    my ($self, $data) = @_;
    $self->ensure_connection;

    my $sql = "INSERT INTO menu_links 
               (label, is_separator, url, icon, parent_id, sort_order, permission_level, css_class, target, is_active) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(
        $data->{label},
        $data->{is_separator} // 0,
        $data->{url} // '#',
        $data->{icon} // '',
        $data->{parent_id},
        $data->{sort_order} // 0,
        $data->{permission_level} // 'user',
        $data->{css_class} // '',
        $data->{target} // '_self',
        $data->{is_active} // 1
    );

    return $self->{dbh}->last_insert_id();
}

# Updates an existing menu link.
# Parameters:
#   $id   : Record ID
#   $data : HashRef of updated attributes
# Returns: Void
sub DB::update_menu_link {
    my ($self, $id, $data) = @_;
    $self->ensure_connection;

    my $sql = "UPDATE menu_links SET 
               label = ?, is_separator = ?, url = ?, icon = ?, parent_id = ?, 
               sort_order = COALESCE(?, sort_order), permission_level = ?, css_class = ?, 
               target = ?, is_active = ? 
               WHERE id = ?";
               
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(
        $data->{label},
        $data->{is_separator},
        $data->{url},
        $data->{icon},
        $data->{parent_id},
        $data->{sort_order},
        $data->{permission_level},
        $data->{css_class},
        $data->{target},
        $data->{is_active},
        $id
    );
}

# Deletes a menu link (Child links cascade delete via DB constraint).
# Parameters:
#   $id : Record ID
# Returns: Void
sub DB::delete_menu_link {
    my ($self, $id) = @_;
    $self->ensure_connection;

    $self->{dbh}->do("DELETE FROM menu_links WHERE id = ?", undef, $id);
}

# Quickly updates the sort order of a link (for drag-and-drop).
# Parameters:
#   $id    : Record ID
#   $order : New sort position
# Returns: Void
sub DB::update_menu_order {
    my ($self, $id, $order) = @_;
    $self->ensure_connection;

    $self->{dbh}->do("UPDATE menu_links SET sort_order = ? WHERE id = ?", undef, $order, $id);
}

1;
