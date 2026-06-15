# /lib/MyApp/Controller/Admin/Automator.pm

package MyApp::Controller::Admin::Automator;

use Mojo::Base 'Mojolicious::Controller';
use Cpanel::JSON::XS qw(decode_json encode_json);
use DB;
use File::Path qw(make_path remove_tree);
use File::Copy qw(copy);
use IO::Select;
use IPC::Open3;
use Mojo::IOLoop;
use Mojo::IOLoop::Subprocess;
use POSIX qw(setsid);
use Symbol qw(gensym);

my %CLIENTS;

# Controller for high-privilege Ansible orchestration and infrastructure management.
#
# Features:
#   - Vault setup, unlock, lock, and inactivity enforcement.
#   - State-driven API surface for playbooks, inventories, secrets, and history.
#   - Background ansible-playbook execution with process-group abort support.
#   - WebSocket log subscribers for active run output.
# Integration Points:
#   - Ansible CLI: Executes playbooks via system subprocess.
#   - Database: Persists orchestration history and secrets.
#   - Restricted to 'admin' bridge via router.

# Renders the primary Automator dashboard interface.
# Route: GET /admin/automator
sub index {
    my $c = shift;
    return $c->redirect_to('/login') unless $c->is_logged_in;
    return $c->render('noperm') unless $c->is_admin;
    $c->render('admin/automator');
}

# Returns the consolidated state for the Automator dashboard.
# Route: GET /admin/automator/api/state
sub api_state {
    my $c = shift;
    return _locked($c) unless _api_allowed($c);
    my $state = $c->db->get_automator_state(_state_filters($c));
    $state->{success} = 1;
    $state->{unlocked} = 1;
    $state->{is_admin} = $c->is_admin ? 1 : 0;
    $state->{max_concurrent_runs} = _max_runs($c);
    $state->{admins} = $c->db->get_admins();
    $c->render(json => $state);
}

# Lists execution history with support for pagination and filtering.
# Route: GET /admin/automator/api/history
# Parameters:
#   page     : Current page number
#   per_page : Items per page (default 50)
sub api_history {
    my $c = shift;
    return _locked($c) unless _api_allowed($c);
    my $page = int($c->param('page') || 1);
    $page = 1 if $page < 1;
    my $per_page = int($c->param('per_page') || 50);
    $per_page = 100 if $per_page > 100;
    my $rows = $c->db->list_automator_history(_state_filters($c), $per_page, ($page - 1) * $per_page);
    $c->render(json => { success => 1, history => $rows, has_more => scalar(@$rows) == $per_page ? 1 : 0 });
}

# Checks the current unlock status of the Automator vault.
# Route: GET /admin/automator/api/status
sub api_vault_status {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    $c->render(json => {
        success        => 1,
        setup_required => $c->db->automator_master_exists ? 0 : 1,
        unlocked       => _vault_unlocked($c, 0) ? 1 : 0
    });
}

# Initializes the master password for the orchestration vault.
# Route: POST /admin/automator/api/vault/setup
# Parameters:
#   password : New master password (min 8 chars)
sub api_vault_setup {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    return $c->render(json => { success => 0, error => 'Vault already initialized' }, status => 409)
        if $c->db->automator_master_exists;
    my $password = $c->param('password') // '';
    return $c->render(json => { success => 0, error => 'Master password must be at least 8 characters' }, status => 400)
        if length($password) < 8;
    eval { $c->db->automator_set_master_password($password); };
    return $c->render(json => { success => 0, error => "$@" }, status => 500) if $@;
    _unlock_session($c);
    $c->db->automator_log_audit($c->current_user_id, 'vault_setup', 'vault', undef, {});
    $c->render(json => { success => 1, message => 'Vault initialized' });
}

# Verifies the master password and unlocks the orchestration session.
# Route: POST /admin/automator/api/vault/unlock
# Parameters:
#   password : Master password
sub api_vault_unlock {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    my $password = $c->param('password') // '';
    unless ($c->db->automator_verify_master_password($password)) {
        return $c->render(json => { success => 0, error => 'Invalid master password' }, status => 403);
    }
    _unlock_session($c);
    $c->render(json => { success => 1, message => 'Vault unlocked' });
}

# Revokes the current orchestration session lock.
# Route: POST /admin/automator/api/vault/lock
sub api_vault_lock {
    my $c = shift;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403) unless $c->is_admin;
    $c->session(automator_unlocked => 0);
    $c->session(automator_last_activity => 0);
    $c->render(json => { success => 1, message => 'Vault locked' });
}

# Saves or updates an inventory configuration.
# Route: POST /admin/automator/api/inventory/save
# Parameters:
#   id           : Existing inventory ID (optional)
#   name         : Display name
#   category     : Organizational category
#   hosts        : Raw Ansible inventory content
#   ssh_key_path : Custom SSH key path (optional)
sub api_save_inventory {
    my $c = shift;
    return _locked($c) unless _api_allowed($c);
    my $existing_id = $c->param('id') || undef;
    if ($existing_id) {
        my $existing = $c->db->get_automator_inventory($existing_id);
        return $c->render(json => { success => 0, error => 'Inventory not found' }, status => 404)
            unless _owned_record($c, $existing);
    }
    my $hosts = $c->param('hosts') // '';
    my $err = _validate_inventory($hosts);
    return $c->render(json => { success => 0, error => $err }, status => 400) if $err;
    my $id = $c->db->save_automator_inventory({
        id           => $existing_id,
        name         => $c->param('name') || 'Untitled Inventory',
        category     => $c->param('category') || 'General',
        hosts        => $hosts,
        ssh_key_path => $c->param('ssh_key_path') || undef,
        user_id      => $c->current_user_id,
    });
    $c->db->automator_log_audit($c->current_user_id, 'edit_inventory', 'inventory', $id, { name => $c->param('name') });
    $c->render(json => { success => 1, message => 'Inventory saved', state => $c->db->get_automator_state(_state_filters($c)) });
}

# Saves or updates a playbook configuration.
# Route: POST /admin/automator/api/playbook/save
# Parameters:
#   id                 : Existing playbook ID (optional)
#   name               : Display name
#   content            : Playbook YAML content
#   inventory_id       : Target inventory
#   dynamic_vars       : JSON string of required variables
#   log_retention_days : History pruning window
sub api_save_playbook {
    my $c = shift;
    return _locked($c) unless _api_allowed($c);
    my $content = $c->param('content') // '';
    my $err = _validate_yaml($content);
    return $c->render(json => { success => 0, error => $err }, status => 400) if $err;

    my $dynamic = $c->param('dynamic_vars') || '{}';
    my $dynamic_vars = {};
    eval { $dynamic_vars = decode_json($dynamic); 1 } or
        return $c->render(json => { success => 0, error => 'Dynamic vars must be valid JSON' }, status => 400);
    return $c->render(json => { success => 0, error => 'Dynamic vars must be a JSON object' }, status => 400)
        unless ref($dynamic_vars) eq 'HASH';

    my $id = $c->param('id') || undef;
    if ($id) {
        my $existing = $c->db->get_automator_playbook($id);
        return $c->render(json => { success => 0, error => 'Playbook not found' }, status => 404)
            unless _owned_record($c, $existing);
    }
    my $chain = $c->param('success_chain_id') || undef;
    return $c->render(json => { success => 0, error => 'Success chain cycle detected' }, status => 409)
        if $id && $chain && $c->db->automator_chain_has_cycle($id, $chain);
    if (my $inventory_id = $c->param('inventory_id')) {
        my $inventory = $c->db->get_automator_inventory($inventory_id);
        return $c->render(json => { success => 0, error => 'Inventory not found' }, status => 404)
            unless _owned_record($c, $inventory);
    }
    if ($chain) {
        my $chain_playbook = $c->db->get_automator_playbook($chain);
        return $c->render(json => { success => 0, error => 'Success chain playbook not found' }, status => 404)
            unless _owned_record($c, $chain_playbook);
    }
    my $secrets_json = $c->param('secrets') || '[]';
    my $secrets = [];
    eval { $secrets = decode_json($secrets_json); 1 } or
        return $c->render(json => { success => 0, error => 'Secrets must be valid JSON' }, status => 400);
    return $c->render(json => { success => 0, error => 'Secrets must be an array' }, status => 400)
        unless ref($secrets) eq 'ARRAY';
    my %allowed_usage = map { $_ => 1 } qw(file env ssh_key vault_password);
    my %seen_alias;
    my %single_use;
    for my $secret (@$secrets) {
        return $c->render(json => { success => 0, error => 'Secret not found' }, status => 404)
            unless ref($secret) eq 'HASH' && _owned_secret($c, $secret->{secret_id});
        return $c->render(json => { success => 0, error => 'Invalid secret alias' }, status => 400)
            unless defined $secret->{alias} && $secret->{alias} =~ /\A[A-Za-z_][A-Za-z0-9_]*\z/;
        return $c->render(json => { success => 0, error => 'Duplicate secret alias' }, status => 400)
            if $seen_alias{lc $secret->{alias}}++;
        return $c->render(json => { success => 0, error => 'Invalid secret usage' }, status => 400)
            unless $allowed_usage{$secret->{usage_type} || ''};
        return $c->render(json => { success => 0, error => 'Only one SSH key secret is allowed' }, status => 400)
            if $secret->{usage_type} eq 'ssh_key' && $single_use{ssh_key}++;
        return $c->render(json => { success => 0, error => 'Only one vault password secret is allowed' }, status => 400)
            if $secret->{usage_type} eq 'vault_password' && $single_use{vault_password}++;
    }

    my $saved_id = $c->db->save_automator_playbook({
        id                       => $id,
        name                     => $c->param('name') || 'Untitled Playbook',
        category                 => $c->param('category') || 'General',
        description              => $c->param('description') || '',
        content                  => $content,
        inventory_id             => $c->param('inventory_id') || undef,
        dynamic_vars             => $dynamic_vars,
        tags                     => $c->param('tags') || undef,
        skip_tags                => $c->param('skip_tags') || undef,
        limit_hosts        => $c->param('limit_hosts') || undef,
        success_chain_id   => $chain,
        playbook_secret_id => $c->param('playbook_secret_id') || undef,
        log_retention_days => int($c->param('log_retention_days') || 30),
        user_id                  => $c->current_user_id,
    });
    eval { $c->db->save_automator_playbook_secrets($saved_id, $secrets); 1 } or
        return $c->render(json => { success => 0, error => "$@" }, status => 400);

    my $notif_json = $c->param('notifications') || '[]';
    my $notifications = [];
    eval { $notifications = decode_json($notif_json); 1 } or
        return $c->render(json => { success => 0, error => 'Notifications must be valid JSON' }, status => 400);
    eval { $c->db->save_automator_playbook_notifications($saved_id, $notifications); 1 } or
        return $c->render(json => { success => 0, error => "$@" }, status => 400);

    eval {
        $c->db->save_automator_schedule($saved_id, {
            schedule_type  => $c->param('schedule_type') || 'none',
            interval_hours => $c->param('schedule_interval_hours') || 1,
            daily_time     => $c->param('schedule_daily_time') || '00:00',
        });
    };
    return $c->render(json => { success => 0, error => "$@" }, status => 400) if $@;
    $c->db->automator_log_audit($c->current_user_id, 'edit_playbook', 'playbook', $saved_id, { name => $c->param('name') });
    $c->render(json => { success => 1, message => 'Playbook saved', state => $c->db->get_automator_state(_state_filters($c)) });
}

# Permanently removes a playbook and its associated metadata.
# Route: POST /admin/automator/api/playbook/delete/:id
# Parameters:
#   id : Target playbook ID
sub api_delete_playbook {
    my $c = shift;
    return _locked($c) unless _api_allowed($c);
    my $id = $c->stash('id');
    my $playbook = $c->db->get_automator_playbook($id);
    return $c->render(json => { success => 0, error => 'Playbook not found' }, status => 404)
        unless _owned_record($c, $playbook);
    $c->db->soft_delete_automator_playbook($id);
    $c->db->automator_log_audit($c->current_user_id, 'delete_playbook', 'playbook', $id, {});
    $c->render(json => { success => 1, message => 'Playbook deleted', state => $c->db->get_automator_state(_state_filters($c)) });
}

# Permanently removes an inventory configuration.
# Route: POST /admin/automator/api/inventory/delete/:id
# Parameters:
#   id : Target inventory ID
sub api_delete_inventory {
    my $c = shift;
    return _locked($c) unless _api_allowed($c);
    my $id = $c->stash('id');
    my $inventory = $c->db->get_automator_inventory($id);
    return $c->render(json => { success => 0, error => 'Inventory not found' }, status => 404)
        unless _owned_record($c, $inventory);
    eval { $c->db->delete_automator_inventory($id, $c->current_user_id); 1 }
        or return $c->render(
            json   => { success => 0, error => "$@" =~ /still used/ ? 'Inventory is still used by active playbooks' : 'Database error' },
            status => "$@" =~ /still used/ ? 409 : 500
        );
    $c->db->automator_log_audit($c->current_user_id, 'delete_inventory', 'inventory', $id, {});
    $c->render(json => { success => 1, message => 'Inventory deleted', state => $c->db->get_automator_state(_state_filters($c)) });
}

# Saves or updates a managed secret.
# Route: POST /admin/automator/api/secret/save
# Parameters:
#   id       : Existing secret ID (optional)
#   name     : Secret alias
#   category : Secret category
#   value    : Plaintext value (encrypted before storage)
sub api_save_secret {
    my $c = shift;
    return _locked($c) unless _api_allowed($c);
    my $id = $c->param('id') || undef;
    return $c->render(json => { success => 0, error => 'Secret not found' }, status => 404)
        if $id && !_owned_secret($c, $id);
    my $secret;
    eval {
        $secret = $c->db->save_automator_secret(
            $id,
            $c->param('name') // '',
            $c->param('category') || 'General',
            $c->param('value') // '',
            $c->current_user_id
        );
    };
    return $c->render(json => { success => 0, error => "$@" }, status => 400) if $@;
    $c->db->automator_log_audit($c->current_user_id, 'edit_secret', 'secret', $secret->{id}, { name => $secret->{name} });
    $c->render(json => { success => 1, message => 'Secret saved', secret => $secret, state => $c->db->get_automator_state(_state_filters($c)) });
}

# Permanently removes a managed secret.
# Route: POST /admin/automator/api/secret/delete/:id
# Parameters:
#   id : Target secret ID
sub api_delete_secret {
    my $c = shift;
    return _locked($c) unless _api_allowed($c);
    my $id = $c->stash('id');
    return $c->render(json => { success => 0, error => 'Secret not found' }, status => 404)
        unless _owned_secret($c, $id);
    $c->db->delete_automator_secret($id, $c->current_user_id);
    $c->db->automator_log_audit($c->current_user_id, 'delete_secret', 'secret', $id, {});
    $c->render(json => { success => 1, message => 'Secret deleted', state => $c->db->get_automator_state(_state_filters($c)) });
}

# Initiates a new playbook execution.
# Route: POST /admin/automator/api/run
# Parameters:
#   playbook_id : ID of the playbook to execute
#   mode        : 'run' or 'check'
#   vars        : JSON string of variables to apply
sub api_run {
    my $c = shift;
    return _locked($c) unless _api_allowed($c);
    return $c->render(json => { success => 0, error => 'Concurrency limit reached' }, status => 429)
        if $c->db->automator_active_run_count >= _max_runs($c);

    my $playbook_id = $c->param('playbook_id');
    my $mode = ($c->param('mode') // 'run') eq 'check' ? 'check' : 'run';
    my $vars = {};
    eval { $vars = decode_json($c->param('vars') || '{}'); 1 } or
        return $c->render(json => { success => 0, error => 'Variables must be valid JSON' }, status => 400);

    my $playbook = $c->db->get_automator_playbook($playbook_id);
    return $c->render(json => { success => 0, error => 'Playbook not found' }, status => 404)
        unless _owned_record($c, $playbook);

    my $history_id = $c->db->create_automator_history($playbook_id, $mode, $vars, $c->current_user_id);
    my $payload;
    eval { $payload = _load_run_payload($c->db, $playbook_id); 1 } or do {
        $c->db->finish_automator_history($history_id, 'failed', "Cannot prepare Automator run: $@", undef);
        return $c->render(json => { success => 0, error => "$@" }, status => 500);
    };
    _spawn_run($c->app, $history_id, $mode, $vars, $payload);
    $c->render(json => { success => 1, message => 'Run started', history_id => $history_id, state => $c->db->get_automator_state(_state_filters($c)) });
}

# Requests the immediate termination of a running playbook.
# Route: POST /admin/automator/api/abort/:id
# Parameters:
#   id : History record ID to abort
sub api_abort {
    my $c = shift;
    return _locked($c) unless _api_allowed($c);
    my $id = $c->stash('id');
    my $h = $c->db->get_automator_history($id);
    return $c->render(json => { success => 0, error => 'Run not found' }, status => 404)
        unless _owned_history($c, $h);
    return $c->render(json => { success => 0, error => 'Run is not active' }, status => 409) unless $h->{status} eq 'running';

    _terminate_ansible_group($h->{pgid}, _automator_ansible_command_name($c->app)) if $h->{pgid};
    $c->db->abort_automator_history($id);
    _broadcast($id, "\n[Automator] Abort requested.\n");
    $c->db->automator_log_audit($c->current_user_id, 'abort_run', 'history', $id, {});
    $c->render(json => { success => 1, message => 'Run abort requested', state => $c->db->get_automator_state(_state_filters($c)) });
}

# Permanently removes one finished run history log.
# Route: POST /admin/automator/api/history/delete/:id
# Parameters:
#   id : History record ID to delete
sub api_delete_history {
    my $c = shift;
    return _locked($c) unless _api_allowed($c);
    my $id = $c->stash('id');
    my $h = $c->db->get_automator_history($id);
    return $c->render(json => { success => 0, error => 'Run not found' }, status => 404)
        unless _owned_history($c, $h);
    return $c->render(json => { success => 0, error => 'Cannot delete a running log' }, status => 409)
        if ($h->{status} // '') eq 'running';

    $c->db->delete_automator_history($id);
    $c->db->automator_log_audit($c->current_user_id, 'delete_history', 'history', $id, {});
    $c->render(json => { success => 1, message => 'Log deleted', state => $c->db->get_automator_state(_state_filters($c)) });
}

# Requests a global abort for all currently running playbooks.
# Route: POST /admin/automator/api/abort/all
sub api_abort_all {
    my $c = shift;
    return _locked($c) unless _api_allowed($c);
    my $active = $c->db->list_automator_history({ status => 'running' }, 100, 0);
    for my $h (@$active) {
        _terminate_ansible_group($h->{pgid}, _automator_ansible_command_name($c->app)) if $h->{pgid};
        $c->db->abort_automator_history($h->{id});
        _broadcast($h->{id}, "\n[Automator] Global abort requested.\n");
    }
    $c->db->automator_log_audit($c->current_user_id, 'abort_run', 'history', undef, { count => scalar @$active });
    $c->render(json => { success => 1, message => 'Global abort requested', state => $c->db->get_automator_state(_state_filters($c)) });
}

sub ws {
    my $c = shift;
    return $c->finish(1008) unless _api_allowed($c);
    my $history_id = $c->stash('history_id');
    my $h = $c->db->get_automator_history($history_id);
    return $c->finish(1008) unless _owned_history($c, $h);

    $CLIENTS{$history_id}{$c->tx} = $c;
    $c->inactivity_timeout(1800);
    my $offset = length($h->{output} || '');
    $c->send($h->{output}) if $offset;

    my $timer_id;
    my $last_status = '';
    $timer_id = Mojo::IOLoop->recurring(1 => sub {
        my $row = eval { $c->db->get_automator_history($history_id) };
        return unless $row;
        
        my $status = $row->{status} || 'running';
        if ($status ne $last_status) {
            $c->send("###STATUS:$status###");
            $last_status = $status;
        }

        my $output = $row->{output} || '';
        my $length = length($output);
        if ($length > $offset) {
            $c->send(substr($output, $offset));
            $offset = $length;
        }
        return if $status eq 'running';
        Mojo::IOLoop->remove($timer_id);
    });

    $c->on(finish => sub {
        delete $CLIENTS{$history_id}{$c->tx};
        Mojo::IOLoop->remove($timer_id);
    });
}

sub _spawn_run {
    my ($app, $history_id, $mode, $vars, $payload, $depth) = @_;
    $depth //= 0;
    my $home = $app->home->to_string;
    my $timezone = $app->config->{timezone} || 'UTC';
    my $staging_root = _automator_staging_root($app);
    my $ansible_bin = _automator_ansible_bin($app);
    my $stream_db;
    my $subprocess = Mojo::IOLoop::Subprocess->new;
    $subprocess->on(progress => sub {
        my ($subprocess, $event) = @_;
        if (ref $event eq 'HASH' && $event->{type} && $event->{type} eq 'pgid') {
            $stream_db ||= DB->new(timezone => $timezone);
            $stream_db->update_automator_history_pgid($event->{history_id}, $event->{pgid});
            return;
        }
        return unless ref $event eq 'HASH' && $event->{type} && $event->{type} eq 'line';
        $stream_db ||= DB->new(timezone => $timezone);
        $stream_db->append_automator_history_output($event->{history_id}, $event->{line});
    });
    $subprocess->run(
        sub {
            my $subprocess = shift;
            return _run_automator_job($app, $home, $staging_root, $ansible_bin, $history_id, $mode, $vars, $payload, $subprocess);
        },
        sub {
            my ($subprocess, $err, $result) = @_;
            $app->log->error("Automator subprocess failed: $err") if $err;
            my $db = $stream_db || DB->new(timezone => $timezone);
            my $existing = $db->get_automator_history($history_id);
            my $status = $existing && $existing->{status} eq 'aborted' ? 'aborted' : (($result || {})->{status} || 'failed');
            my $output = ($result || {})->{output} || ($err ? "Automator subprocess failed: $err" : '');
            $output .= "\n[Automator] Run finished with status: $status\n";
            $db->finish_automator_history($history_id, $status, $output, ($result || {})->{json_result});
            
            # Trigger notifications only for scheduled (automated) tasks
            _trigger_automated_notifications($app, $history_id) unless $existing && $existing->{triggered_by};

            # Trigger success chain if applicable
            _maybe_trigger_chain($app, $history_id, $depth);
        }
    );
}

sub _trigger_automated_notifications {
    my ($app, $history_id) = @_;
    my $db = DB->new(timezone => $app->config->{timezone} || 'UTC');
    my $h = $db->get_automator_history($history_id);
    return unless $h && $h->{playbook_id};

    my $notifs = $db->list_automator_playbook_notifications($h->{playbook_id});
    return unless @$notifs;

    my $status = $h->{status};
    my $emoji = $status eq 'success' ? '🟢' : '🔴';
    my $subject = "Automator: $h->{playbook_name} - $status";

    my $summary = "";
    my $json = $h->{json_result};
    if ($json && ref($json) eq 'HASH') {
        my $stats = $json->{stats} || {};
        my $total_hosts = scalar keys %$stats;
        my $changed = 0;
        my $failed  = 0;
        for my $host (values %$stats) {
            $changed += $host->{changed} || 0;
            $failed  += $host->{failures} || 0;
            $failed  += $host->{unreachable} || 0;
        }

        $summary .= "\n**Summary:** $total_hosts hosts processed. $changed changes applied.";
        if ($failed > 0) {
            $summary .= "\n\n**Failures:**\n";
            my $failures = $json->{failures} || [];
            for my $f (@$failures) {
                my $msg = $f->{message} || 'Unknown error';
                $msg = substr($msg, 0, 150) . '...' if length($msg) > 150;
                $summary .= "- **$f->{host}** ($f->{task}): $msg\n";
            }
        }
    }

    my $c = $app->build_controller;
    my $user_icon = $c->getUserIcon($h->{triggered_by_name} || 'system');
    my $caller_id = 0;
    my $message = "$emoji **Scheduled Task Completed**\n\n"
                . "**Playbook:** $h->{playbook_name}\n"
                . "**Status:** $status"
                . $summary . "\n\n"
                . "**Triggered By:** $user_icon " . ($h->{triggered_by_name} || 'system') . "\n"
                . "**ID:** #$h->{id}\n"
                . "**Finished:** $h->{finished_at}\n\n"
                . "[View Log](" . $app->config->{url} . "/admin/automator)";

    foreach my $n (@$notifs) {
        next if $n->{notify_on} eq 'success' && $status ne 'success';
        next if $n->{notify_on} eq 'failure' && $status eq 'success';

        if ($n->{channel} eq 'discord') {
            my $user = $db->get_user_by_id($n->{user_id});
            $c->send_discord_dm($user->{discord_id}, $message, $n->{user_id}, $caller_id) if $user && $user->{discord_id};
        }
        elsif ($n->{channel} eq 'email') {
            my $user = $db->get_user_by_id($n->{user_id});
            $c->send_email_via_gmail($user->{email}, $subject, $message, $n->{user_id}, $caller_id) if $user && $user->{email};
        }
        elsif ($n->{channel} eq 'pushover') {
            $c->push_pushover($message, $n->{user_id}, $caller_id);
        }
        elsif ($n->{channel} eq 'fcm') {
            $c->push_fcm($n->{user_id}, $subject, $message, "/admin/automator", $caller_id);
        }
        elsif ($n->{channel} eq 'gotify') {
            $c->push_gotify($message, $subject, 5, $n->{user_id}, $caller_id);
        }
    }
}

sub _maybe_trigger_chain {
    my ($app, $history_id, $depth) = @_;
    $depth //= 0;
    return if $depth >= 10;

    my $db = DB->new(timezone => $app->config->{timezone} || 'UTC');
    my $h = $db->get_automator_history($history_id);
    return unless $h && $h->{status} eq 'success';

    my $pb = $db->get_automator_playbook($h->{playbook_id});
    return unless $pb && $pb->{success_chain_id};

    # Concurrency check
    return if $db->automator_active_run_count >= _max_runs($app);

    # Load payload for next playbook
    my $next_id = $pb->{success_chain_id};
    my $payload = eval { _load_run_payload($db, $next_id) };
    if ($@) {
        $app->log->error("Automator chain failure: Could not load playbook $next_id: $@");
        return;
    }

    # Create history and spawn
    my $new_history_id = $db->create_automator_history($next_id, 'run', {}, $h->{triggered_by});
    $app->log->info("Automator: Success chain triggering playbook $next_id (depth " . ($depth + 1) . ")");
    _spawn_run($app, $new_history_id, 'run', {}, $payload, $depth + 1);
}

sub _run_automator_job {
    my ($app, $home, $staging_root, $ansible_bin, $history_id, $mode, $vars, $payload, $subprocess) = @_;
    setsid();
    $subprocess->progress({ type => 'pgid', history_id => $history_id, pgid => $$ });

    my $staging = "$staging_root/automator_$history_id";
    my $output = '';
    my $status = 'failed';
    eval {
        _prepare_staging($home, $payload, $vars, $staging_root, $staging);
        my $worker_key = _automator_worker_key($app);
        my $cmd = _build_command($payload, $mode, $staging, $ansible_bin, $worker_key);
        my %env = (
            %ENV,
            %{ $payload->{secret_env} || {} },
            ANSIBLE_STDOUT_CALLBACK    => 'default',
            ANSIBLE_CALLBACKS_ENABLED  => 'json_to_file',
            ANSIBLE_CALLBACK_PLUGINS   => "$staging/callback_plugins",
            AUTOMATOR_JSON_EXPORT_PATH => "$staging/result.json",
        );
        local %ENV = %env;
        my $err = gensym;
        my $pid = open3(undef, my $out, $err, @$cmd);
        my $select = IO::Select->new($out, $err);
        while ($select->count) {
            for my $fh ($select->can_read) {
                my $line = <$fh>;
                unless (defined $line) {
                    $select->remove($fh);
                    close $fh;
                    next;
                }
                $output .= $line;
                $subprocess->progress({ type => 'line', history_id => $history_id, line => $line });
            }
        }
        waitpid($pid, 0);
        $status = $? == 0 ? 'success' : 'failed';
    };
    if ($@) {
        $output .= "\n[Automator] $@\n";
        $subprocess->progress({ type => 'line', history_id => $history_id, line => "\n[Automator] $@\n" });
    }
    my $json_result;
    if (-f "$staging/result.json") {
        eval { local $/; open my $fh, '<', "$staging/result.json"; $json_result = decode_json(<$fh>); };
    }
    remove_tree($staging) if -d $staging;
    return { status => $status, output => $output, json_result => $json_result };
}

sub _prepare_staging {
    my ($home, $payload, $vars, $staging_root, $staging) = @_;
    $vars ||= {};
    my $avail = _staging_available_kb($staging_root);
    die "Insufficient staging space for Automator" if defined $avail && $avail < 10_240;
    make_path($staging, { mode => 0700 });
    chmod 0700, $staging;

    my $playbook = $payload->{playbook} || die "Playbook not found";
    _write_private("$staging/playbook.yml", $playbook->{content});

    my $inventory = $payload->{inventory};
    if ($inventory) {
        _write_private("$staging/inventory.ini", $inventory->{hosts});
    }

    my %secret_files;
    my %secret_env;
    for my $entry (@{ $payload->{secrets} || [] }) {
        my $alias = $entry->{alias};
        my $usage = $entry->{usage_type} || 'file';
        my $value = $entry->{value};
        next unless defined $alias && defined $value;
        if ($usage eq 'env') {
            $secret_env{"AUTOMATOR_SECRET_" . uc($alias)} = $value;
            next;
        }
        my $path = $usage eq 'ssh_key' ? "$staging/ssh_key" :
                   $usage eq 'vault_password' ? "$staging/vault.pass" :
                   "$staging/secrets/$alias";
        make_path("$staging/secrets", { mode => 0700 }) if $usage eq 'file';
        
        my $out_value = $value;
        if ($usage eq 'ssh_key' || $usage eq 'vault_password') {
            $out_value =~ s/^\s+//; # Remove leading
            $out_value =~ s/\s+$//; # Remove trailing
            $out_value =~ s/\r//g;  # Remove DOS
            $out_value .= "\n";     # Ensure terminator
        }
        _write_private($path, $out_value);
        $secret_files{$alias} = $path;
        $vars->{automator_secret_file} = $path if !defined $vars->{automator_secret_file} && $usage eq 'file';
        substr($value, 0) = "\x00" x length($value);
    }
    $vars->{automator_secret_files} = \%secret_files if %secret_files;
    $payload->{secret_env} = \%secret_env if %secret_env;

    _write_private("$staging/vars.json", encode_json($vars || {}));

    if (defined $payload->{vault_password}) {
        my $pass = $payload->{vault_password};
        _write_private("$staging/vault.pass", $pass);
        substr($pass, 0) = "\x00" x length($pass);
    }

    make_path("$staging/callback_plugins", { mode => 0700 });
    my $plugin = "$home/lib/ansible/callback_plugins/json_to_file.py";
    copy($plugin, "$staging/callback_plugins/json_to_file.py") if -f $plugin;
}

sub _staging_available_kb {
    my ($staging_root) = @_;
    open my $df, '-|', 'df', '-Pk', $staging_root or die "Cannot inspect Automator staging capacity: $!";
    my @lines = <$df>;
    close $df;
    return undef unless $lines[1];
    my @fields = split /\s+/, $lines[1];
    return $fields[3];
}

sub _terminate_ansible_group {
    my ($pgid, $command_name) = @_;
    return unless $pgid;
    open my $ps, '-|', 'ps', '-o', 'comm=', '-g', $pgid or return;
    my @commands = <$ps>;
    close $ps;
    chomp @commands;
    return unless grep { $_ eq $command_name } @commands;
    kill 'TERM', -$pgid;
}

sub _build_command {
    my ($payload, $mode, $staging, $ansible_bin, $worker_key) = @_;
    my $playbook = $payload->{playbook} || die "Playbook not found";
    my @cmd = ($ansible_bin, "$staging/playbook.yml", '--extra-vars', "\@$staging/vars.json");

    if (-f "$staging/ssh_key") {
        push @cmd, '--private-key', "$staging/ssh_key";
    } elsif ($worker_key && -f $worker_key) {
        push @cmd, '--private-key', $worker_key;
    } else {
        die "Automator worker key not found at $worker_key";
    }

    push @cmd, '--inventory', "$staging/inventory.ini" if -f "$staging/inventory.ini";
    push @cmd, '--vault-password-file', "$staging/vault.pass" if -f "$staging/vault.pass";
    push @cmd, '--tags', $playbook->{tags} if $playbook->{tags};
    push @cmd, '--skip-tags', $playbook->{skip_tags} if $playbook->{skip_tags};
    push @cmd, '--limit', $playbook->{limit_hosts} if $playbook->{limit_hosts};
    push @cmd, '--check', '--diff' if $mode eq 'check';
    return \@cmd;
}

sub _load_run_payload {
    my ($db, $playbook_id) = @_;
    my $playbook = $db->get_automator_playbook($playbook_id) || die "Playbook not found";
    my $owner_id = $playbook->{user_id} || die "Playbook owner missing";
    my $inventory = $playbook->{inventory_id} ? $db->get_automator_inventory($playbook->{inventory_id}) : undef;
    my $secrets = $db->list_automator_playbook_secrets($playbook_id);
    if (!@$secrets && $playbook->{playbook_secret_id}) {
        push @$secrets, {
            secret_id   => $playbook->{playbook_secret_id},
            alias       => 'default',
            usage_type  => 'file',
            secret_name => 'Legacy Playbook Secret',
        };
    }
    for my $secret (@$secrets) {
        $secret->{value} = $db->get_automator_secret_plaintext($secret->{secret_id}, $owner_id);
    }
    return {
        playbook  => $playbook,
        inventory => $inventory,
        secrets   => $secrets,
    };
}

sub _automator_config {
    my ($app) = @_;
    return $app->config->{automator} || {};
}

sub _automator_staging_root {
    my ($app) = @_;
    my $config = _automator_config($app);
    return $config->{staging_root} || $ENV{AUTOMATOR_STAGING_ROOT} || '/dev/shm';
}

sub _automator_worker_key {
    my ($app) = @_;
    my $config = _automator_config($app);
    # Fallback to the standard path we just set up
    return $config->{worker_key} || $ENV{AUTOMATOR_WORKER_KEY} || "$ENV{HOME}/.ssh/ansible_worker";
}

sub _automator_ansible_bin {
    my ($app) = @_;
    my $config = _automator_config($app);
    return $config->{ansible_playbook} || $ENV{AUTOMATOR_ANSIBLE_PLAYBOOK} || 'ansible-playbook';
}

sub _automator_ansible_command_name {
    my ($app) = @_;
    my $bin = _automator_ansible_bin($app);
    $bin =~ s{.*/}{};
    return $bin;
}

sub _write_private {
    my ($path, $content) = @_;
    open my $fh, '>', $path or die "Cannot write $path: $!";
    print {$fh} $content;
    close $fh;
    chmod 0600, $path;
}

sub _validate_yaml {
    my ($text) = @_;
    return 'Content is required' unless defined $text && length $text;
    return undef if $text =~ /\A\s*(---)?\s*\z/;
    my $ok = eval {
        require YAML::XS;
        YAML::XS::Load($text);
        1;
    };
    return undef if $ok;

    $ok = eval {
        require YAML::PP;
        YAML::PP->new->load_string($text);
        1;
    };
    return undef if $ok;
    return "Invalid YAML: $@";
}

sub _validate_inventory {
    my ($text) = @_;
    return 'Inventory content is required' unless defined $text && $text =~ /\S/;
    return undef unless $text =~ /[\[\]=]/;

    my $clean = $text;
    $clean =~ s/^\s*#.*$//mg;
    return undef if $clean =~ /^\s*\[[^\]\r\n]+\]\s*$/m;
    return undef if $clean =~ /^\s*[A-Za-z0-9_.:-]+(?:\s+\S+=\S+)*\s*$/m;

    my $yaml_err = _validate_yaml($text);
    return undef unless $yaml_err;
    return 'Inventory must be valid Ansible INI or YAML';
}

sub _api_allowed {
    my ($c) = @_;
    return 0 unless $c->is_admin;
    return _vault_unlocked($c, 1);
}

sub _locked {
    my ($c) = @_;
    $c->render(json => { success => 0, error => 'Vault locked', locked => 1 }, status => 401);
    return undef;
}

sub _unlock_session {
    my ($c) = @_;
    $c->session(automator_unlocked => 1);
    $c->session(automator_last_activity => time);
}

sub _vault_unlocked {
    my ($c, $refresh_activity) = @_;
    return 0 unless $c->session('automator_unlocked');

    my $last = int($c->session('automator_last_activity') || 0);
    if ($last && time - $last > 900) {
        $c->session(automator_unlocked      => 0);
        $c->session(automator_last_activity => 0);
        return 0;
    }

    $c->session(automator_last_activity => time) if $refresh_activity;
    return 1;
}

sub _filters {
    my ($c) = @_;
    return {
        search    => $c->param('search') || '',
        category  => $c->param('category') || '',
        inventory => $c->param('inventory') || '',
        status    => $c->param('status') || '',
        playbook  => $c->param('playbook') || '',
    };
}

sub _state_filters {
    my ($c) = @_;
    my $filters = _filters($c);
    $filters->{user_id} = $c->current_user_id;
    return $filters;
}

sub _owned_record {
    my ($c, $row) = @_;
    return 0 unless $row;
    return 1 unless defined $row->{user_id};
    return int($row->{user_id}) == int($c->current_user_id);
}

sub _owned_history {
    my ($c, $row) = @_;
    return 0 unless $row;
    my $user_id = int($c->current_user_id);
    return 1 if defined $row->{triggered_by} && int($row->{triggered_by}) == $user_id;
    return 1 if defined $row->{playbook_user_id} && int($row->{playbook_user_id}) == $user_id;
    return 1 unless defined $row->{triggered_by} || defined $row->{playbook_user_id};
    return 0;
}

sub _owned_secret {
    my ($c, $id) = @_;
    return 0 unless defined $id && $id =~ /\A\d+\z/;
    my ($owner_id) = $c->db->{dbh}->selectrow_array(
        "SELECT user_id FROM automator_secrets WHERE id = ?",
        undef,
        $id
    );
    return defined $owner_id && int($owner_id) == int($c->current_user_id);
}

sub _sanitize_ai_report_run_ids {
    my ($c, $report, $valid_ids) = @_;
    return $report unless ref $report eq 'HASH';
    my $issues = ref $report->{issues} eq 'ARRAY' ? $report->{issues} : [];
    for my $issue (@$issues) {
        next unless ref $issue eq 'HASH';
        my $run_id = $issue->{run_id};
        unless (defined $run_id && $run_id =~ /\A\d+\z/) {
            delete $issue->{run_id};
            next;
        }
        $run_id = int($run_id);
        my $valid = $valid_ids ? $valid_ids->{$run_id} : do {
            my $history = $c->db->get_automator_history($run_id);
            $history && _owned_history($c, $history);
        };
        if ($valid) {
            $issue->{run_id} = $run_id;
        } else {
            delete $issue->{run_id};
        }
    }
    return $report;
}

sub _db_timestamp {
    my ($dt) = @_;
    return $dt->strftime('%Y-%m-%d %H:%M:%S');
}

sub _max_runs {
    my ($c) = @_;
    return int($c->app->config->{automator}{max_concurrent_runs} || 10);
}

sub _broadcast {
    my ($history_id, $line) = @_;
    for my $tx (keys %{ $CLIENTS{$history_id} || {} }) {
        my $client = $CLIENTS{$history_id}{$tx};
        eval { $client->send($line) if $client };
    }
}

# Retrieves a full history report including JSON results and applied variables.
# Route: GET /admin/automator/api/report/:history_id
sub api_report {
    my $c = shift;
    return _locked($c) unless _api_allowed($c);
    my $history_id = $c->stash('history_id');
    my $h = $c->db->get_automator_history($history_id);
    return $c->render(json => { success => 0, error => 'Run not found' }, status => 404) unless $h;
    return $c->render(json => { success => 0, error => 'Unauthorized' }, status => 403)
        unless _owned_history($c, $h);
    $h->{json_result} = $c->db->_json_decode($h->{json_result}, undef);
    $h->{applied_vars} = $c->db->_json_decode($h->{applied_vars}, {});
    $c->render(json => { success => 1, history => $h });
}

# Aggregates 24h logs and uses AI to generate a structured system health report.
# Route: POST /admin/automator/api/ai-report
# Parameters: None
# Returns: JSON object { success, content => { summary, issues, recommendations, final_summary } }
sub api_ai_report {
    my $c = shift;
    return _locked($c) unless _api_allowed($c);

    my $logs = $c->db->get_automator_logs_24h($c->current_user_id);
    unless (@$logs) {
        return $c->render(json => { success => 1, content => { summary => "No activity found.", issues => [], recommendations => [], final_summary => "Idle.", created_at => _db_timestamp($c->now) } });
    }

    my %valid_run_id = map { int($_->{id}) => 1 } @$logs;
    my @entries;
    for my $log (@$logs) {
        my $marker = "=== AUTOMATOR_HISTORY_ID:$log->{id} PLAYBOOK:" . ($log->{playbook_name} // 'Run') . " STATUS:" . ($log->{status} // 'unknown') . " ===\n";
        my $output = $log->{output} // '';
        my $entry = $marker . $output . "\n\n";
        push @entries, $entry;
    }
    my $raw_text = join('', @entries);

    my $prompt = "Analyze every provided Ansible log block from the last 24 hours and report all distinct current or significant issues, not only the newest issue. For each issue, set run_id only to the exact AUTOMATOR_HISTORY_ID value from the marker immediately above that log block. Do not infer, decrement, transform, or extract run_id values from the log body. If unsure, omit run_id.
    RETURN ONLY JSON:
    {
      \"summary\": \"Executive overview\",
      \"issues\": [ {\"severity\": \"High|Medium|Low\", \"host\": \"hostname\", \"description\": \"Details\", \"run_id\": 123} ],
      \"recommendations\": [ \"Fix step\" ],
      \"final_summary\": \"Concluding assessment\"
    }
    
    LOG DATA:
    $raw_text";

    $c->render_later;
    $c->ai_prompt(
        contents => [{ role => 'user', parts => [{ text => $prompt }] }],
        system   => "You are an expert DevOps analyst. Use the provided Run IDs to link issues back to specific logs.",
        response_format => 'application/json',
        temp    => 0.1,
        timeout  => 60,
        app_profile => 'automator_report'
    )->then(sub {
        my $data = shift;
        my $ai_text = $data->{candidates}[0]{content}{parts}[0]{text} // "{}";
        my $report = $c->ai_decode_json($ai_text) || { summary => "Parse error.", issues => [], recommendations => [], final_summary => "Error." };
        _sanitize_ai_report_run_ids($c, $report, \%valid_run_id);
        $report->{created_at} = _db_timestamp($c->now);

        eval { $c->db->automator_log_audit($c->current_user_id, 'ai_report', 'system', undef, $report); };
        $c->render(json => { success => 1, content => $report });
    })->catch(sub {
        my $err = shift;
        $c->render(json => { success => 0, error => "Analysis failed: $err" });
    });
}

# Retrieves the last 5 AI system reports from the audit log.
# Route: GET /admin/automator/api/ai-report/history
sub api_ai_report_history {
    my $c = shift;
    return _locked($c) unless _api_allowed($c);
    my $history = $c->db->list_recent_ai_reports($c->current_user_id);
    _sanitize_ai_report_run_ids($c, $_->{details}) for @$history;
    $c->render(json => { success => 1, history => $history });
}

sub register_routes {
    my ($class, $bridges) = @_;
    $bridges->{r}->get('/automator')->to(cb => sub {
        my $c = shift;
        return $c->redirect_to('/admin/automator');
    });
    my $r = $bridges->{admin};
    $r->get('/admin/automator')->to('admin-automator#index');
    $r->get('/admin/automator/api/status')->to('admin-automator#api_vault_status');
    $r->get('/admin/automator/api/state')->to('admin-automator#api_state');
    $r->get('/admin/automator/api/history')->to('admin-automator#api_history');
    $r->post('/admin/automator/api/run')->to('admin-automator#api_run');
    $r->post('/admin/automator/api/abort/all')->to('admin-automator#api_abort_all');
    $r->post('/admin/automator/api/abort/:id')->to('admin-automator#api_abort');
    $r->post('/admin/automator/api/history/delete/:id')->to('admin-automator#api_delete_history');
    $r->post('/admin/automator/api/inventory/save')->to('admin-automator#api_save_inventory');
    $r->post('/admin/automator/api/inventory/delete/:id')->to('admin-automator#api_delete_inventory');
    $r->post('/admin/automator/api/playbook/save')->to('admin-automator#api_save_playbook');
    $r->post('/admin/automator/api/playbook/delete/:id')->to('admin-automator#api_delete_playbook');
    $r->post('/admin/automator/api/secret/save')->to('admin-automator#api_save_secret');
    $r->post('/admin/automator/api/secret/delete/:id')->to('admin-automator#api_delete_secret');
    $r->post('/admin/automator/api/vault/setup')->to('admin-automator#api_vault_setup');
    $r->post('/admin/automator/api/vault/unlock')->to('admin-automator#api_vault_unlock');
    $r->post('/admin/automator/api/vault/lock')->to('admin-automator#api_vault_lock');
    $r->websocket('/admin/automator/ws/:history_id')->to('admin-automator#ws');
    $r->get('/admin/automator/api/report/:history_id')->to('admin-automator#api_report');
    $r->post('/admin/automator/api/ai-report')->to('admin-automator#api_ai_report');
    $r->get('/admin/automator/api/ai-report/history')->to('admin-automator#api_ai_report_history');
}

1;
