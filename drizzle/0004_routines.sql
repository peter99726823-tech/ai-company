CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`title` text NOT NULL,
	`instruction` text NOT NULL,
	`type` text DEFAULT 'GENERAL' NOT NULL,
	`project_id` text,
	`frequency` text NOT NULL,
	`day_of_week` integer,
	`day_of_month` integer,
	`hour` integer DEFAULT 9 NOT NULL,
	`execution_mode` text DEFAULT 'manual' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
