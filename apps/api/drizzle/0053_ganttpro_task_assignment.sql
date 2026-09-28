CREATE TABLE "ganttpro_task_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"units" integer DEFAULT 100 NOT NULL,
	"work" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_task_assignment_task_user_unique" UNIQUE("task_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "ganttpro_task_assignment" ADD CONSTRAINT "ganttpro_task_assignment_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_task_assignment" ADD CONSTRAINT "ganttpro_task_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ganttpro_task_assignment_task_id_idx" ON "ganttpro_task_assignment" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "ganttpro_task_assignment_user_id_idx" ON "ganttpro_task_assignment" USING btree ("user_id");