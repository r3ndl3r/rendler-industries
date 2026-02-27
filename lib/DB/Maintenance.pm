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

1;