# /lib/DB/Notifications/Templates.pm

package DB::Notifications::Templates;

use strict;
use warnings;
use Mojo::JSON qw(encode_json);

# Database Library for Notification Templates Management.
#
# Features:
#   - Dynamic rendering of notification content via [bracket] tags.
#   - Automatic synchronization with application MANIFEST contracts.
#   - Support for deprecated keys and live preview data.

# Resolves a template_key + data hashref into a rendered { subject, body } pair.
# Falls back to a raw JSON dump if the key is missing from the DB.
# Emits a warning for deprecated keys so callers can be migrated without silent failures.
#
# Parameters:
#   $key  - A MANIFEST template key string (e.g., 'chore_complete').
#   $data - HashRef of substitution values matching the key's available_tags.
#
# Returns: HashRef with 'subject' and 'body' string keys, always populated.
sub DB::render_template {
    my ($self, $key, $data, $base_url) = @_;
    $self->ensure_connection;

    my $tmpl = $self->{dbh}->selectrow_hashref(
        "SELECT subject_template, body_template, is_deprecated
         FROM notification_templates WHERE template_key = ?",
        undef, $key
    );

    # Fallback to raw data dump if the template key is not in the DB at all
    return { subject => "Missing: $key", body => encode_json($data) } unless $tmpl;

    # Deprecated key guard: the caller should be migrated to a current key
    if ($tmpl->{is_deprecated}) {
        warn "[Notifications] render_template called with deprecated key '$key'";
    }

    my ($subj, $body) = ($tmpl->{subject_template} // '', $tmpl->{body_template} // '');
    $base_url //= '';

    # Global Tag: [sys_url] (always available, no caller setup required)
    # Supports optional paths: [sys_url /path/to/page]
    foreach my $target ($subj, $body) {
        $target =~ s{\[sys_url\s+([^\]]+)\]}{
            do {
                my $path = $1;
                # Allow only safe relative paths: leading slash, alphanum/hyphen/underscore/dot
                $path =~ s{[^a-zA-Z0-9/_\-\.]}{}g;
                $base_url . $path
            }
        }ge;
        $target =~ s/\[sys_url\]/$base_url/g;
    }

    # Literal substitution: \Q...\E quotes the key to prevent metacharacter injection;
    # no /e modifier — replacement string is treated as a literal, never evaluated as code.
    foreach my $var (keys %$data) {
        next if $var eq 'sys_url'; # Handled via regex above
        my $val = $data->{$var} // '';
        $subj =~ s/\[\Q$var\E\]/$val/g;
        $body =~ s/\[\Q$var\E\]/$val/g;
    }

    return { subject => $subj, body => $body };
}

# Synchronizes the Perl MANIFEST constant with the database table.
# Ensures that all application contracts are reflected in the DB without
# overwriting user-customized subject or body content.
#
# Parameters:
#   $manifest - The MANIFEST HashRef from MyApp::Plugin::Notifications
sub DB::sync_manifest {
    my ($self, $manifest) = @_;
    $self->ensure_connection;

    foreach my $key (keys %$manifest) {
        my $m = $manifest->{$key};
        my $sample_json = $m->{sample} ? encode_json($m->{sample}) : undef;

        $self->{dbh}->do(
            "INSERT INTO notification_templates
                (template_key, description, available_tags, subject_template, body_template, sample_data)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                description    = VALUES(description),
                available_tags = VALUES(available_tags),
                sample_data    = VALUES(sample_data)",
            undef,
            $key, $m->{desc}, $m->{tags}, $m->{default_subject}, $m->{default_body}, $sample_json
        );
    }

    # Stale Key Deprecation: build IN list from current MANIFEST keys
    my @known_keys = keys %$manifest;
    return unless @known_keys;
    my $placeholders = join(', ', ('?') x @known_keys);

    # Only mark unknown keys as deprecated; reset is handled by the INSERT loop above.
    $self->{dbh}->do(
        "UPDATE notification_templates
         SET is_deprecated = 1
         WHERE template_key NOT IN ($placeholders)",
        undef, @known_keys
    );
    $self->{dbh}->do(
        "UPDATE notification_templates
         SET is_deprecated = 0
         WHERE template_key IN ($placeholders)
           AND is_deprecated = 1",
        undef, @known_keys
    );
}

# Retrieves all notification templates for the Admin UI.
# Sorts by active status and then alphabetically.
#
# Returns: ArrayRef of HashRefs
sub DB::get_notification_templates {
    my ($self) = @_;
    $self->ensure_connection;
    return $self->{dbh}->selectall_arrayref(
        "SELECT * FROM notification_templates ORDER BY is_deprecated ASC, template_key ASC",
        { Slice => {} }
    );
}

# Updates the subject and body of an existing template.
#
# Parameters:
#   $id      - Primary key of the template
#   $subject - New subject template string
#   $body    - New body template string
# Returns:
#   Integer : Rows affected
sub DB::update_notification_template {
    my ($self, $id, $subject, $body) = @_;
    $self->ensure_connection;
    return $self->{dbh}->do(
        "UPDATE notification_templates
         SET subject_template = ?, body_template = ?
         WHERE id = ?",
        undef, $subject, $body, $id
    );
}

1;
