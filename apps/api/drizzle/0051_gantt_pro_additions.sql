CREATE TABLE "calendar_feed" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"token" text NOT NULL,
	"label_ids" jsonb NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feed_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "workspace_holiday" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"date" timestamp NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_holiday_workspace_id_date_unique" UNIQUE("workspace_id","date")
);
--> statement-breakpoint
ALTER TABLE "activity" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "external_link" ALTER COLUMN "integration_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "background_object_key" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "background_mime_type" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "background_version" text;--> statement-breakpoint
ALTER TABLE "task_relation" ADD COLUMN "dependency_type" text DEFAULT 'fs' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_relation" ADD COLUMN "lag_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "progress" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "is_milestone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "baseline_start_date" timestamp;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "baseline_due_date" timestamp;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "constraint_type" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "constraint_date" timestamp;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "approval_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "approval_note" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "activity_retention_days" integer;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "working_days" integer DEFAULT 62 NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_feed" ADD CONSTRAINT "calendar_feed_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workspace_holiday" ADD CONSTRAINT "workspace_holiday_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "calendar_feed_project_id_idx" ON "calendar_feed" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "workspace_holiday_workspaceId_idx" ON "workspace_holiday" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "activity_workspaceId_idx" ON "activity" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_task_or_workspace" CHECK (("activity"."task_id" IS NOT NULL) OR ("activity"."workspace_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_progress_range" CHECK ("task"."progress" >= 0 AND "task"."progress" <= 100);