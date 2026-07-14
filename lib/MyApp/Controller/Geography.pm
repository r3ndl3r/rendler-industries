package MyApp::Controller::Geography;
use Mojo::Base 'Mojolicious::Controller';

# Renders the geography quiz page skeleton.
# Route: GET /geography
# Returns: Rendered HTML template
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render('geography');
}

# Registers geography module routes under the authenticated scope.
sub register_routes {
    my ($class, $r) = @_;
    $r->{auth}->get('/geography')->to('geography#index');
}

1;
