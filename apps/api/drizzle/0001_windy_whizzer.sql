ALTER TABLE "activity" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "activity_workspaceId_idx" ON "activity" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_task_or_workspace" CHECK (("activity"."task_id" IS NOT NULL) OR ("activity"."workspace_id" IS NOT NULL));