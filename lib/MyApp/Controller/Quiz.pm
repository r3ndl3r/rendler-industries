# /lib/MyApp/Controller/Quiz.pm

package MyApp::Controller::Quiz;
use Mojo::Base 'Mojolicious::Controller';
use Mojo::File qw(path);
use Mojo::JSON qw(decode_json);

# Controller for the Australian Citizenship Quiz feature.
# Features:
#   - Renders the quiz user interface for standard and master modes
#   - Serves quiz data from the JSON asset file with optional slicing
#   - Handles quiz logic endpoints
# Integration points:
#   - Relies on the existence of /assets/citizenship_quiz.json
#   - Integration with routes: /quiz and /quiz/all

# Renders the main quiz interface.
# Route: GET /quiz OR /quiz/all
# Parameters: None
# Returns:
#   Rendered HTML template 'quiz'
sub index {
    my $c = shift;
    # Render the root quiz template
    # JavaScript handles logic for /all mode detection via URL path
    $c->render(template => 'quiz/questions');
}

# API Endpoint to retrieve quiz questions.
# Route: GET /quiz/api/questions
# Parameters: 
#   mode : string ('all' to skip 20-question limit)
# Returns:
#   JSON object containing the list of questions
#   Returns 500 status if the asset file is missing
sub get_questions {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;
    
    # Retrieve the mode from query parameters to determine question count
    my $mode = $c->param('mode') // 'default';
    
    # Locate the JSON asset file relative to the application home
    my $json_path = $c->app->home->child('assets', 'citizenship_quiz.json');
    
    # Fail gracefully if the file does not exist
    unless (-e $json_path) {
        $c->app->log->error("Quiz asset not found at: $json_path");
        return $c->render(json => { error => 'Quiz data not available' }, status => 500);
    }
    
    # Read and decode the JSON data
    my $json_content = path($json_path)->slurp;
    my $questions = decode_json($json_content);
    
    # Randomize questions server-side to ensure variety on every load
    my @shuffled = sort { int(rand(3)) - 1 } @$questions;
    
    # Apply 20-question slice only if NOT in 'all' mode
    # This supports the Master Mode requirement for the full 151 questions
    unless ($mode eq 'all') {
        @shuffled = splice(@shuffled, 0, 20);
    }
    
    $c->render(json => { success => 1, questions => \@shuffled });
}

# Renders the study mode interface with all answers visible.
# Route: GET /quiz/study
# Parameters: None
# Returns:
#   Rendered HTML template 'quiz/study'
sub study_mode {
    my $c = shift;
    $c->render(template => 'quiz/study');
}

# Renders the custom study interface filtered to the user's saved question list.
# Route: GET /quiz/study/custom
# Parameters: None
# Returns:
#   Rendered HTML template 'quiz/custom_study', or redirect to /login
sub custom_study {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render(template => 'quiz/study/custom');
}

# Builds the state payload for the custom study page.
# Loads the JSON asset, fetches the user's saved indices, and returns
# both the selected study questions and the full annotated question list
# for the management modal.
# Parameters:
#   c         : Mojolicious controller
#   user_id   : Authenticated user ID
#   questions : (Optional) Pre-loaded questions ArrayHash
# Returns:
#   HashRef { study_questions, all_questions, count } or undef on asset error
sub _build_custom_state {
    my ($c, $user_id, $questions) = @_;

    unless ($questions) {
        my $json_path = $c->app->home->child('assets', 'citizenship_quiz.json');
        unless (-e $json_path) {
            $c->app->log->error("Quiz asset not found at: $json_path");
            return undef;
        }
        $questions = decode_json(path($json_path)->slurp);
    }

    my $selected     = $c->db->get_custom_quiz_list($user_id);
    my %selected_set = map { $_ => 1 } @$selected;

    my @all_questions = map {
        +{ %{ $questions->[$_] }, question_index => $_, in_list => $selected_set{$_} ? 1 : 0 }
    } 0 .. $#$questions;

    # Filter out any indices that might be stale if the asset changed
    my @study_questions = map { $questions->[$_] } grep { defined $questions->[$_] } @$selected;

    return {
        study_questions => \@study_questions,
        all_questions   => \@all_questions,
        count           => scalar @$selected,
    };
}

# Returns the current custom study state for the authenticated user.
# Route: GET /quiz/api/custom/state
# Parameters: None
# Returns:
#   JSON { success, study_questions, all_questions, count }
sub api_custom_state {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $state = _build_custom_state($c, $c->current_user_id);
    return $c->render(json => { success => 0, error => 'Quiz data not available' }, status => 500) unless $state;

    $c->render(json => { success => 1, %$state });
}

# Adds a question to the user's custom study list.
# Route: POST /quiz/api/custom/add
# Parameters:
#   question_index : Integer (0–150)
# Returns:
#   JSON { success, study_questions, all_questions, count }
sub api_custom_add {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id        = $c->current_user_id;
    my $question_index = $c->param('question_index') // '';

    # Load asset once for validation and state building
    my $json_path = $c->app->home->child('assets', 'citizenship_quiz.json');
    return $c->render(json => { success => 0, error => 'Quiz asset missing' }, status => 500) unless -e $json_path;
    my $questions = decode_json(path($json_path)->slurp);

    unless ($question_index =~ /^\d+$/ && $question_index >= 0 && $question_index <= $#$questions) {
        return $c->render(json => { success => 0, error => 'Invalid question index' });
    }

    eval { $c->db->add_custom_quiz_question($user_id, $question_index + 0) };
    if ($@) {
        $c->app->log->error("Failed to add custom quiz question: $@");
        return $c->render(json => { success => 0, error => 'Database synchronization failure' });
    }

    my $state = _build_custom_state($c, $user_id, $questions);
    return $c->render(json => { success => 0, error => 'State assembly failed' }, status => 500) unless $state;
    $c->render(json => { success => 1, %$state });
}

# Removes a question from the user's custom study list.
# Route: POST /quiz/api/custom/remove
# Parameters:
#   question_index : Integer (0–150)
# Returns:
#   JSON { success, study_questions, all_questions, count }
sub api_custom_remove {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_logged_in;

    my $user_id        = $c->current_user_id;
    my $question_index = $c->param('question_index') // '';

    # Load asset once for validation and state building
    my $json_path = $c->app->home->child('assets', 'citizenship_quiz.json');
    return $c->render(json => { success => 0, error => 'Quiz asset missing' }, status => 500) unless -e $json_path;
    my $questions = decode_json(path($json_path)->slurp);

    unless ($question_index =~ /^\d+$/ && $question_index >= 0 && $question_index <= $#$questions) {
        return $c->render(json => { success => 0, error => 'Invalid question index' });
    }

    eval { $c->db->remove_custom_quiz_question($user_id, $question_index + 0) };
    if ($@) {
        $c->app->log->error("Failed to remove custom quiz question: $@");
        return $c->render(json => { success => 0, error => 'Database synchronization failure' });
    }

    my $state = _build_custom_state($c, $user_id, $questions);
    return $c->render(json => { success => 0, error => 'State assembly failed' }, status => 500) unless $state;
    $c->render(json => { success => 1, %$state });
}


# Renders the printer-friendly custom study list with no images or pagination.
# Route: GET /quiz/study/custom/print
# Parameters: None
# Returns:
#   Rendered HTML template 'quiz/custom_study_print', or redirect to /login
sub custom_study_print {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    $c->render(template => 'quiz/study/custom/print');
}

sub register_routes {
    my ($class, $r) = @_;
    $r->{r}->get('/quiz')->to('quiz#index');
    $r->{r}->get('/quiz/all')->to('quiz#index', mode => 'all');
    $r->{r}->get('/quiz/study')->to('quiz#study_mode');
    $r->{r}->get('/quiz/study/custom')->to('quiz#custom_study');
    $r->{r}->get('/quiz/study/custom/print')->to('quiz#custom_study_print');
    $r->{r}->get('/quiz/api/questions')->to('quiz#get_questions');
    $r->{r}->get('/quiz/api/custom/state')->to('quiz#api_custom_state');
    $r->{r}->post('/quiz/api/custom/add')->to('quiz#api_custom_add');
    $r->{r}->post('/quiz/api/custom/remove')->to('quiz#api_custom_remove');
}

1;
