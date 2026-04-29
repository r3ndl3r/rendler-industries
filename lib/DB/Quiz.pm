# /lib/DB/Quiz.pm

package DB::Quiz;

use strict;
use warnings;

# Database helper for user-specific quiz custom study lists.
# Features:
#   - Per-user custom question list management
#   - Atomic add/remove via INSERT IGNORE / DELETE
# Integration points:
#   - Extends DB package via package injection
#   - Scoped by user_id for strict data privacy

# Retrieves the ordered list of question indices in the user's custom list.
# Parameters:
#   user_id : Unique identifier for the user
# Returns:
#   ArrayRef of integers (0-based question indices)
sub DB::get_custom_quiz_list {
    my ($self, $user_id) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("
        SELECT question_index
        FROM quiz_custom_questions
        WHERE user_id = ?
        ORDER BY id ASC
    ");
    $sth->execute($user_id);

    return [ map { $_->[0] } @{ $sth->fetchall_arrayref() } ];
}

# Adds a question index to the user's custom list.
# Silently ignores duplicates via INSERT IGNORE.
# Parameters:
#   user_id        : Unique identifier for the user
#   question_index : 0-based index of the question in the JSON asset
# Returns:
#   Integer rows affected (1 = inserted, 0 = already present)
sub DB::add_custom_quiz_question {
    my ($self, $user_id, $question_index) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("
        INSERT IGNORE INTO quiz_custom_questions (user_id, question_index)
        VALUES (?, ?)
    ");
    $sth->execute($user_id, $question_index);

    return $sth->rows;
}

# Removes a question index from the user's custom list.
# Parameters:
#   user_id        : Unique identifier for the user
#   question_index : 0-based index of the question in the JSON asset
# Returns:
#   Integer rows affected (1 = removed, 0 = not found)
sub DB::remove_custom_quiz_question {
    my ($self, $user_id, $question_index) = @_;
    $self->ensure_connection;

    my $sth = $self->{dbh}->prepare("
        DELETE FROM quiz_custom_questions
        WHERE user_id = ? AND question_index = ?
    ");
    $sth->execute($user_id, $question_index);

    return $sth->rows;
}

1;
