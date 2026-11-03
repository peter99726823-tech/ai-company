/**
 * SQLite schema (Drizzle). All tables from the spec are defined now so PHASE 2–4 only add logic.
 * Times are epoch milliseconds. Money is stored as integer micro-dollars to avoid float drift.
 */
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

const now = () => Date.now();

export const company = sqliteTable("company", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mission: text("mission"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

export const employees = sqliteTable("employees", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  title: text("title").notNull(),
  titleKo: text("title_ko").notNull(),
  room: text("room").notNull(),
  deskId: text("desk_id").notNull(),
  command: text("command").notNull(),
  expertise: text("expertise").notNull(), // JSON string[]
  look: text("look").notNull(), // JSON EmployeeLook
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

/** Versioned system prompts. The newest active row per employee is used. */
export const employeePrompts = sqliteTable(
  "employee_prompts",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id").notNull().references(() => employees.id),
    version: integer("version").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("employee_prompt_version").on(t.employeeId, t.version)],
);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  goal: text("goal").notNull().default("미확인"),
  stage: text("stage").notNull().default("미확인"),
  ownerId: text("owner_id").references(() => employees.id),
  budgetMicros: integer("budget_micros"), // null = 미확인
  revenueMicros: integer("revenue_micros"),
  nextPlan: text("next_plan").notNull().default(""),
  files: text("files").notNull().default("[]"), // JSON: related file paths (allowed workspace only)
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    instruction: text("instruction").notNull(),
    type: text("type").notNull(), // e.g. BUSINESS_ANALYSIS, MARKET_REPORT ...
    status: text("status").notNull().default("QUEUED"), // TaskStatus
    employeeId: text("employee_id").notNull().references(() => employees.id),
    projectId: text("project_id").references(() => projects.id),
    parentTaskId: text("parent_task_id"), // follow-ups (수정 요청 등)
    meetingId: text("meeting_id"),
    conversationId: text("conversation_id"), // CHAT tasks: the conversation the reply belongs to
    attachments: text("attachments"), // JSON Attachment[]: text extracted from files the CEO attached
    source: text("source").notNull().default("manual"), // manual | proposal | schedule | meeting
    /** "api": the worker calls Claude. "manual": the CEO pastes the prompt into claude.ai and pastes the answer back (no API cost). */
    executionMode: text("execution_mode").notNull().default("api"),
    requiresApproval: integer("requires_approval", { mode: "boolean" }).notNull().default(false),
    progress: integer("progress").notNull().default(0), // 0-100, server-reported
    statusMessage: text("status_message"),
    error: text("error"),
    cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    maxCalls: integer("max_calls").notNull().default(3),
    /** Idempotency: a worker must claim the task (lease) before running it. */
    leaseOwner: text("lease_owner"),
    leaseUntil: integer("lease_until"),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (t) => [index("tasks_status").on(t.status), index("tasks_employee").on(t.employeeId)],
);

/** One row per attempt to run a task (retries create new rows). */
export const taskExecutions = sqliteTable("task_executions", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  attempt: integer("attempt").notNull(),
  status: text("status").notNull(), // RUNNING | SUCCEEDED | FAILED | CANCELED
  model: text("model"),
  requestId: text("request_id"), // provider request id, for audit
  error: text("error"),
  startedAt: integer("started_at").notNull().$defaultFn(now),
  finishedAt: integer("finished_at"),
});

export const taskEvents = sqliteTable(
  "task_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }), // monotonic: used as SSE Last-Event-ID
    type: text("type").notNull(), // EventType
    taskId: text("task_id"),
    meetingId: text("meeting_id"),
    employeeId: text("employee_id"),
    status: text("status"),
    message: text("message").notNull(),
    data: text("data"), // JSON
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("events_task").on(t.taskId), index("events_created").on(t.createdAt)],
);

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  projectId: text("project_id").references(() => projects.id), // keeps project chats separate
  title: text("title"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  role: text("role").notNull(), // ceo | employee | system
  content: text("content").notNull(),
  taskId: text("task_id"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const meetings = sqliteTable("meetings", {
  id: text("id").primaryKey(),
  topic: text("topic").notNull(),
  projectId: text("project_id").references(() => projects.id),
  status: text("status").notNull().default("QUEUED"),
  maxCalls: integer("max_calls").notNull().default(8),
  maxCostMicros: integer("max_cost_micros").notNull().default(1_000_000),
  summaryReportId: text("summary_report_id"),
  taskId: text("task_id"), // the task that produces the meeting record
  decision: text("decision"), // JSON {option, note, at}
  attachments: text("attachments"), // JSON Attachment[]
  createdAt: integer("created_at").notNull().$defaultFn(now),
  endedAt: integer("ended_at"),
});

export const meetingParticipants = sqliteTable("meeting_participants", {
  id: text("id").primaryKey(),
  meetingId: text("meeting_id").notNull().references(() => meetings.id),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  order: integer("order").notNull(),
  statement: text("statement"), // the employee's real AI-generated contribution
  taskId: text("task_id"),
});

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  taskId: text("task_id").references(() => tasks.id),
  meetingId: text("meeting_id"),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  projectId: text("project_id").references(() => projects.id),
  title: text("title").notNull(),
  body: text("body").notNull(), // markdown
  facts: text("facts"), // JSON: confirmed facts
  assumptions: text("assumptions"), // JSON
  sources: text("sources"), // JSON: [{title,url}] — empty when no web tool was used
  nextTasks: text("next_tasks"), // JSON
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  taskId: text("task_id").references(() => tasks.id),
  reportId: text("report_id").references(() => reports.id),
  kind: text("kind").notNull(), // REPORT_REVIEW | EXTERNAL_ACTION | PROPOSAL
  decision: text("decision"), // APPROVED | REVISION | MORE_ANALYSIS | FORWARD | APPLY_TO_PROJECT | CLOSE
  note: text("note"),
  decidedAt: integer("decided_at"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const financialTransactions = sqliteTable("financial_transactions", {
  id: text("id").primaryKey(),
  date: text("date").notNull(), // YYYY-MM-DD
  description: text("description").notNull(),
  amountKrw: integer("amount_krw").notNull(), // + income, - expense
  category: text("category"),
  projectId: text("project_id").references(() => projects.id),
  isSimulation: integer("is_simulation", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const apiUsage = sqliteTable(
  "api_usage",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id"),
    executionId: text("execution_id"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    webSearches: integer("web_searches").notNull().default(0),
    costMicros: integer("cost_micros").notNull(), // computed from the price table at call time
    costIsEstimate: integer("cost_is_estimate", { mode: "boolean" }).notNull().default(true),
    priceTableVersion: text("price_table_version").notNull(),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("usage_created").on(t.createdAt)],
);

// ─── relations ─────────────────────────────────────────────────────

export const employeeRelations = relations(employees, ({ many }) => ({
  prompts: many(employeePrompts),
  tasks: many(tasks),
}));
export const taskRelations = relations(tasks, ({ one, many }) => ({
  employee: one(employees, { fields: [tasks.employeeId], references: [employees.id] }),
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  executions: many(taskExecutions),
  events: many(taskEvents),
  reports: many(reports),
}));
export const reportRelations = relations(reports, ({ one }) => ({
  task: one(tasks, { fields: [reports.taskId], references: [tasks.id] }),
  employee: one(employees, { fields: [reports.employeeId], references: [employees.id] }),
}));

export type TaskRow = typeof tasks.$inferSelect;
export type TaskEventRow = typeof taskEvents.$inferSelect;
export type ReportRow = typeof reports.$inferSelect;

/**
 * Recurring work the CEO approved in advance (PHASE 4). The scheduler turns a due routine into a
 * task (자동 모드) or a proposal waiting for approval (반자동 모드); 수동 모드 creates nothing.
 */
export const routines = sqliteTable("routines", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  title: text("title").notNull(),
  instruction: text("instruction").notNull(),
  type: text("type").notNull().default("GENERAL"),
  projectId: text("project_id").references(() => projects.id),
  frequency: text("frequency").notNull(), // daily | weekly | monthly
  dayOfWeek: integer("day_of_week"), // 0-6 (weekly)
  dayOfMonth: integer("day_of_month"), // 1-28 (monthly)
  hour: integer("hour").notNull().default(9),
  executionMode: text("execution_mode").notNull().default("manual"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: integer("last_run_at"),
  nextRunAt: integer("next_run_at").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});
export type RoutineRow = typeof routines.$inferSelect;

/** 아이디어 메모함: ideas jotted down before they become a meeting or a validation task. */
export const ideas = sqliteTable("ideas", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  status: text("status").notNull().default("new"), // new | reviewing | active | hold | dropped
  projectId: text("project_id").references(() => projects.id),
  linkedTaskId: text("linked_task_id"),
  linkedMeetingId: text("linked_meeting_id"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});
export type IdeaRow = typeof ideas.$inferSelect;
