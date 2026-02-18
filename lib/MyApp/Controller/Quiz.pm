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
# Route: GET /api/quiz/questions
# Parameters: 
#   mode : string ('all' to skip 20-question limit)
# Returns:
#   JSON object containing the list of questions
#   Returns 500 status if the asset file is missing
sub get_questions {
    my $c = shift;
    
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
    
    $c->render(json => \@shuffled);
}

# Renders the study mode interface with all answers visible.
# Route: GET /quiz/answers
# Parameters: None
# Returns:
#   Rendered HTML template 'quiz_study'
sub study_mode {
    my $c = shift;
    $c->render(template => 'quiz/study');
}

1;