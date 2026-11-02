ALTER TABLE `meetings` ADD `task_id` text;--> statement-breakpoint
ALTER TABLE `meetings` ADD `decision` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `execution_mode` text DEFAULT 'api' NOT NULL;