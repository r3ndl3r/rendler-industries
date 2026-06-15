CREATE TABLE `ai_conversations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `role` enum('user','model','system') NOT NULL,
  `content` text NOT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadata`)),
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `ai_conversations_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `ai_emoji_dictionary` (
  `keyword` varchar(255) NOT NULL,
  `emoji` varchar(10) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`keyword`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
CREATE TABLE `app_secrets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `key_name` varchar(50) NOT NULL,
  `secret_value` text NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `key_name` (`key_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `audiobook_progress` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `book_slug` varchar(255) NOT NULL,
  `chapter_idx` smallint(5) unsigned NOT NULL DEFAULT 0,
  `position_sec` float NOT NULL DEFAULT 0,
  `completed` tinyint(1) NOT NULL DEFAULT 0,
  `client_updated_ms` bigint(20) unsigned NOT NULL DEFAULT 0,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_book` (`user_id`,`book_slug`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `audiobooks` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `slug` varchar(255) NOT NULL,
  `title` varchar(500) NOT NULL DEFAULT '',
  `author` varchar(255) NOT NULL DEFAULT '',
  `narrator` varchar(255) NOT NULL DEFAULT '',
  `description` text NOT NULL DEFAULT '',
  `series` varchar(255) NOT NULL DEFAULT '',
  `series_index` smallint(5) unsigned NOT NULL DEFAULT 0,
  `cover` varchar(100) NOT NULL DEFAULT '',
  `chapters` longtext NOT NULL DEFAULT '[]',
  `date_added` int(10) unsigned NOT NULL DEFAULT 0,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `automator_audit` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `action` varchar(50) NOT NULL,
  `target_type` varchar(50) NOT NULL,
  `target_id` int(11) DEFAULT NULL,
  `details` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `automator_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `playbook_id` int(11) DEFAULT NULL,
  `status` enum('running','success','failed','aborted','timed_out') DEFAULT 'running',
  `mode` enum('run','check') DEFAULT 'run',
  `pgid` int(11) DEFAULT NULL,
  `output` longtext DEFAULT NULL,
  `json_result` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`json_result`)),
  `applied_vars` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`applied_vars`)),
  `triggered_by` int(11) DEFAULT NULL,
  `started_at` timestamp NULL DEFAULT current_timestamp(),
  `finished_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `status` (`status`),
  KEY `playbook_id` (`playbook_id`),
  KEY `started_at` (`started_at`),
  CONSTRAINT `automator_history_ibfk_1` FOREIGN KEY (`playbook_id`) REFERENCES `automator_playbooks` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `automator_inventories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `category` varchar(100) DEFAULT 'General',
  `hosts` text NOT NULL,
  `ssh_key_path` varchar(255) DEFAULT NULL,
  `user_id` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `automator_notifications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `playbook_id` int(11) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `notify_on` enum('always','failure','success') DEFAULT 'failure',
  `channel` enum('discord','email','fcm','pushover','gotify') DEFAULT 'discord',
  `endpoint` text DEFAULT NULL,
  `retry_count` int(11) DEFAULT 0,
  `last_error` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `playbook_id` (`playbook_id`),
  CONSTRAINT `automator_notifications_ibfk_1` FOREIGN KEY (`playbook_id`) REFERENCES `automator_playbooks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `automator_playbook_secrets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `playbook_id` int(11) NOT NULL,
  `secret_id` int(11) NOT NULL,
  `alias` varchar(100) NOT NULL,
  `usage_type` enum('file','env','ssh_key','vault_password') NOT NULL DEFAULT 'file',
  `sort_order` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_playbook_alias` (`playbook_id`,`alias`),
  KEY `secret_id` (`secret_id`),
  CONSTRAINT `automator_playbook_secrets_ibfk_1` FOREIGN KEY (`playbook_id`) REFERENCES `automator_playbooks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `automator_playbook_secrets_ibfk_2` FOREIGN KEY (`secret_id`) REFERENCES `automator_secrets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `automator_playbooks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `category` varchar(100) DEFAULT 'General',
  `description` text DEFAULT NULL,
  `content` longtext NOT NULL,
  `inventory_id` int(11) DEFAULT NULL,
  `dynamic_vars` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`dynamic_vars`)),
  `tags` varchar(255) DEFAULT NULL,
  `skip_tags` varchar(255) DEFAULT NULL,
  `limit_hosts` varchar(255) DEFAULT NULL,
  `success_chain_id` int(11) DEFAULT NULL,
  `playbook_secret_id` int(11) DEFAULT NULL,
  `log_retention_days` int(11) DEFAULT 30,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL,
  `user_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `deleted_at` (`deleted_at`),
  KEY `inventory_id` (`inventory_id`),
  KEY `success_chain_id` (`success_chain_id`),
  CONSTRAINT `automator_playbooks_ibfk_1` FOREIGN KEY (`inventory_id`) REFERENCES `automator_inventories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `automator_playbooks_ibfk_2` FOREIGN KEY (`success_chain_id`) REFERENCES `automator_playbooks` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `automator_schedules` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `playbook_id` int(11) DEFAULT NULL,
  `cron_expression` varchar(100) DEFAULT NULL,
  `schedule_type` enum('daily','hourly') DEFAULT NULL,
  `interval_hours` int(11) DEFAULT NULL,
  `daily_time` time DEFAULT NULL,
  `timezone` varchar(64) DEFAULT 'UTC',
  `next_run` timestamp NULL DEFAULT NULL,
  `last_run_at` timestamp NULL DEFAULT NULL,
  `last_history_id` int(11) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_playbook` (`playbook_id`),
  CONSTRAINT `automator_schedules_ibfk_1` FOREIGN KEY (`playbook_id`) REFERENCES `automator_playbooks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `automator_secrets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `category` varchar(100) DEFAULT 'General',
  `value_encrypted` blob NOT NULL,
  `iv` varbinary(12) NOT NULL,
  `tag` varbinary(16) NOT NULL,
  `salt` varbinary(32) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `user_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `birthdays` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `birth_date` date NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `calendar_events` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `start_date` datetime NOT NULL,
  `end_date` datetime NOT NULL,
  `all_day` tinyint(1) DEFAULT 0,
  `category` varchar(100) DEFAULT NULL,
  `color` varchar(7) DEFAULT '#3788d8',
  `attendees` text DEFAULT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `has_emoji` tinyint(1) DEFAULT 0,
  `is_private` tinyint(1) DEFAULT 0,
  `notification_minutes` int(11) DEFAULT 0,
  `last_notified_at` datetime DEFAULT NULL,
  `recurrence_rule` enum('daily','weekly','monthly','yearly') DEFAULT NULL,
  `recurrence_interval` tinyint(3) unsigned NOT NULL DEFAULT 1,
  `recurrence_end_date` date DEFAULT NULL,
  `recurrence_exceptions` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_start_date` (`start_date`),
  KEY `idx_end_date` (`end_date`),
  KEY `idx_category` (`category`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_calendar_emoji` (`has_emoji`),
  KEY `idx_priv_cat_start` (`is_private`,`category`,`start_date`),
  KEY `idx_priv_start` (`is_private`,`start_date`),
  CONSTRAINT `calendar_events_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `canvas_layers` (
  `canvas_id` int(11) NOT NULL,
  `layer_id` int(11) NOT NULL,
  `alias` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`canvas_id`,`layer_id`),
  CONSTRAINT `canvas_layers_ibfk_1` FOREIGN KEY (`canvas_id`) REFERENCES `canvases` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `canvas_shares` (
  `canvas_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `can_edit` tinyint(1) DEFAULT 1,
  `sort_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`canvas_id`,`user_id`),
  KEY `idx_shares_user` (`user_id`,`created_at`),
  CONSTRAINT `canvas_shares_ibfk_1` FOREIGN KEY (`canvas_id`) REFERENCES `canvases` (`id`) ON DELETE CASCADE,
  CONSTRAINT `canvas_shares_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `canvases` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `name` varchar(255) DEFAULT 'Main Workspace',
  `sort_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `password_hash` varchar(255) DEFAULT NULL,
  `lock_version` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `chess_sessions` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT 'Unique game identifier',
  `player1_id` int(11) NOT NULL COMMENT 'User ID of the game host (White)',
  `player2_id` int(11) DEFAULT NULL COMMENT 'User ID of the joining player (Black)',
  `current_turn` int(11) NOT NULL COMMENT 'User ID of the player whose turn is next',
  `fen_state` varchar(255) NOT NULL COMMENT 'Standard FEN string representing exact board state',
  `status` enum('waiting','active','finished') NOT NULL DEFAULT 'waiting' COMMENT 'Current lifecycle state of the game lobby',
  `game_type` varchar(50) NOT NULL DEFAULT 'chess' COMMENT 'Identifier for application routing',
  `winner_id` int(11) DEFAULT NULL COMMENT 'User ID of the winner, 0 for draw, NULL if unfinished',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp() COMMENT 'Time the lobby was created',
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT 'Time of the last move',
  `draw_offered_by` int(11) DEFAULT NULL,
  `last_move` varchar(10) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `fk_chess_player1` (`player1_id`),
  KEY `fk_chess_player2` (`player2_id`),
  CONSTRAINT `fk_chess_player1` FOREIGN KEY (`player1_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chess_player2` FOREIGN KEY (`player2_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `chore_submission_photos` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `submission_id` int(10) unsigned NOT NULL,
  `photo_type` enum('before','after') NOT NULL,
  `filename` varchar(255) NOT NULL,
  `original_filename` varchar(255) NOT NULL,
  `mime_type` varchar(100) NOT NULL,
  `file_size` int(10) unsigned NOT NULL,
  `file_data` longblob NOT NULL,
  PRIMARY KEY (`id`),
  KEY `submission_id` (`submission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `chore_submissions` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `description` text NOT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `points_awarded` int(10) unsigned DEFAULT NULL,
  `admin_comment` text DEFAULT NULL,
  `submitted_at` datetime NOT NULL DEFAULT current_timestamp(),
  `reviewed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `chores` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `points` int(11) DEFAULT 0,
  `assigned_to` int(11) DEFAULT NULL,
  `status` enum('active','completed') DEFAULT 'active',
  `completed_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `completed_at` datetime DEFAULT NULL,
  `last_reminded_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_chore_assign` (`assigned_to`),
  KEY `fk_chore_complete` (`completed_by`),
  CONSTRAINT `fk_chore_assign` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chore_complete` FOREIGN KEY (`completed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `connect4_sessions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `game_type` varchar(20) DEFAULT 'connect4',
  `player1_id` int(11) NOT NULL,
  `player2_id` int(11) DEFAULT NULL,
  `current_turn` int(11) DEFAULT NULL,
  `winner_id` int(11) DEFAULT NULL,
  `board_state` text DEFAULT NULL,
  `status` varchar(20) DEFAULT 'waiting',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `last_updated` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `player1_id` (`player1_id`),
  KEY `player2_id` (`player2_id`),
  CONSTRAINT `connect4_sessions_ibfk_1` FOREIGN KEY (`player1_id`) REFERENCES `users` (`id`),
  CONSTRAINT `connect4_sessions_ibfk_2` FOREIGN KEY (`player2_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `copy` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `text` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_copy_user` (`user_id`),
  CONSTRAINT `fk_copy_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `dob` (
  `name` text DEFAULT NULL,
  `dob` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `emojis` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `emoji_char` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `emoji_name` varchar(255) NOT NULL,
  `category` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_char` (`emoji_char`),
  KEY `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `fcm_tokens` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `token` text NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `platform` varchar(32) NOT NULL DEFAULT 'android_native',
  `user_agent` varchar(255) DEFAULT NULL,
  `last_seen_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_token` (`token`(255)),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_fcm_tokens_user_platform` (`user_id`,`platform`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `files` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `filename` varchar(255) NOT NULL,
  `original_filename` varchar(255) NOT NULL,
  `mime_type` varchar(100) NOT NULL,
  `file_size` bigint(20) NOT NULL,
  `file_data` longblob NOT NULL,
  `uploaded_by` varchar(50) NOT NULL,
  `uploaded_at` timestamp NULL DEFAULT current_timestamp(),
  `admin_only` tinyint(1) DEFAULT 0,
  `description` text DEFAULT NULL,
  `download_count` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `filename` (`filename`),
  KEY `idx_filename` (`filename`),
  KEY `idx_uploaded_by` (`uploaded_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `file_acls` (
  `file_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `granted_by` varchar(50) DEFAULT NULL,
  `granted_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`file_id`, `user_id`),
  KEY `idx_file_acls_user` (`user_id`),
  CONSTRAINT `fk_file_acls_file` FOREIGN KEY (`file_id`) REFERENCES `files` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_file_acls_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `fuel_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `vehicle_id` int(11) NOT NULL,
  `image1_filename` varchar(255) DEFAULT NULL,
  `image1_original_filename` varchar(255) DEFAULT NULL,
  `image1_mime_type` varchar(100) DEFAULT NULL,
  `image1_file_size` int(11) DEFAULT NULL,
  `image1_file_data` longblob DEFAULT NULL,
  `image2_filename` varchar(255) DEFAULT NULL,
  `image2_original_filename` varchar(255) DEFAULT NULL,
  `image2_mime_type` varchar(100) DEFAULT NULL,
  `image2_file_size` int(11) DEFAULT NULL,
  `image2_file_data` longblob DEFAULT NULL,
  `uploaded_by` varchar(50) NOT NULL,
  `uploaded_at` timestamp NULL DEFAULT current_timestamp(),
  `log_date` date DEFAULT NULL,
  `odometer` int(11) DEFAULT NULL,
  `litres` decimal(10,2) DEFAULT NULL,
  `price_per_litre` decimal(10,3) DEFAULT NULL,
  `discount_per_litre` decimal(5,2) DEFAULT 0.00,
  `total_amount` decimal(10,2) DEFAULT NULL,
  `station_name` varchar(255) DEFAULT NULL,
  `fill_type` enum('full','partial') DEFAULT 'full',
  `description` text DEFAULT NULL,
  `ai_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`ai_json`)),
  `ai_status` enum('pending','complete','needs_review','failed') DEFAULT 'pending',
  `needs_review` tinyint(1) DEFAULT 1,
  `review_reasons` longtext DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `log_date` (`log_date`),
  KEY `uploaded_by` (`uploaded_by`),
  KEY `fk_fuel_vehicle` (`vehicle_id`),
  KEY `idx_fuel_logs_ai_status` (`ai_status`),
  CONSTRAINT `fk_fuel_vehicle` FOREIGN KEY (`vehicle_id`) REFERENCES `fuel_vehicles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `fuel_vehicles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `make` varchar(100) DEFAULT NULL,
  `model` varchar(100) DEFAULT NULL,
  `year` int(11) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_fuel_vehicles_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `gateway_owner` (
  `id` tinyint(4) NOT NULL DEFAULT 1,
  `pid` int(11) NOT NULL,
  `started_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_heartbeat` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `go_links` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `keyword` varchar(50) NOT NULL,
  `url` text NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `owner_id` int(11) DEFAULT NULL,
  `visits` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `keyword` (`keyword`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `gotify` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `token` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `imposter_players` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `login_failures` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username_key` varchar(50) NOT NULL,
  `attempted_at` timestamp NULL DEFAULT current_timestamp(),
  `remote_ip` varchar(64) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_login_failures_user_time` (`username_key`,`attempted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `login_lockouts` (
  `username_key` varchar(50) NOT NULL,
  `locked_until` timestamp NOT NULL,
  `alerted_at` timestamp NULL DEFAULT NULL,
  `fail_count` int(11) NOT NULL DEFAULT 0,
  `remote_ip` varchar(64) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`username_key`),
  KEY `idx_login_lockouts_locked_until` (`locked_until`),
  KEY `idx_login_lockouts_alerted_at` (`alerted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `maintenance_tasks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `label` varchar(150) NOT NULL,
  `description` text DEFAULT NULL,
  `function_name` varchar(100) NOT NULL,
  `is_async` tinyint(1) NOT NULL DEFAULT 0,
  `run_last` tinyint(1) NOT NULL DEFAULT 0,
  `is_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `interval_minutes` int(11) NOT NULL DEFAULT 1,
  `last_run_epoch` bigint(20) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `meal_plan` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `plan_date` date NOT NULL,
  `status` enum('open','locked') DEFAULT 'open',
  `final_suggestion_id` int(11) DEFAULT NULL,
  `blackout_reason` varchar(255) DEFAULT NULL,
  `locked_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `reminder_8am_sent` tinyint(1) DEFAULT 0,
  `reminder_12pm_sent` tinyint(1) DEFAULT 0,
  `reminder_2pm_sent` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `plan_date` (`plan_date`),
  KEY `fk_final_suggestion` (`final_suggestion_id`),
  CONSTRAINT `fk_final_suggestion` FOREIGN KEY (`final_suggestion_id`) REFERENCES `meal_suggestions` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `meal_suggestions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `plan_id` int(11) NOT NULL,
  `meal_id` int(11) NOT NULL,
  `suggested_by` int(11) NOT NULL,
  `suggested_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `plan_id` (`plan_id`,`meal_id`),
  KEY `meal_id` (`meal_id`),
  CONSTRAINT `meal_suggestions_ibfk_1` FOREIGN KEY (`plan_id`) REFERENCES `meal_plan` (`id`) ON DELETE CASCADE,
  CONSTRAINT `meal_suggestions_ibfk_2` FOREIGN KEY (`meal_id`) REFERENCES `meals` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `meal_votes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `suggestion_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `voted_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `suggestion_id` (`suggestion_id`,`user_id`),
  CONSTRAINT `meal_votes_ibfk_1` FOREIGN KEY (`suggestion_id`) REFERENCES `meal_suggestions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `meals` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `has_emoji` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `idx_meals_emoji` (`has_emoji`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `medication_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `medication_id` int(11) NOT NULL,
  `family_member_id` int(11) NOT NULL,
  `logged_by_id` int(11) NOT NULL,
  `dosage` int(11) NOT NULL,
  `taken_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `medication_id` (`medication_id`),
  KEY `family_member_id` (`family_member_id`),
  KEY `logged_by_id` (`logged_by_id`),
  CONSTRAINT `medication_logs_ibfk_1` FOREIGN KEY (`medication_id`) REFERENCES `medication_registry` (`id`),
  CONSTRAINT `medication_logs_ibfk_2` FOREIGN KEY (`family_member_id`) REFERENCES `users` (`id`),
  CONSTRAINT `medication_logs_ibfk_3` FOREIGN KEY (`logged_by_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `medication_registry` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `default_dosage` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `medication_reminder_events` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `reminder_id` int(11) NOT NULL,
  `scheduled_date` date NOT NULL,
  `scheduled_time` time NOT NULL,
  `last_fired_at` datetime DEFAULT NULL,
  `confirmed_at` datetime DEFAULT NULL,
  `confirmed_by` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uix_reminder_date` (`reminder_id`,`scheduled_date`),
  KEY `idx_pending_confirmations` (`confirmed_at`,`last_fired_at`),
  KEY `fk_med_events_confirmer` (`confirmed_by`),
  CONSTRAINT `fk_med_events_confirmer` FOREIGN KEY (`confirmed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_med_events_reminder` FOREIGN KEY (`reminder_id`) REFERENCES `medication_reminders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `medication_reminders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `medication_id` int(11) NOT NULL,
  `family_member_id` int(11) NOT NULL,
  `dosage` int(11) NOT NULL,
  `reminder_time` time NOT NULL,
  `days_of_week` varchar(50) NOT NULL DEFAULT '1,2,3,4,5,6,7',
  `is_active` tinyint(1) DEFAULT 1,
  `source_log_id` int(11) NOT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `medication_id` (`medication_id`),
  KEY `family_member_id` (`family_member_id`),
  KEY `idx_reminder_time` (`reminder_time`),
  KEY `fk_med_reminders_creator` (`created_by`),
  KEY `source_log_id` (`source_log_id`),
  CONSTRAINT `fk_med_reminders_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_med_reminders_medication` FOREIGN KEY (`medication_id`) REFERENCES `medication_registry` (`id`),
  CONSTRAINT `fk_med_reminders_member` FOREIGN KEY (`family_member_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_med_reminders_source_log` FOREIGN KEY (`source_log_id`) REFERENCES `medication_logs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `menu_links` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `label` varchar(255) NOT NULL,
  `is_separator` tinyint(1) DEFAULT 0,
  `url` varchar(255) DEFAULT '#',
  `icon` varchar(50) DEFAULT '',
  `parent_id` int(11) DEFAULT NULL,
  `sort_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `permission_level` enum('guest','user','family','admin','child','parent') DEFAULT 'user',
  `css_class` varchar(50) DEFAULT '',
  `target` varchar(20) DEFAULT '_self',
  `is_active` tinyint(1) DEFAULT 1,
  `hide_navbar_title` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `parent_id` (`parent_id`),
  CONSTRAINT `menu_links_ibfk_1` FOREIGN KEY (`parent_id`) REFERENCES `menu_links` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `note_blobs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `note_id` int(11) NOT NULL,
  `mime_type` varchar(100) DEFAULT NULL,
  `file_size` int(11) DEFAULT NULL,
  `file_data` longblob DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `filename` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_note` (`note_id`),
  KEY `idx_blobs_note` (`note_id`,`id`),
  CONSTRAINT `fk_blobs_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `note_links` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `source_note_id` int(11) NOT NULL,
  `target_note_id` int(11) NOT NULL,
  `link_text` varchar(255) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_link` (`source_note_id`,`target_note_id`),
  KEY `idx_target` (`target_note_id`),
  KEY `idx_source` (`source_note_id`),
  CONSTRAINT `note_links_ibfk_1` FOREIGN KEY (`source_note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `note_links_ibfk_2` FOREIGN KEY (`target_note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `notes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `canvas_id` int(11) NOT NULL DEFAULT 1,
  `type` enum('text','image','file') NOT NULL DEFAULT 'text',
  `title` varchar(255) DEFAULT 'Untitled Note',
  `content` text DEFAULT NULL,
  `filename` varchar(255) DEFAULT NULL,
  `x` int(11) DEFAULT 2500,
  `y` int(11) DEFAULT 2500,
  `width` int(11) DEFAULT 280,
  `height` int(11) DEFAULT 200,
  `color` varchar(20) DEFAULT '#fef3c7',
  `z_index` int(11) DEFAULT 1,
  `is_collapsed` tinyint(1) DEFAULT 0,
  `is_options_expanded` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `layer_id` int(11) DEFAULT 1,
  `is_deleted` tinyint(1) DEFAULT 0,
  `locked_by_user_id` int(11) DEFAULT NULL,
  `locked_by_session_id` varchar(32) DEFAULT NULL,
  `locked_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_notes_sync` (`canvas_id`,`is_deleted`,`updated_at`),
  CONSTRAINT `fk_notes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `notes_viewport` (
  `user_id` int(11) NOT NULL,
  `canvas_id` int(11) NOT NULL DEFAULT 1,
  `scale` decimal(4,2) NOT NULL DEFAULT 1.00,
  `scroll_x` int(11) NOT NULL DEFAULT 2500,
  `scroll_y` int(11) NOT NULL DEFAULT 2500,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `layer_id` int(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (`user_id`,`canvas_id`,`layer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `notification_templates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `template_key` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `available_tags` text DEFAULT NULL,
  `subject_template` varchar(255) DEFAULT NULL,
  `body_template` text NOT NULL,
  `sample_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`sample_data`)),
  `is_deprecated` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `template_key` (`template_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `notifications_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `caller_id` int(11) DEFAULT NULL,
  `type` enum('discord','email','pushover','gotify','fcm') NOT NULL,
  `recipient` varchar(255) NOT NULL,
  `subject` varchar(255) DEFAULT NULL,
  `message` text NOT NULL,
  `status` enum('success','failed') NOT NULL DEFAULT 'success',
  `error_details` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `caller_id` (`caller_id`),
  CONSTRAINT `notifications_log_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `notifications_queue` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `type` enum('discord','email') NOT NULL,
  `recipient` varchar(255) NOT NULL,
  `subject` varchar(255) DEFAULT NULL,
  `message` text NOT NULL,
  `status` enum('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
  `retry_count` tinyint(4) NOT NULL DEFAULT 0,
  `last_error` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `status` (`status`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `notifications_queue_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `party_rsvp` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `status` enum('coming','not_coming') NOT NULL,
  `cookie_token` varchar(64) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `cookie_token` (`cookie_token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `point_ledger` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `amount` int(11) NOT NULL,
  `reason` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `adjusted_by` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_ledger_user` (`user_id`),
  KEY `fk_adjusted_by` (`adjusted_by`),
  CONSTRAINT `fk_adjusted_by` FOREIGN KEY (`adjusted_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_ledger_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `pushover` (
  `token` text DEFAULT NULL,
  `user` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `quiz_custom_questions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `question_index` int(11) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_question` (`user_id`,`question_index`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `quiz_custom_questions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `receipts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `filename` varchar(255) NOT NULL,
  `original_filename` varchar(255) NOT NULL,
  `mime_type` varchar(100) NOT NULL,
  `file_size` int(11) NOT NULL,
  `file_data` longblob NOT NULL,
  `uploaded_by` varchar(50) NOT NULL,
  `uploaded_at` timestamp NULL DEFAULT current_timestamp(),
  `store_name` varchar(255) DEFAULT NULL,
  `receipt_date` date DEFAULT NULL,
  `total_amount` decimal(10,2) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `ai_json` longtext DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `reminder_recipients` (
  `reminder_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  PRIMARY KEY (`reminder_id`,`user_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `reminder_recipients_ibfk_1` FOREIGN KEY (`reminder_id`) REFERENCES `reminders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `reminder_recipients_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `reminders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `days_of_week` varchar(50) NOT NULL,
  `reminder_time` time NOT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `last_run_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `created_by` int(11) NOT NULL,
  `is_one_off` tinyint(1) DEFAULT 0,
  `chore_points` int(11) DEFAULT NULL,
  `has_emoji` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  KEY `idx_reminders_emoji` (`has_emoji`),
  CONSTRAINT `reminders_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `room_blackouts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `blackout_date` date NOT NULL,
  `reason` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `blackout_date` (`blackout_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `room_config` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `alert_start_time` time DEFAULT '17:00:00',
  `is_active` tinyint(1) DEFAULT 1,
  `last_reminder_sent_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  CONSTRAINT `fk_room_config_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `room_submissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `filename` varchar(255) DEFAULT NULL,
  `original_filename` varchar(255) DEFAULT NULL,
  `mime_type` varchar(100) DEFAULT NULL,
  `file_size` int(11) DEFAULT NULL,
  `file_data` longblob DEFAULT NULL,
  `submission_date` date NOT NULL,
  `status` enum('pending','passed','failed') DEFAULT 'pending',
  `admin_comment` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `submission_date` (`submission_date`),
  KEY `fk_room_sub_user` (`user_id`),
  CONSTRAINT `fk_room_sub_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `rubiks_algorithms` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `sequence` text NOT NULL,
  `category` varchar(50) DEFAULT 'General',
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `rubiks_solves` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `cube_type` enum('3x3','4x4') NOT NULL,
  `duration_ms` int(10) unsigned NOT NULL,
  `started_at` datetime(3) NOT NULL,
  `solved_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_rubiks_solves_user_cube_time` (`user_id`,`cube_type`,`solved_at`),
  CONSTRAINT `fk_rubiks_solves_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `shopping_list` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `item_name` varchar(255) NOT NULL,
  `added_by` varchar(50) NOT NULL,
  `is_checked` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `checked_at` timestamp NULL DEFAULT NULL,
  `has_emoji` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_shopping_emoji` (`has_emoji`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `stash_pages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `page_key` varchar(191) NOT NULL,
  `stash_data` longtext NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_page_key_unique` (`user_id`,`page_key`),
  CONSTRAINT `stash_pages_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `swear_ledger` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` enum('member','fine','spend','payment') NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `amount` decimal(10,2) DEFAULT 0.00,
  `reason` varchar(255) DEFAULT NULL,
  `payer_name` varchar(100) DEFAULT NULL,
  `status` tinyint(4) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `paid_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `timer_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `timer_id` int(11) NOT NULL,
  `admin_id` int(11) NOT NULL,
  `action` enum('created','modified','deleted','bonus_granted','force_stop') NOT NULL,
  `details` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_timer` (`timer_id`),
  KEY `idx_admin` (`admin_id`),
  CONSTRAINT `timer_logs_ibfk_1` FOREIGN KEY (`timer_id`) REFERENCES `timers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `timer_logs_ibfk_2` FOREIGN KEY (`admin_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `timer_sessions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `timer_id` int(11) NOT NULL,
  `session_date` date NOT NULL,
  `elapsed_seconds` int(11) DEFAULT 0,
  `bonus_seconds` int(11) DEFAULT 0,
  `is_running` tinyint(1) DEFAULT 0,
  `started_at` datetime DEFAULT NULL,
  `paused_at` datetime DEFAULT NULL,
  `is_paused` tinyint(1) DEFAULT 0,
  `warning_sent` tinyint(1) DEFAULT 0,
  `expired_sent` tinyint(1) DEFAULT 0,
  `last_updated` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_session` (`timer_id`,`session_date`),
  KEY `idx_running` (`is_running`,`last_updated`),
  CONSTRAINT `timer_sessions_ibfk_1` FOREIGN KEY (`timer_id`) REFERENCES `timers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `timers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `category` enum('Computer','Phone','Tablet','Gaming Console','TV','Unlimited') NOT NULL,
  `weekday_minutes` int(11) NOT NULL DEFAULT 60,
  `weekend_minutes` int(11) NOT NULL DEFAULT 120,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `created_by` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  KEY `idx_user_active` (`user_id`,`is_active`),
  CONSTRAINT `timers_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `timers_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `todo_list` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `task_name` text NOT NULL,
  `is_completed` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `has_emoji` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `idx_todo_emoji` (`has_emoji`),
  CONSTRAINT `todo_list_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `trakt_assignments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `list_item_id` int(11) NOT NULL,
  `assigned_to_user_id` int(11) NOT NULL,
  `status` enum('assigned','watching','done','skipped') NOT NULL DEFAULT 'assigned',
  `note` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_trakt_assignment_item` (`user_id`,`list_item_id`),
  KEY `idx_trakt_assignment_assignee` (`assigned_to_user_id`),
  KEY `idx_trakt_assignment_item` (`list_item_id`),
  CONSTRAINT `trakt_assignments_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `trakt_assignments_ibfk_2` FOREIGN KEY (`assigned_to_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `trakt_assignments_ibfk_3` FOREIGN KEY (`list_item_id`) REFERENCES `trakt_list_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `trakt_connections` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `trakt_user_id` varchar(100) DEFAULT NULL,
  `trakt_username` varchar(255) DEFAULT NULL,
  `access_token` text DEFAULT NULL,
  `refresh_token` text DEFAULT NULL,
  `token_type` varchar(50) DEFAULT 'bearer',
  `expires_at` datetime DEFAULT NULL,
  `scope` text DEFAULT NULL,
  `status` enum('connected','disconnected') NOT NULL DEFAULT 'connected',
  `connected_at` datetime DEFAULT NULL,
  `last_synced_at` datetime DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_trakt_connections_user` (`user_id`),
  CONSTRAINT `trakt_connections_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `trakt_list_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `list_id` int(11) NOT NULL,
  `media_type` enum('movie','show','season','episode') NOT NULL,
  `trakt_id` int(11) NOT NULL,
  `imdb_id` varchar(50) DEFAULT NULL,
  `tmdb_id` int(11) DEFAULT NULL,
  `title` varchar(500) NOT NULL DEFAULT '',
  `year` int(11) DEFAULT NULL,
  `season` int(11) NOT NULL DEFAULT 0,
  `episode` int(11) NOT NULL DEFAULT 0,
  `watched` tinyint(1) NOT NULL DEFAULT 0,
  `raw_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`raw_json`)),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_trakt_list_item_media` (`user_id`,`list_id`,`media_type`,`trakt_id`,`season`,`episode`),
  KEY `idx_trakt_list_items_list` (`list_id`),
  KEY `idx_trakt_list_items_media` (`media_type`,`trakt_id`),
  CONSTRAINT `trakt_list_items_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `trakt_list_items_ibfk_2` FOREIGN KEY (`list_id`) REFERENCES `trakt_lists` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `trakt_lists` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `trakt_list_id` int(11) NOT NULL,
  `trakt_slug` varchar(255) DEFAULT NULL,
  `name` varchar(255) NOT NULL DEFAULT '',
  `description` text DEFAULT NULL,
  `privacy` varchar(50) DEFAULT NULL,
  `display_numbers` tinyint(1) NOT NULL DEFAULT 0,
  `allow_comments` tinyint(1) NOT NULL DEFAULT 0,
  `sort_by` varchar(50) DEFAULT NULL,
  `sort_how` varchar(50) DEFAULT NULL,
  `item_count` int(11) NOT NULL DEFAULT 0,
  `collapsed` tinyint(1) NOT NULL DEFAULT 1,
  `raw_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`raw_json`)),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_trakt_lists_user_trakt` (`user_id`,`trakt_list_id`),
  KEY `idx_trakt_lists_user` (`user_id`),
  CONSTRAINT `trakt_lists_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `trakt_unwatched_cache` (
  `user_id` int(11) NOT NULL,
  `data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`data`)),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `trakt_unwatched_cache_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `trakt_upcoming` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `show_trakt_id` int(11) DEFAULT NULL,
  `episode_trakt_id` int(11) DEFAULT NULL,
  `title` varchar(500) NOT NULL DEFAULT '',
  `show_title` varchar(500) NOT NULL DEFAULT '',
  `season` int(11) DEFAULT NULL,
  `episode` int(11) DEFAULT NULL,
  `first_aired` datetime DEFAULT NULL,
  `network` varchar(255) DEFAULT NULL,
  `raw_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`raw_json`)),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_trakt_upcoming_user_date` (`user_id`,`first_aired`),
  KEY `idx_trakt_upcoming_episode` (`episode_trakt_id`),
  CONSTRAINT `trakt_upcoming_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `trakt_watchlist_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `show_trakt_id` int(11) NOT NULL,
  `show_title` varchar(500) NOT NULL DEFAULT '',
  `year` int(11) DEFAULT NULL,
  `raw_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`raw_json`)),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_trakt_watchlist_show` (`user_id`,`show_trakt_id`),
  CONSTRAINT `trakt_watchlist_items_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `translation_cache` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `text_hash` char(64) NOT NULL,
  `source_text` text NOT NULL,
  `translated_text` text NOT NULL,
  `source_lang` varchar(10) DEFAULT NULL,
  `target_lang` varchar(10) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `text_hash` (`text_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `tts_cache` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `text_hash` char(64) NOT NULL,
  `text_content` text NOT NULL,
  `language_code` varchar(10) NOT NULL,
  `audio_data` mediumblob NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `text_hash` (`text_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `uno_sessions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `player1_id` int(11) NOT NULL,
  `player2_id` int(11) DEFAULT NULL,
  `player3_id` int(11) DEFAULT NULL,
  `player4_id` int(11) DEFAULT NULL,
  `current_turn` int(11) DEFAULT NULL,
  `winner_id` int(11) DEFAULT NULL,
  `draw_pile` text DEFAULT NULL,
  `discard_pile` text DEFAULT NULL,
  `p1_hand` text DEFAULT NULL,
  `p2_hand` text DEFAULT NULL,
  `current_color` varchar(10) DEFAULT NULL,
  `status` varchar(20) DEFAULT 'waiting',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `last_updated` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `p1_ready` tinyint(1) DEFAULT 0,
  `p2_ready` tinyint(1) DEFAULT 0,
  `p3_ready` tinyint(1) DEFAULT 0,
  `p4_ready` tinyint(1) DEFAULT 0,
  `p3_hand` text DEFAULT NULL,
  `p4_hand` text DEFAULT NULL,
  `direction` int(1) DEFAULT 1,
  `p1_said_uno` tinyint(1) DEFAULT 0,
  `p2_said_uno` tinyint(1) DEFAULT 0,
  `p3_said_uno` tinyint(1) DEFAULT 0,
  `p4_said_uno` tinyint(1) DEFAULT 0,
  `p1_drawn_this_turn` tinyint(1) DEFAULT 0,
  `p2_drawn_this_turn` tinyint(1) DEFAULT 0,
  `p3_drawn_this_turn` tinyint(1) DEFAULT 0,
  `p4_drawn_this_turn` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `player1_id` (`player1_id`),
  KEY `player2_id` (`player2_id`),
  CONSTRAINT `uno_sessions_ibfk_1` FOREIGN KEY (`player1_id`) REFERENCES `users` (`id`),
  CONSTRAINT `uno_sessions_ibfk_2` FOREIGN KEY (`player2_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `user_notification_prefs` (
  `user_id` int(11) NOT NULL,
  `discord` tinyint(1) NOT NULL DEFAULT 1,
  `email` tinyint(1) NOT NULL DEFAULT 1,
  `fcm` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `user_notification_prefs_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `password` varchar(60) NOT NULL,
  `email` varchar(100) NOT NULL,
  `discord_id` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `is_admin` tinyint(1) NOT NULL DEFAULT 0,
  `is_family` tinyint(1) DEFAULT 0,
  `is_parent` tinyint(1) NOT NULL DEFAULT 0,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `is_child` tinyint(1) DEFAULT 0,
  `emoji` varchar(10) DEFAULT '?',
  `quick_sort_order` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`quick_sort_order`)),
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `weather_locations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `lat` decimal(10,8) NOT NULL,
  `lon` decimal(11,8) NOT NULL,
  `update_interval_mins` int(11) DEFAULT 60,
  `sort_order` int(11) DEFAULT 0,
  `last_updated_at` datetime DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `weather_observations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `location_id` int(11) NOT NULL,
  `data_json` longtext NOT NULL,
  `observed_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `location_id` (`location_id`),
  CONSTRAINT `weather_observations_ibfk_1` FOREIGN KEY (`location_id`) REFERENCES `weather_locations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
