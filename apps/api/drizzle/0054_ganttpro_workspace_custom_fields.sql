CREATE TABLE "ganttpro_project_hidden_field" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"field_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_project_hidden_field_unique" UNIQUE("project_id","field_id")
);
--> statement-breakpoint
ALTER TABLE "custom_field_definition" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_field_definition" ADD COLUMN "ganttpro_workspace_id" text;--> statement-breakpoint
ALTER TABLE "ganttpro_project_hidden_field" ADD CONSTRAINT "ganttpro_project_hidden_field_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_project_hidden_field" ADD CONSTRAINT "ganttpro_project_hidden_field_field_id_custom_field_definition_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_field_definition"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ganttpro_project_hidden_field_projectId_idx" ON "ganttpro_project_hidden_field" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ganttpro_project_hidden_field_fieldId_idx" ON "ganttpro_project_hidden_field" USING btree ("field_id");--> statement-breakpoint
ALTER TABLE "custom_field_definition" ADD CONSTRAINT "custom_field_definition_ganttpro_workspace_id_workspace_id_fk" FOREIGN KEY ("ganttpro_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ganttpro_custom_field_def_workspaceId_idx" ON "custom_field_definition" USING btree ("ganttpro_workspace_id");--> statement-breakpoint
ALTER TABLE "custom_field_definition" ADD CONSTRAINT "ganttpro_custom_field_scope" CHECK ((("custom_field_definition"."project_id" IS NOT NULL) AND ("custom_field_definition"."ganttpro_workspace_id" IS NULL)) OR (("custom_field_definition"."project_id" IS NULL) AND ("custom_field_definition"."ganttpro_workspace_id" IS NOT NULL)));