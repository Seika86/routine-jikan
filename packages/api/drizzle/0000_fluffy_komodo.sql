CREATE TABLE `routine_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`cost_level` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `routine_items` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`item_type` text NOT NULL,
	`task_id` text,
	`group_id` text,
	`is_enabled` integer DEFAULT true,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `task_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scheduled_time` text,
	`default_ambient_sound_type` text,
	`default_ambient_sound_volume` integer DEFAULT 50,
	`default_ambient_sound_duck_on_tts` integer DEFAULT true,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_shared` integer DEFAULT false,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_results` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`task_name` text NOT NULL,
	`group_name` text,
	`base_duration_sec` integer NOT NULL,
	`planned_duration_sec` integer NOT NULL,
	`actual_duration_sec` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`execution_id`) REFERENCES `routine_executions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`cost_low_sec` integer,
	`cost_high_sec` integer,
	`timer_overrun` text DEFAULT 'continue' NOT NULL,
	`scheduled_days` text,
	`ambient_sound_type` text,
	`ambient_sound_volume` integer,
	`tts_on_start` integer DEFAULT true,
	`tts_on_end` integer DEFAULT true,
	`tts_on_remaining` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `task_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
