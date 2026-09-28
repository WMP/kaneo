CREATE TABLE "ganttpro_calendar_feed" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"token" text NOT NULL,
	"label_ids" jsonb NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_calendar_feed_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "ganttpro_workspace_holiday" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"date" timestamp NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_workspace_holiday_workspace_id_date_unique" UNIQUE("workspace_id","date")
);
--> statement-breakpoint
ALTER TABLE "activity" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "external_link" ALTER COLUMN "integration_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "ganttpro_workspace_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "ganttpro_background_object_key" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "ganttpro_background_mime_type" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "ganttpro_background_version" text;--> statement-breakpoint
ALTER TABLE "task_relation" ADD COLUMN "ganttpro_dependency_type" text DEFAULT 'fs' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_relation" ADD COLUMN "ganttpro_lag_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "ganttpro_progress" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "ganttpro_is_milestone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "ganttpro_baseline_start_date" timestamp;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "ganttpro_baseline_due_date" timestamp;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "ganttpro_constraint_type" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "ganttpro_constraint_date" timestamp;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "ganttpro_approval_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "ganttpro_approval_note" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ganttpro_activity_retention_days" integer;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ganttpro_working_days" integer DEFAULT 62 NOT NULL;--> statement-breakpoint
ALTER TABLE "ganttpro_calendar_feed" ADD CONSTRAINT "ganttpro_calendar_feed_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_workspace_holiday" ADD CONSTRAINT "ganttpro_workspace_holiday_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ganttpro_calendar_feed_project_id_idx" ON "ganttpro_calendar_feed" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ganttpro_workspace_holiday_workspaceId_idx" ON "ganttpro_workspace_holiday" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_ganttpro_workspace_id_workspace_id_fk" FOREIGN KEY ("ganttpro_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ganttpro_activity_workspaceId_idx" ON "activity" USING btree ("ganttpro_workspace_id");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "ganttpro_activity_task_or_workspace" CHECK (("activity"."task_id" IS NOT NULL) OR ("activity"."ganttpro_workspace_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "ganttpro_task_progress_range" CHECK ("task"."ganttpro_progress" >= 0 AND "task"."ganttpro_progress" <= 100);