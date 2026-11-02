CREATE TABLE `api_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`execution_id` text,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`web_searches` integer DEFAULT 0 NOT NULL,
	`cost_micros` integer NOT NULL,
	`cost_is_estimate` integer DEFAULT true NOT NULL,
	`price_table_version` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_created` ON `api_usage` (`created_at`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`report_id` text,
	`kind` text NOT NULL,
	`decision` text,
	`note` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `company` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mission` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`project_id` text,
	`title` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `employee_prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`version` integer NOT NULL,
	`system_prompt` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_prompt_version` ON `employee_prompts` (`employee_id`,`version`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`title` text NOT NULL,
	`title_ko` text NOT NULL,
	`room` text NOT NULL,
	`desk_id` text NOT NULL,
	`command` text NOT NULL,
	`expertise` text NOT NULL,
	`look` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `financial_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`amount_krw` integer NOT NULL,
	`category` text,
	`project_id` text,
	`is_simulation` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `meeting_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`order` integer NOT NULL,
	`statement` text,
	`task_id` text,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`topic` text NOT NULL,
	`project_id` text,
	`status` text DEFAULT 'QUEUED' NOT NULL,
	`max_calls` integer DEFAULT 8 NOT NULL,
	`max_cost_micros` integer DEFAULT 1000000 NOT NULL,
	`summary_report_id` text,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`task_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`goal` text DEFAULT '미확인' NOT NULL,
	`stage` text DEFAULT '미확인' NOT NULL,
	`owner_id` text,
	`budget_micros` integer,
	`revenue_micros` integer,
	`next_plan` text DEFAULT '' NOT NULL,
	`files` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`meeting_id` text,
	`employee_id` text NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`facts` text,
	`assumptions` text,
	`sources` text,
	`next_tasks` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`task_id` text,
	`meeting_id` text,
	`employee_id` text,
	`status` text,
	`message` text NOT NULL,
	`data` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_task` ON `task_events` (`task_id`);--> statement-breakpoint
CREATE INDEX `events_created` ON `task_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `task_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`status` text NOT NULL,
	`model` text,
	`request_id` text,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`instruction` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'QUEUED' NOT NULL,
	`employee_id` text NOT NULL,
	`project_id` text,
	`parent_task_id` text,
	`meeting_id` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`requires_approval` integer DEFAULT false NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`status_message` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_calls` integer DEFAULT 3 NOT NULL,
	`lease_owner` text,
	`lease_until` integer,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_status` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_employee` ON `tasks` (`employee_id`);