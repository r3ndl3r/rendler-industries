# /lib/DB/Automator.pm

package DB::Automator;

use strict;
use warnings;
use DBI qw(:sql_types);
use Cpanel::JSON::XS qw(encode_json decode_json);
use Crypt::AuthEnc::GCM;
use Crypt::Eksblowfish::Bcrypt qw(bcrypt en_base64);
use Crypt::PBKDF2;
use Crypt::URandom qw(urandom);
use DateTime;
use File::Path qw(remove_tree);

# Database library for the Automator Ansible orchestration module.
#
# Features:
#   - Module vault password setup and verification.
#   - Inventory, playbook, secret, history, schedule, and audit persistence.
#   - AES-GCM secret encryption with per-record PBKDF2 salts.
#   - Concurrency checks and maintenance reconciliation for active runs.
#   - Name-only secret responses so plaintext never returns to the browser.

# Checks if a master password has been initialized for the orchestration vault.
# Parameters: None
# Returns:
#   Boolean (1 if exists, 0 otherwise)
sub DB::automator_master_exists {
    my ($self) = @_;
    $self->ensure_connection;
    my ($count) = $self->{dbh}->selectrow_array(
        "SELECT COUNT(*) FROM app_secrets WHERE key_name = 'automator_master_password'"
    );
    return $count ? 1 : 0;
}

sub DB::automator_set_master_password {
    my ($self, $password) = @_;
    die "Master password is required" unless defined $password && length $password >= 8;
    $self->ensure_connection;

    my $salt = urandom(16);
    my $settings = '$2a$10$' . en_base64($salt);
    my $hash = bcrypt($password, $settings);

    $self->{dbh}->do(
        q{INSERT INTO app_secrets (key_name, secret_value)
          VALUES ('automator_master_password', ?)
          ON DUPLICATE KEY UPDATE secret_value = VALUES(secret_value)},
        undef, $hash
    );
    return 1;
}

sub DB::automator_verify_master_password {
    my ($self, $password) = @_;
    return 0 unless defined $password && length $password;
    $self->ensure_connection;
    my ($hash) = $self->{dbh}->selectrow_array(
        "SELECT secret_value FROM app_secrets WHERE key_name = 'automator_master_password'"
    );
    return 0 unless $hash;
    return bcrypt($password, $hash) eq $hash ? 1 : 0;
}

# Fetches the comprehensive state for the Automator dashboard.
# Parameters:
#   filters : HashRef for playbooks, history, etc.
# Returns:
#   HashRef containing setup_required, playbooks, inventories, secrets, history, categories, and active_runs.
sub DB::get_automator_state {
    my ($self, $filters) = @_;
    $self->ensure_connection;
    $filters ||= {};

    return {
        setup_required => $self->automator_master_exists ? 0 : 1,
        playbooks      => $self->list_automator_playbooks($filters),
        inventories    => $self->list_automator_inventories($filters),
        secrets        => $self->list_automator_secrets($filters),
        history        => $self->list_automator_history($filters, 50, 0),
        categories     => $self->list_automator_categories($filters),
        active_runs    => $self->automator_active_run_count,
    };
}

sub DB::list_automator_playbooks {
    my ($self, $filters) = @_;
    $filters ||= {};
    my $sql = q{
        SELECT p.*, i.name AS inventory_name, c.name AS success_chain_name,
               sks.name AS secret_name,
               s.id AS schedule_id, s.schedule_type, s.interval_hours, s.daily_time,
               s.next_run, s.last_run_at, s.last_history_id AS schedule_last_history_id, s.is_active AS schedule_active,
               lh.id AS last_history_id, lh.status AS last_status, lh.mode AS last_mode,
               lh.started_at AS last_started_at, lh.finished_at AS last_finished_at
          FROM automator_playbooks p
          LEFT JOIN automator_inventories i ON i.id = p.inventory_id
          LEFT JOIN automator_playbooks c ON c.id = p.success_chain_id
          LEFT JOIN automator_secrets sks ON sks.id = p.playbook_secret_id
          LEFT JOIN automator_schedules s ON s.playbook_id = p.id
          LEFT JOIN automator_history lh ON lh.id = (
              SELECT h2.id
                FROM automator_history h2
               WHERE h2.playbook_id = p.id
               ORDER BY h2.started_at DESC
               LIMIT 1
          )
         WHERE p.deleted_at IS NULL
    };
    my @params;
    if ($filters->{user_id}) {
        $sql .= " AND p.user_id = ?";
        push @params, $filters->{user_id};
    }
    if ($filters->{search}) {
        $sql .= " AND (p.name LIKE ? OR p.description LIKE ? OR p.content LIKE ?)";
        my $term = '%' . $filters->{search} . '%';
        push @params, ($term, $term, $term);
    }
    if ($filters->{category}) {
        $sql .= " AND p.category = ?";
        push @params, $filters->{category};
    }
    if ($filters->{inventory}) {
        $sql .= " AND p.inventory_id = ?";
        push @params, $filters->{inventory};
    }
    $sql .= " ORDER BY p.category ASC, p.name ASC";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(@params);
    my $rows = $sth->fetchall_arrayref({});
    return [] unless @$rows;

    # Fetch all notifications for these playbooks in one batch
    my $ids_str = join(',', map { int($_->{id}) } @$rows);
    my $notif_sth = $self->{dbh}->prepare(qq{
        SELECT n.*, u.username
          FROM automator_notifications n
          JOIN users u ON u.id = n.user_id
         WHERE n.playbook_id IN ($ids_str)
    });
    $notif_sth->execute();
    my $all_notifs = $notif_sth->fetchall_arrayref({});
    my %notif_map;
    push @{$notif_map{$_->{playbook_id}}}, $_ for @$all_notifs;

    for my $row (@$rows) {
        $row->{dynamic_vars} = $self->_json_decode($row->{dynamic_vars}, {});
        $row->{notifications} = $notif_map{$row->{id}} || [];
        $row->{secrets} = $self->list_automator_playbook_secrets($row->{id});
    }
    return $rows;
}

# Lists recent playbook execution history with optional filtering.
# Parameters:
#   filters : HashRef (status, search, playbook, user_id)
#   limit   : Max rows to return (default 50, capped at 100)
#   offset  : Pagination offset
# Returns:
#   ArrayRef of HashRefs containing history records.
sub DB::list_automator_history {
    my ($self, $filters, $limit, $offset) = @_;
    $limit = int($limit || 50);
    $limit = 100 if $limit > 100;
    $offset = int($offset || 0);
    $filters ||= {};

    my $sql = q{
        SELECT h.*, p.name AS playbook_name, u.username AS triggered_by_name
          FROM automator_history h
          LEFT JOIN automator_playbooks p ON p.id = h.playbook_id
          LEFT JOIN users u ON u.id = h.triggered_by
         WHERE 1=1
    };
    my @params;
    if ($filters->{status}) {
        $sql .= " AND h.status = ?";
        push @params, $filters->{status};
    }
    if ($filters->{search}) {
        $sql .= " AND (p.name LIKE ? OR h.output LIKE ?)";
        my $term = '%' . $filters->{search} . '%';
        push @params, ($term, $term);
    }
    if ($filters->{playbook}) {
        $sql .= " AND h.playbook_id = ?";
        push @params, $filters->{playbook};
    }
    if ($filters->{user_id}) {
        $sql .= " AND (p.user_id = ? OR h.triggered_by = ?)";
        push @params, ($filters->{user_id}, $filters->{user_id});
    }
    $sql .= " ORDER BY h.started_at DESC LIMIT $limit OFFSET $offset";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(@params);
    my $rows = $sth->fetchall_arrayref({});
    for my $row (@$rows) {
        $row->{json_result}  = $self->_json_decode($row->{json_result}, undef);
        $row->{applied_vars} = $self->_json_decode($row->{applied_vars}, {});
    }
    return $rows;
}

# Aggregates automator history output from the last 24 hours for one user.
# Parameters:
#   user_id : Owner/triggering user ID
# Returns:
#   ArrayRef of HashRefs containing id, playbook_name, status, started_at, and output.
sub DB::get_automator_logs_24h {
    my ($self, $user_id) = @_;
    $self->ensure_connection;
    my $sql = q{
        SELECT h.id, p.name AS playbook_name, h.status, h.started_at, h.output
          FROM automator_history h
          LEFT JOIN automator_playbooks p ON p.id = h.playbook_id
         WHERE h.started_at >= NOW() - INTERVAL 24 HOUR
           AND h.output IS NOT NULL AND h.output != ''
           AND (p.user_id = ? OR h.triggered_by = ?)
         ORDER BY h.started_at ASC
    };
    return $self->{dbh}->selectall_arrayref($sql, { Slice => {} }, $user_id, $user_id);
}

# Retrieves the last 5 generated AI system reports from the audit log for one user.
# Parameters:
#   user_id : Owner user ID
# Returns:
#   ArrayRef of HashRefs containing id, details, and created_at.
sub DB::list_recent_ai_reports {
    my ($self, $user_id) = @_;
    $self->ensure_connection;
    my $sql = q{
        SELECT id, details, created_at
          FROM automator_audit
         WHERE action = 'ai_report'
           AND user_id = ?
         ORDER BY created_at DESC
         LIMIT 5
    };
    my $rows = $self->{dbh}->selectall_arrayref($sql, { Slice => {} }, $user_id);
    for my $row (@$rows) {
        $row->{details} = $self->_json_decode($row->{details}, {});
    }
    return $rows;
}

# Retrieves a single history record by ID.
# Parameters:
#   id : History record ID
# Returns:
#   HashRef of the history record.
sub DB::get_automator_history {
    my ($self, $id) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare(q{
        SELECT h.*, p.name AS playbook_name, p.user_id AS playbook_user_id
          FROM automator_history h
          LEFT JOIN automator_playbooks p ON p.id = h.playbook_id
         WHERE h.id = ?
    });
    $sth->execute($id);
    return $sth->fetchrow_hashref;
}

sub DB::list_automator_inventories {
    my ($self, $filters) = @_;
    $filters ||= {};
    my $sql = "SELECT * FROM automator_inventories WHERE 1=1";
    my @params;
    if ($filters->{user_id}) {
        $sql .= " AND user_id = ?";
        push @params, $filters->{user_id};
    }
    $sql .= " ORDER BY category ASC, name ASC";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(@params);
    return $sth->fetchall_arrayref({});
}

sub DB::list_automator_secrets {
    my ($self, $filters) = @_;
    $filters ||= {};
    my $sql = "SELECT id, name, category, created_at FROM automator_secrets WHERE 1=1";
    my @params;
    if ($filters->{user_id}) {
        $sql .= " AND user_id = ?";
        push @params, $filters->{user_id};
    }
    $sql .= " ORDER BY category ASC, name ASC";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(@params);
    return $sth->fetchall_arrayref({});
}

sub DB::list_automator_categories {
    my ($self, $filters) = @_;
    $filters ||= {};
    my $sql = q{
        SELECT DISTINCT COALESCE(NULLIF(category, ''), 'General') AS category
          FROM automator_playbooks
         WHERE deleted_at IS NULL
    };
    my @params;
    if ($filters->{user_id}) {
        $sql .= " AND user_id = ?";
        push @params, $filters->{user_id};
    }
    $sql .= " ORDER BY category ASC";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute(@params);
    return [ map { $_->[0] } @{$sth->fetchall_arrayref} ];
}

sub DB::get_automator_playbook {
    my ($self, $id) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("SELECT * FROM automator_playbooks WHERE id = ? AND deleted_at IS NULL");
    $sth->execute($id);
    my $row = $sth->fetchrow_hashref;
    if ($row) {
        $row->{dynamic_vars} = $self->_json_decode($row->{dynamic_vars}, {});
        $row->{notifications} = $self->list_automator_playbook_notifications($id);
        $row->{secrets} = $self->list_automator_playbook_secrets($id);
    }
    return $row;
}

sub DB::list_automator_playbook_secrets {
    my ($self, $playbook_id) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare(q{
        SELECT ps.*, s.name AS secret_name, s.category AS secret_category
          FROM automator_playbook_secrets ps
          JOIN automator_secrets s ON s.id = ps.secret_id
         WHERE ps.playbook_id = ?
         ORDER BY ps.sort_order ASC, ps.id ASC
    });
    $sth->execute($playbook_id);
    return $sth->fetchall_arrayref({});
}

sub DB::save_automator_playbook_secrets {
    my ($self, $playbook_id, $secrets) = @_;
    $self->ensure_connection;
    $secrets ||= [];
    die "Secrets must be an array" unless ref($secrets) eq 'ARRAY';
    my %allowed_usage = map { $_ => 1 } qw(file env ssh_key vault_password);
    my %seen_alias;
    my %single_use;
    for my $s (@$secrets) {
        die "Invalid secret row" unless ref($s) eq 'HASH';
        die "Invalid secret" unless defined $s->{secret_id} && $s->{secret_id} =~ /\A\d+\z/;
        die "Invalid secret alias" unless defined $s->{alias} && $s->{alias} =~ /\A[A-Za-z_][A-Za-z0-9_]*\z/;
        die "Duplicate secret alias" if $seen_alias{lc $s->{alias}}++;
        die "Invalid secret usage" unless $allowed_usage{$s->{usage_type} || ''};
        die "Only one SSH key secret is allowed" if $s->{usage_type} eq 'ssh_key' && $single_use{ssh_key}++;
        die "Only one vault password secret is allowed" if $s->{usage_type} eq 'vault_password' && $single_use{vault_password}++;
    }
    my $dbh = $self->{dbh};
    my $started_txn = $dbh->{AutoCommit} ? 1 : 0;
    eval {
        $dbh->begin_work if $started_txn;
        $dbh->do("DELETE FROM automator_playbook_secrets WHERE playbook_id = ?", undef, $playbook_id);
        my $sort = 0;
        for my $s (@$secrets) {
            $dbh->do(q{
                INSERT INTO automator_playbook_secrets (playbook_id, secret_id, alias, usage_type, sort_order)
                VALUES (?, ?, ?, ?, ?)
            }, undef, $playbook_id, $s->{secret_id}, $s->{alias}, $s->{usage_type}, $sort++);
        }
        $dbh->commit if $started_txn;
        1;
    } or do {
        my $err = $@ || 'secret binding save failed';
        eval { $dbh->rollback } if $started_txn;
        die $err;
    };
    return 1;
}

sub DB::list_automator_playbook_notifications {
    my ($self, $playbook_id) = @_;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare(q{
        SELECT n.*, u.username
          FROM automator_notifications n
          JOIN users u ON u.id = n.user_id
         WHERE n.playbook_id = ?
    });
    $sth->execute($playbook_id);
    return $sth->fetchall_arrayref({});
}

sub DB::save_automator_playbook_notifications {
    my ($self, $playbook_id, $notifications) = @_;
    $self->ensure_connection;
    $notifications ||= [];
    die "Notifications must be an array" unless ref($notifications) eq 'ARRAY';
    my %allowed_notify = map { $_ => 1 } qw(always failure success);
    my %allowed_channel = map { $_ => 1 } qw(discord email fcm pushover gotify);
    for my $n (@$notifications) {
        die "Invalid notification row" unless ref($n) eq 'HASH';
        die "Invalid notification user" unless defined $n->{user_id} && $n->{user_id} =~ /\A\d+\z/;
        die "Invalid notification trigger" unless $allowed_notify{$n->{notify_on} || ''};
        die "Invalid notification channel" unless $allowed_channel{$n->{channel} || ''};
    }
    my $dbh = $self->{dbh};
    my $started_txn = $dbh->{AutoCommit} ? 1 : 0;
    eval {
        $dbh->begin_work if $started_txn;
        $dbh->do("DELETE FROM automator_notifications WHERE playbook_id = ?", undef, $playbook_id);
        for my $n (@$notifications) {
            $dbh->do(q{
                INSERT INTO automator_notifications (playbook_id, user_id, notify_on, channel, endpoint)
                VALUES (?, ?, ?, ?, ?)
            }, undef, $playbook_id, $n->{user_id}, $n->{notify_on}, $n->{channel}, $n->{endpoint});
        }
        $dbh->commit if $started_txn;
        1;
    } or do {
        my $err = $@ || 'notification rule save failed';
        eval { $dbh->rollback } if $started_txn;
        die $err;
    };
    return 1;
}

sub DB::get_automator_inventory {
    my ($self, $id) = @_;
    return undef unless $id;
    $self->ensure_connection;
    my $sth = $self->{dbh}->prepare("SELECT * FROM automator_inventories WHERE id = ?");
    $sth->execute($id);
    return $sth->fetchrow_hashref;
}

sub DB::save_automator_inventory {
    my ($self, $data) = @_;
    $self->ensure_connection;
    if ($data->{id}) {
        $self->{dbh}->do(
            "UPDATE automator_inventories SET name=?, category=?, hosts=?, ssh_key_path=? WHERE id=?",
            undef, @$data{qw(name category hosts ssh_key_path id)}
        );
        return $data->{id};
    }
    $self->{dbh}->do(
        "INSERT INTO automator_inventories (name, category, hosts, ssh_key_path, user_id) VALUES (?, ?, ?, ?, ?)",
        undef, @$data{qw(name category hosts ssh_key_path user_id)}
    );
    return $self->{dbh}->last_insert_id(undef, undef, 'automator_inventories', 'id');
}

sub DB::delete_automator_inventory {
    my ($self, $id, $user_id) = @_;
    $self->ensure_connection;
    my ($refs) = $self->{dbh}->selectrow_array(
        "SELECT COUNT(*) FROM automator_playbooks WHERE inventory_id = ? AND user_id = ? AND deleted_at IS NULL",
        undef, $id, $user_id
    );
    die "Inventory is still used by active playbooks" if $refs;
    return $self->{dbh}->do("DELETE FROM automator_inventories WHERE id = ? AND user_id = ?", undef, $id, $user_id);
}

sub DB::save_automator_schedule {
    my ($self, $playbook_id, $data) = @_;
    $self->ensure_connection;
    my $type = $data->{schedule_type} || 'none';
    if ($type eq 'none') {
        $self->{dbh}->do("DELETE FROM automator_schedules WHERE playbook_id = ?", undef, $playbook_id);
        return 1;
    }

    die "Invalid schedule type" unless $type eq 'daily' || $type eq 'hourly';
    my $interval_hours = $type eq 'hourly' ? int($data->{interval_hours} || 1) : undef;
    $interval_hours = 1 if defined $interval_hours && $interval_hours < 1;
    $interval_hours = 168 if defined $interval_hours && $interval_hours > 168;
    my $daily_time = $type eq 'daily' ? ($data->{daily_time} || '00:00') : undef;
    die "Invalid daily time" if defined $daily_time && $daily_time !~ /\A(?:[01]\d|2[0-3]):[0-5]\d\z/;
    my $next_run = $self->_automator_next_run($type, $interval_hours, $daily_time);

    $self->{dbh}->do(q{
        INSERT INTO automator_schedules
            (playbook_id, schedule_type, interval_hours, daily_time, timezone, next_run, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE
            schedule_type = VALUES(schedule_type),
            interval_hours = VALUES(interval_hours),
            daily_time = VALUES(daily_time),
            timezone = VALUES(timezone),
            next_run = VALUES(next_run),
            is_active = 1
    }, undef, $playbook_id, $type, $interval_hours, $daily_time, $self->{timezone}, $next_run);
    return 1;
}

sub DB::get_due_automator_schedules {
    my ($self, $limit) = @_;
    $self->ensure_connection;
    $limit = int($limit || 10);
    $limit = 50 if $limit > 50;
    my $sth = $self->{dbh}->prepare(qq{
        SELECT s.*, p.name AS playbook_name
          FROM automator_schedules s
          JOIN automator_playbooks p ON p.id = s.playbook_id
         WHERE s.is_active = 1
           AND p.deleted_at IS NULL
           AND s.next_run IS NOT NULL
           AND s.next_run <= NOW()
         ORDER BY s.next_run ASC
         LIMIT $limit
    });
    $sth->execute;
    return $sth->fetchall_arrayref({});
}

sub DB::mark_automator_schedule_dispatched {
    my ($self, $schedule, $history_id) = @_;
    $self->ensure_connection;
    my $next_run = $self->_automator_next_run(
        $schedule->{schedule_type},
        $schedule->{interval_hours},
        defined $schedule->{daily_time} ? substr($schedule->{daily_time}, 0, 5) : undef
    );
    $self->{dbh}->do(q{
        UPDATE automator_schedules
           SET last_run_at = NOW(), last_history_id = ?, next_run = ?
         WHERE id = ?
    }, undef, $history_id, $next_run, $schedule->{id});
    return 1;
}

sub DB::save_automator_playbook {
    my ($self, $data) = @_;
    $self->ensure_connection;
    my $vars = ref($data->{dynamic_vars}) ? encode_json($data->{dynamic_vars}) : ($data->{dynamic_vars} || '{}');
    if ($data->{id}) {
        $self->{dbh}->do(q{
            UPDATE automator_playbooks
               SET name=?, category=?, description=?, content=?, inventory_id=?, dynamic_vars=?,
                   tags=?, skip_tags=?, limit_hosts=?, success_chain_id=?, playbook_secret_id=?, log_retention_days=?
             WHERE id=? AND deleted_at IS NULL
        }, undef, @$data{qw(name category description content inventory_id)}, $vars,
           @$data{qw(tags skip_tags limit_hosts success_chain_id playbook_secret_id log_retention_days id)});
        return $data->{id};
    }
    $self->{dbh}->do(q{
        INSERT INTO automator_playbooks
            (name, category, description, content, inventory_id, dynamic_vars, tags, skip_tags,
             limit_hosts, success_chain_id, playbook_secret_id, log_retention_days, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    }, undef, @$data{qw(name category description content inventory_id)}, $vars,
       @$data{qw(tags skip_tags limit_hosts success_chain_id playbook_secret_id log_retention_days user_id)});
    return $self->{dbh}->last_insert_id(undef, undef, 'automator_playbooks', 'id');
}

sub DB::automator_chain_has_cycle {
    my ($self, $id, $next_id) = @_;
    return 0 unless $id && $next_id;
    my %seen = ($id => 1);
    my $current = $next_id;
    for (1 .. 10) {
        return 1 if $seen{$current};
        $seen{$current} = 1;
        my ($parent) = $self->{dbh}->selectrow_array(
            "SELECT success_chain_id FROM automator_playbooks WHERE id = ? AND deleted_at IS NULL",
            undef, $current
        );
        last unless $parent;
        $current = $parent;
    }
    return 0;
}

sub DB::soft_delete_automator_playbook {
    my ($self, $id) = @_;
    $self->ensure_connection;
    $self->{dbh}->do("UPDATE automator_playbooks SET deleted_at = NOW() WHERE id = ?", undef, $id);
}

sub DB::save_automator_secret {
    my ($self, $id, $name, $category, $plaintext, $user_id) = @_;
    die "Secret name and value are required" unless length($name // '') && length($plaintext // '');
    $self->ensure_connection;
    my ($ciphertext, $iv, $tag, $salt) = $self->_automator_encrypt_secret($plaintext);
    if ($id) {
        my $sth = $self->{dbh}->prepare(q{
            UPDATE automator_secrets
               SET name = ?, category = ?, value_encrypted = ?, iv = ?, tag = ?, salt = ?
             WHERE id = ? AND user_id = ?
        });
        $sth->bind_param(1, $name);
        $sth->bind_param(2, $category || 'General');
        $sth->bind_param(3, $ciphertext, SQL_BLOB);
        $sth->bind_param(4, $iv, SQL_BINARY);
        $sth->bind_param(5, $tag, SQL_BINARY);
        $sth->bind_param(6, $salt, SQL_BINARY);
        $sth->bind_param(7, $id);
        $sth->bind_param(8, $user_id);
        $sth->execute;
        return undef unless $sth->rows;
        return { id => $id, name => $name, category => $category || 'General' };
    }
    my $sth = $self->{dbh}->prepare(q{
        INSERT INTO automator_secrets (name, category, value_encrypted, iv, tag, salt, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            id = LAST_INSERT_ID(id),
            category = VALUES(category),
            value_encrypted = VALUES(value_encrypted),
            iv = VALUES(iv),
            tag = VALUES(tag),
            salt = VALUES(salt)
    });
    $sth->bind_param(1, $name);
    $sth->bind_param(2, $category || 'General');
    $sth->bind_param(3, $ciphertext, SQL_BLOB);
    $sth->bind_param(4, $iv, SQL_BINARY);
    $sth->bind_param(5, $tag, SQL_BINARY);
    $sth->bind_param(6, $salt, SQL_BINARY);
    $sth->bind_param(7, $user_id);
    $sth->execute;
    my $saved_id = $self->{dbh}->last_insert_id(undef, undef, 'automator_secrets', 'id');
    return { id => $saved_id, name => $name, category => $category || 'General' };
}

sub DB::delete_automator_secret {
    my ($self, $id, $user_id) = @_;
    $self->ensure_connection;
    return $self->{dbh}->do("DELETE FROM automator_secrets WHERE id = ? AND user_id = ?", undef, $id, $user_id);
}

sub DB::get_automator_secret_plaintext {
    my ($self, $id_or_name, $user_id) = @_;
    $self->ensure_connection;
    die "Secret owner is required" unless defined $user_id && $user_id =~ /\A[1-9]\d*\z/;
    my $sql = $id_or_name =~ /^\d+$/
        ? "SELECT * FROM automator_secrets WHERE id = ? AND user_id = ?"
        : "SELECT * FROM automator_secrets WHERE name = ? AND user_id = ?";
    my $sth = $self->{dbh}->prepare($sql);
    $sth->execute($id_or_name, $user_id);
    my $row = $sth->fetchrow_hashref;
    die "Secret not found" unless $row;
    return $self->_automator_decrypt_secret(@$row{qw(value_encrypted iv tag salt)});
}

sub DB::create_automator_history {
    my ($self, $playbook_id, $mode, $vars, $user_id) = @_;
    $self->ensure_connection;
    my $json = encode_json($vars || {});
    $self->{dbh}->do(
        "INSERT INTO automator_history (playbook_id, status, mode, applied_vars, triggered_by) VALUES (?, 'running', ?, ?, ?)",
        undef, $playbook_id, $mode || 'run', $json, $user_id
    );
    return $self->{dbh}->last_insert_id(undef, undef, 'automator_history', 'id');
}

sub DB::update_automator_history_pgid {
    my ($self, $id, $pgid) = @_;
    $self->ensure_connection;
    $self->{dbh}->do("UPDATE automator_history SET pgid = ? WHERE id = ?", undef, $pgid, $id);
}

sub DB::finish_automator_history {
    my ($self, $id, $status, $output, $json_result) = @_;
    $self->ensure_connection;
    my $json = ref($json_result) ? encode_json($json_result) : undef;
    $self->{dbh}->do(
        "UPDATE automator_history SET status=?, output=?, json_result=?, finished_at=NOW() WHERE id=?",
        undef, $status, $output, $json, $id
    );
}

sub DB::append_automator_history_output {
    my ($self, $id, $line) = @_;
    $self->ensure_connection;
    $self->{dbh}->do(
        "UPDATE automator_history SET output = CONCAT(COALESCE(output, ''), ?) WHERE id = ?",
        undef, $line, $id
    );
}

sub DB::automator_active_run_count {
    my ($self) = @_;
    $self->ensure_connection;
    my ($count) = $self->{dbh}->selectrow_array("SELECT COUNT(*) FROM automator_history WHERE status = 'running'");
    return int($count || 0);
}

sub DB::automator_log_audit {
    my ($self, $user_id, $action, $target_type, $target_id, $details) = @_;
    $self->ensure_connection;
    my $json = ref($details) ? encode_json($details) : ($details // '{}');
    $self->{dbh}->do(
        "INSERT INTO automator_audit (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
        undef, $user_id, $action, $target_type, $target_id, $json
    );
}

sub DB::abort_automator_history {
    my ($self, $id) = @_;
    $self->ensure_connection;
    $self->{dbh}->do(
        "UPDATE automator_history SET status='aborted', finished_at=NOW() WHERE id=? AND status='running'",
        undef, $id
    );
}

sub DB::delete_automator_history {
    my ($self, $id) = @_;
    $self->ensure_connection;
    $self->{dbh}->do(
        "DELETE FROM automator_history WHERE id = ? AND status <> 'running'",
        undef, $id
    );
}

sub DB::automator_heartbeat {
    my ($self) = @_;
    $self->ensure_connection;
    my $stale = $self->{dbh}->selectall_arrayref(q{
        SELECT id, pgid FROM automator_history
         WHERE status = 'running'
           AND started_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)
    }, { Slice => {} });

    for my $h (@$stale) {
        next unless $h->{pgid};
        my $alive = kill 0, -$h->{pgid};
        next if $alive;
        $self->{dbh}->do(
            "UPDATE automator_history SET status='timed_out', finished_at=NOW() WHERE id=?",
            undef, $h->{id}
        );
        my $staging = $self->_automator_staging_root . "/automator_$h->{id}";
        remove_tree($staging) if -d $staging;
    }
}

sub DB::_automator_staging_root {
    my ($self) = @_;
    return $ENV{AUTOMATOR_STAGING_ROOT} if $ENV{AUTOMATOR_STAGING_ROOT};
    return $self->{app}->config->{automator}{staging_root}
        if $self->{app} && $self->{app}->config->{automator} && $self->{app}->config->{automator}{staging_root};
    return '/dev/shm';
}

sub DB::_automator_next_run {
    my ($self, $type, $interval_hours, $daily_time) = @_;
    my $tz = $self->{timezone} || 'UTC';
    my $now = DateTime->now(time_zone => $tz);
    my $next;

    if ($type eq 'daily') {
        my ($hour, $minute) = split /:/, ($daily_time || '00:00');
        $next = $now->clone->set(hour => $hour, minute => $minute, second => 0);
        $next->add(days => 1) if DateTime->compare($next, $now) <= 0;
    } else {
        my $hours = int($interval_hours || 1);
        $hours = 1 if $hours < 1;
        $next = $now->clone->add(hours => $hours)->set(second => 0);
    }

    return $next->strftime('%F %T');
}

sub DB::_json_decode {
    my ($self, $json, $fallback) = @_;
    return $fallback unless defined $json && length $json;
    my $out;
    eval { $out = decode_json($json); 1 } ? $out : $fallback;
}

sub DB::_automator_app_secret {
    my ($self) = @_;
    return $ENV{APP_SECRET} if $ENV{APP_SECRET};
    return $self->get_app_secret || die "Application secret is not configured";
}

sub DB::_automator_derive_key {
    my ($self, $salt) = @_;
    return Crypt::PBKDF2->new(
        hash_class => 'HMACSHA2',
        iterations => 100_000,
        output_len => 32,
    )->PBKDF2($self->_automator_app_secret, $salt);
}

sub DB::_automator_encrypt_secret {
    my ($self, $plaintext) = @_;
    my $salt = urandom(32);
    my $iv   = urandom(12);
    my $key  = $self->_automator_derive_key($salt);
    my $gcm  = Crypt::AuthEnc::GCM->new('AES', $key);
    $gcm->iv_add($iv);
    my $ciphertext = $gcm->encrypt_add($plaintext);
    my $tag = $gcm->encrypt_done;
    substr($key, 0) = "\x00" x length($key);
    return ($ciphertext, $iv, $tag, $salt);
}

sub DB::_automator_decrypt_secret {
    my ($self, $ciphertext, $iv, $tag, $salt) = @_;
    my $key = $self->_automator_derive_key($salt);
    my $gcm = Crypt::AuthEnc::GCM->new('AES', $key);
    $gcm->iv_add($iv);
    my $plaintext = $gcm->decrypt_add($ciphertext);
    my $ok = $gcm->decrypt_done($tag);
    substr($key, 0) = "\x00" x length($key);
    die "GCM tag verification failed" unless $ok;
    return $plaintext;
}

1;
