CREATE TABLE `ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`project_id` text,
	`linked_task_id` text,
	`linked_meeting_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `meetings` ADD `attachments` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `attachments` text;