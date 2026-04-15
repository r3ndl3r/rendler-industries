# /lib/MyApp/Controller/Admin/Notifications/Templates.pm

package MyApp::Controller::Admin::Notifications::Templates;

use Mojo::Base 'Mojolicious::Controller';
use strict;
use warnings;

# Controller for Notification Template Management.
# Restricted to Admin users via the $admin_ns bridge in MyApp.pm.
#
# Routes:
#   GET  /admin/notifications/templates          - Main UI
#   GET  /admin/notifications/templates/api/state - Fetch templates
#   POST /admin/notifications/templates/api/update - Save changes

# Renders the skeleton template for the SPA.
sub index {
    my $self = shift;
    return $self->redirect_to('/login') unless $self->is_logged_in;
    $self->render(template => 'admin/notifications/templates');
}

# Returns the current state of all templates from the DB.
sub api_state {
    my $self = shift;

    return unless $self->is_admin;

    my $templates = $self->db->get_notification_templates();

    $self->render(json => {
        templates => $templates,
        base_url  => $self->app->config->{url},
        success   => 1
    });
}

# Updates a specific template's content.
sub api_update {
    my $self = shift;

    return unless $self->is_admin;

    my $id      = $self->param('id');
    my $subject = $self->param('subject_template');
    my $body    = $self->param('body_template');

    unless ($id && $id =~ /^\d+$/ && defined $body && length($body) && defined $subject && length($subject)) {
        return $self->render(json => { success => 0, error => "Missing required fields" }, status => 400);
    }

    my $success = $self->db->update_notification_template($id, $subject, $body);

    $self->render(json => {
        success => $success ? 1 : 0,
        error   => $success ? undef : "Database update failed"
    });
}

1;
