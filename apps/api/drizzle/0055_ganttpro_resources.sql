CREATE TABLE "ganttpro_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"ganttpro_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_resource_kind" CHECK ("ganttpro_resource"."kind" IN ('person', 'equipment', 'material'))
);
--> statement-breakpoint
ALTER TABLE "ganttpro_task_assignment" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ganttpro_task_assignment" ADD COLUMN "ganttpro_resource_id" text;--> statement-breakpoint
ALTER TABLE "ganttpro_resource" ADD CONSTRAINT "ganttpro_resource_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_resource" ADD CONSTRAINT "ganttpro_resource_ganttpro_user_id_user_id_fk" FOREIGN KEY ("ganttpro_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ganttpro_resource_workspace_id_idx" ON "ganttpro_resource" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ganttpro_resource_user_id_idx" ON "ganttpro_resource" USING btree ("ganttpro_user_id");--> statement-breakpoint
ALTER TABLE "ganttpro_task_assignment" ADD CONSTRAINT "ganttpro_task_assignment_ganttpro_resource_id_ganttpro_resource_id_fk" FOREIGN KEY ("ganttpro_resource_id") REFERENCES "public"."ganttpro_resource"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ganttpro_task_assignment_resource_id_idx" ON "ganttpro_task_assignment" USING btree ("ganttpro_resource_id");--> statement-breakpoint
ALTER TABLE "ganttpro_task_assignment" ADD CONSTRAINT "ganttpro_task_assignment_task_resource_unique" UNIQUE("task_id","ganttpro_resource_id");--> statement-breakpoint
ALTER TABLE "ganttpro_task_assignment" ADD CONSTRAINT "ganttpro_assignment_target" CHECK ((("ganttpro_task_assignment"."user_id" IS NOT NULL) AND ("ganttpro_task_assignment"."ganttpro_resource_id" IS NULL)) OR (("ganttpro_task_assignment"."user_id" IS NULL) AND ("ganttpro_task_assignment"."ganttpro_resource_id" IS NOT NULL)));