# /lib/DB/Maintenance.pm

package DB::Maintenance;

use strict;
use warnings;
use utf8;

# Database helper for system-wide background maintenance tasks.
# Features:
#   - Cross-module batch processing for AI Emoji generation
#   - Specialized dictionary lookups for AI caching and UI fallbacks
#   - Dynamic table and column whitelisting
# Integration points:
#   - Extends DB package via package injection
#   - Direct DBI usage for SQL operations
#   - Scoped to background non-blocking workers

# Retrieves a batch of unprocessed text fields from a specified table.
# Parameters:
#   table    : Target table name (String)
#   id_col   : Primary key column name (String)
#   text_col : The column containing the string to analyze (String)
#   limit    : Maximum records to process per tick (Integer)
# Returns:
#   ArrayRef of HashRefs containing 'id' and 'text_value'
sub DB::get_unprocessed_emojis {
    my ($self, $table, $id_col, $text_col, $limit) = @_;
    
    # Secure whitelist matching the exact schema
    my %allowed = (
        todo_list       => { id => 'id', text => 'task_name' },
        shopping_list   => { id => 'id', text => 'item_name' },
        calendar_events => { id => 'id', text => 'title' },
        reminders       => { id => 'id', text => 'title' },
        meals           => { id => 'id', text => 'name' }
    );
    
    return [] unless exists $allowed{$table};
    return [] unless $allowed{$table}{id} eq $id_col && $allowed{$table}{text} eq $text_col;

    my $sql = "SELECT $id_col AS id, $text_col AS text_value FROM $table WHERE has_emoji = 0 LIMIT ?";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($limit);
    
    return $sth->fetchall_arrayref({});
}

# Retrieves system-wide emoji processing statistics for the management dashboard.
# Parameters: None
# Returns:
#   HashRef { total_pending, learned_count, module_stats }
sub DB::get_emoji_stats {
    my ($self) = @_;
    $self->ensure_connection;
    
    my %stats = (
        total_pending => 0,
        learned_count => 0,
        module_stats  => []
    );
    
    # 1. Gather pending counts per whitelisted module
    my %targets = (
        'Todo Tasks'     => { table => 'todo_list' },
        'Shopping Items' => { table => 'shopping_list' },
        'Calendar Events'=> { table => 'calendar_events' },
        'Reminders'      => { table => 'reminders' },
        'Meal Plans'     => { table => 'meals' }
    );
    
    foreach my $label (sort keys %targets) {
        my $table = $targets{$label}{table};
        my ($count) = $self->{dbh}->selectrow_array("SELECT COUNT(*) FROM $table WHERE has_emoji = 0");
        $stats{total_pending} += $count;
        push @{$stats{module_stats}}, { label => $label, count => $count };
    }
    
    # 2. Gather dictionary metrics
    ($stats{learned_count}) = $self->{dbh}->selectrow_array("SELECT COUNT(*) FROM ai_emoji_dictionary");
    
    return \%stats;
}

# Retrieves paginated and searchable entries from the AI learned dictionary.
# Parameters:
#   limit  : Max records (Integer)
#   offset : Starting point (Integer)
#   search : Keyword filter (Optional String)
# Returns:
#   ArrayRef of HashRefs { keyword, emoji, created_at }
sub DB::get_emoji_dictionary_list {
    my ($self, $limit, $offset, $search) = @_;
    $self->ensure_connection;
    
    my $sql = "SELECT keyword, emoji, created_at FROM ai_emoji_dictionary";
    my @params;
    
    if ($search) {
        $sql .= " WHERE keyword LIKE ?";
        push @params, "%$search%";
    }
    
    $sql .= " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    push @params, (int($limit || 20), int($offset || 0));
    
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(@params);
    
    return $sth->fetchall_arrayref({});
}

# Updates or inserts an explicit mapping into the AI dictionary.
# Parameters:
#   keyword : The trigger phrase (String)
#   emoji   : The replacement character (String)
# Returns:
#   Boolean : Success status
sub DB::update_dictionary_entry {
    my ($self, $keyword, $emoji) = @_;
    $self->ensure_connection;
    
    return 0 unless $keyword && $emoji;
    
    # Keyword is the Primary Key: Use UPSERT
    my $sql = "INSERT INTO ai_emoji_dictionary (keyword, emoji) VALUES (?, ?) "
            . "ON DUPLICATE KEY UPDATE emoji = ?";
    my $sth = $self->{dbh}->prepare($sql);
    
    return $sth->execute(lc($keyword), $emoji, $emoji) > 0;
}

# Removes a specific learning mapping from the dictionary.
# Parameters:
#   keyword : The trigger phrase (String)
# Returns:
#   Boolean : Success status
sub DB::delete_dictionary_entry {
    my ($self, $keyword) = @_;
    $self->ensure_connection;
    
    return 0 unless $keyword;
    
    my $sql = "DELETE FROM ai_emoji_dictionary WHERE keyword = ?";
    my $sth = $self->{dbh}->prepare($sql);
    
    return $sth->execute(lc($keyword)) > 0;
}

# Updates a specific record with its new emojified text and flags it as processed.
# Parameters:
#   table    : Target table name (String)
#   id_col   : Primary key column name (String)
#   text_col : The column containing the string (String)
#   id       : Record ID (Integer)
#   new_text : The combined emoji + text string (String)
# Returns:
#   Boolean : Success status
sub DB::update_record_emoji {
    my ($self, $table, $id_col, $text_col, $id, $new_text) = @_;
    
    # Whitelist enforcement
    return 0 unless $table =~ /^(todo_list|shopping_list|calendar_events|reminders|meals)$/;
    return 0 unless $id_col =~ /^[a-z_]+$/ && $text_col =~ /^[a-z_]+$/;

    my $sql = "UPDATE $table SET $text_col = ?, has_emoji = 1 WHERE $id_col = ?";
    my $sth = $self->{dbh}->prepare($sql);
    
    return $sth->execute($new_text, $id) > 0;
}

# Looks up a known string in the isolated AI dictionary.
# Parameters:
#   text : The original string to look up (String)
# Returns:
#   String : The mapped emoji, or undef if not found
sub DB::check_ai_dictionary {
    my ($self, $text) = @_;
    
    my $sql = "SELECT emoji FROM ai_emoji_dictionary WHERE keyword = ?";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(lc($text));
    
    my ($emoji) = $sth->fetchrow_array();
    return $emoji;
}

# Looks up a known string in the standard UI emojis table (Fallback).
# Parameters:
#   text : The original string to look up (String)
# Returns:
#   String : The mapped emoji, or undef if not found
sub DB::check_standard_dictionary {
    my ($self, $text) = @_;
    
    # Using an exact match against the name. 
    my $sql = "SELECT emoji_char FROM emojis WHERE emoji_name = ? LIMIT 1";
    my $sth = $self->{dbh}->prepare($sql);
    
    $sth->execute(lc($text));
    
    my ($emoji) = $sth->fetchrow_array();
    
    # Fallback: If exact match fails, try a partial "simple text match" 
    # (e.g., if text is "milk", it might match "glass of milk")
    if (!$emoji) {
        my $like_sql = "SELECT emoji_char FROM emojis WHERE emoji_name LIKE ? LIMIT 1";
        my $like_sth = $self->{dbh}->prepare($like_sql);
        $like_sth->execute('%' . lc($text) . '%');
        ($emoji) = $like_sth->fetchrow_array();
    }
    
    return $emoji;
}

# Saves an AI-generated text-to-emoji mapping to the isolated dictionary.
# Parameters:
#   text  : The original string (String)
#   emoji : The AI-generated emoji (String)
# Returns:
#   Boolean : Success status
sub DB::save_to_ai_dictionary {
    my ($self, $text, $emoji) = @_;
    
    my $sql = "INSERT IGNORE INTO ai_emoji_dictionary (keyword, emoji) VALUES (?, ?)";
    my $sth = $self->{dbh}->prepare($sql);
    
    return $sth->execute(lc($text), $emoji) > 0;
}

# Flags a record as processed without altering text (e.g., if it already had an emoji).
# Parameters:
#   table  : Target table name (String)
#   id_col : Primary key column name (String)
#   id     : Record ID (Integer)
# Returns:
#   Boolean : Success status
sub DB::mark_emoji_processed {
    my ($self, $table, $id_col, $id) = @_;
    
    # Whitelist enforcement
    return 0 unless $table =~ /^(todo_list|shopping_list|calendar_events|reminders|meals)$/;
    
    my $sql = "UPDATE $table SET has_emoji = 1 WHERE $id_col = ?";
    my $sth = $self->{dbh}->prepare($sql);
    
    return $sth->execute($id) > 0;
}

# Attempts to acquire a persistent maintenance lock for a specific minute.
# Parameters:
#   epoch_min : Integer representing the current epoch minute
# Returns:
#   Boolean : True if the lock was successfully acquired for this minute
sub DB::try_acquire_maintenance_lock {
    my ($self, $epoch_min) = @_;
    $self->ensure_connection;

    # 1. Auto-init the tracking key if it doesn't exist
    $self->{dbh}->do(
        "INSERT IGNORE INTO app_secrets (key_name, secret_value) VALUES ('system_maintenance_last_run', '0')"
    );

    # 2. Atomic claim: Only update if the stored minute is behind the current one
    # Uses CAST as UNSIGNED for safe integer comparison of the TEXT column
    my $sql = "UPDATE app_secrets " .
              "SET    secret_value = ? " .
              "WHERE  key_name = 'system_maintenance_last_run' " .
              "AND    (CAST(secret_value AS UNSIGNED) < ? OR secret_value IS NULL)";
    
    my $rows = $self->{dbh}->do($sql, undef, $epoch_min, $epoch_min);
    
    return ($rows && $rows > 0) ? 1 : 0;
}

# Atomic check-and-set for daily brief dispatch.
# Ensures the 8am brief is only sent once per day across all worker processes.
# Parameters:
#   date_str : YYYY-MM-DD string
# Returns:
#   Boolean : True if this process claimed the dispatch for today
sub DB::try_set_brief_sent_date {
    my ($self, $date_str) = @_;
    $self->ensure_connection;

    # 1. Auto-init the tracking key
    $self->{dbh}->do(
        "INSERT IGNORE INTO app_secrets (key_name, secret_value) VALUES ('brief_sent_date', '1970-01-01')"
    );

    # 2. Atomic update: Only succeeds if the current value is NOT today's date
    my $sql = "UPDATE app_secrets SET secret_value = ? " .
              "WHERE key_name = 'brief_sent_date' AND secret_value != ?";
    
    my $rows = $self->{dbh}->do($sql, undef, $date_str, $date_str);
    
    return ($rows && $rows > 0) ? 1 : 0;
}

1;
