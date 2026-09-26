ALTER TABLE "task" ADD COLUMN "approval_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "approval_note" text;