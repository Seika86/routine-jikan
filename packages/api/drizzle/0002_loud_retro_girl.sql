PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_routine_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text,
	`cost_level` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_routine_executions`("id", "routine_id", "cost_level", "started_at", "completed_at", "status", "created_at") SELECT "id", "routine_id", "cost_level", "started_at", "completed_at", "status", "created_at" FROM `routine_executions`;--> statement-breakpoint
DROP TABLE `routine_executions`;--> statement-breakpoint
ALTER TABLE `__new_routine_executions` RENAME TO `routine_executions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;