ALTER TABLE "task" ADD COLUMN "ganttpro_estimate_minutes" integer;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "ganttpro_estimate_unit" text DEFAULT 'hours' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "ganttpro_task_estimate_minutes_range" CHECK ("task"."ganttpro_estimate_minutes" IS NULL OR "task"."ganttpro_estimate_minutes" >= 0);