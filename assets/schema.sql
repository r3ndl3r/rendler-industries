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
  `notification_channels` varchar(255) DEFAULT NULL,
  `last_notified_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_start_date` (`start_date`),
  KEY `idx_end_date` (`end_date`),
  KEY `idx_category` (`category`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_calendar_emoji` (`has_emoji`),
  CONSTRAINT `calendar_events_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `canvas_shares` (
  `canvas_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `can_edit` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`canvas_id`,`user_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `canvas_shares_ibfk_1` FOREIGN KEY (`canvas_id`) REFERENCES `canvases` (`id`) ON DELETE CASCADE,
  CONSTRAINT `canvas_shares_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `canvases` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `name` varchar(255) DEFAULT 'Main Workspace',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
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
  `allowed_users` text DEFAULT NULL,
  `description` text DEFAULT NULL,
  `download_count` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `filename` (`filename`),
  KEY `idx_filename` (`filename`),
  KEY `idx_uploaded_by` (`uploaded_by`)
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
CREATE TABLE `menu_links` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `label` varchar(255) NOT NULL,
  `is_separator` tinyint(1) DEFAULT 0,
  `url` varchar(255) DEFAULT '#',
  `icon` varchar(50) DEFAULT '',
  `parent_id` int(11) DEFAULT NULL,
  `sort_order` int(11) DEFAULT 0,
  `permission_level` enum('guest','user','family','admin','child') DEFAULT 'user',
  `css_class` varchar(50) DEFAULT '',
  `target` varchar(20) DEFAULT '_self',
  `is_active` tinyint(1) DEFAULT 1,
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
  PRIMARY KEY (`id`),
  KEY `idx_note` (`note_id`),
  CONSTRAINT `fk_blobs_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `notes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `canvas_id` int(11) NOT NULL DEFAULT 1,
  `type` enum('text','image') NOT NULL DEFAULT 'text',
  `title` varchar(255) DEFAULT 'Untitled Note',
  `content` text DEFAULT NULL,
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
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `fk_notes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `notes_viewport` (
  `user_id` int(11) NOT NULL,
  `canvas_id` int(11) NOT NULL DEFAULT 1,
  `scale` decimal(4,2) NOT NULL DEFAULT 1.00,
  `scroll_x` int(11) NOT NULL DEFAULT 2500,
  `scroll_y` int(11) NOT NULL DEFAULT 2500,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`,`canvas_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `notifications_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `type` enum('discord','email','pushover','gotify') NOT NULL,
  `recipient` varchar(255) NOT NULL,
  `subject` varchar(255) DEFAULT NULL,
  `message` text NOT NULL,
  `status` enum('success','failed') NOT NULL DEFAULT 'success',
  `error_details` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `notifications_log_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE `point_ledger` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `amount` int(11) NOT NULL,
  `reason` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_ledger_user` (`user_id`),
  CONSTRAINT `fk_ledger_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `pushover` (
  `token` text DEFAULT NULL,
  `user` text DEFAULT NULL
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
  PRIMARY KEY (`id`),
  KEY `player1_id` (`player1_id`),
  KEY `player2_id` (`player2_id`),
  CONSTRAINT `uno_sessions_ibfk_1` FOREIGN KEY (`player1_id`) REFERENCES `users` (`id`),
  CONSTRAINT `uno_sessions_ibfk_2` FOREIGN KEY (`player2_id`) REFERENCES `users` (`id`)
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
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `is_child` tinyint(1) DEFAULT 0,
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
