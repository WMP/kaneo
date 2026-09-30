CREATE TABLE "ganttpro_workspace_column" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"icon" text,
	"color" text,
	"is_final" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_workspace_column_workspace_id_slug_unique" UNIQUE("workspace_id","slug")
);
--> statement-breakpoint
ALTER TABLE "column" ADD COLUMN "ganttpro_workspace_column_id" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ganttpro_enforce_columns" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ganttpro_workspace_column" ADD CONSTRAINT "ganttpro_workspace_column_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ganttpro_workspace_column_workspaceId_idx" ON "ganttpro_workspace_column" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "column" ADD CONSTRAINT "column_ganttpro_workspace_column_fk" FOREIGN KEY ("ganttpro_workspace_column_id") REFERENCES "public"."ganttpro_workspace_column"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "column_ganttpro_workspace_column_id_idx" ON "column" USING btree ("ganttpro_workspace_column_id");