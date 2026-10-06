-- Idempotent on purpose: a preview build applied an earlier, since removed
-- migration (20261005125019_ganttpro_task_estimate) that added the same columns
-- and the first check. The runner does not recognize its recorded `when`, so this
-- entry also runs on that database and must not fail on objects that exist.
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "ganttpro_estimate_minutes" integer;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "ganttpro_estimate_unit" text DEFAULT 'hours' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "ganttpro_task_estimate_minutes_range";--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "ganttpro_task_estimate_minutes_range" CHECK ("task"."ganttpro_estimate_minutes" IS NULL OR "task"."ganttpro_estimate_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "ganttpro_task_estimate_no_full_date_range";--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "ganttpro_task_estimate_no_full_date_range" CHECK ("task"."ganttpro_estimate_minutes" IS NULL OR "task"."start_date" IS NULL OR "task"."due_date" IS NULL);
