CREATE TABLE "ganttpro_jira_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"base_url" text NOT NULL,
	"deployment" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"polling_enabled" boolean DEFAULT true NOT NULL,
	"webhook_secret" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_jira_connection_workspace_unique" UNIQUE("workspace_id"),
	CONSTRAINT "ganttpro_jira_connection_deployment_check" CHECK ("ganttpro_jira_connection"."deployment" IN ('server', 'cloud'))
);
--> statement-breakpoint
CREATE TABLE "ganttpro_jira_issue_link" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"issue_key" text NOT NULL,
	"issue_url" text NOT NULL,
	"jira_project_key" text NOT NULL,
	"last_status_id" text,
	"last_status_name" text,
	"last_synced_at" timestamp,
	"sync_error" text,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_jira_issue_link_task_unique" UNIQUE("task_id"),
	CONSTRAINT "ganttpro_jira_issue_link_connection_issue_unique" UNIQUE("connection_id","issue_id")
);
--> statement-breakpoint
CREATE TABLE "ganttpro_jira_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"scope" text NOT NULL,
	"project_id" text,
	"user_id" text,
	"config" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_jira_mapping_scope_unique" UNIQUE NULLS NOT DISTINCT("workspace_id","scope","project_id","user_id"),
	CONSTRAINT "ganttpro_jira_mapping_scope_check" CHECK ("ganttpro_jira_mapping"."scope" IN ('workspace', 'project', 'user')),
	CONSTRAINT "ganttpro_jira_mapping_project_id_check" CHECK (("ganttpro_jira_mapping"."scope" = 'project') = ("ganttpro_jira_mapping"."project_id" IS NOT NULL)),
	CONSTRAINT "ganttpro_jira_mapping_user_id_check" CHECK (("ganttpro_jira_mapping"."scope" = 'user') = ("ganttpro_jira_mapping"."user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ganttpro_jira_status_proposal" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"link_id" text NOT NULL,
	"from_status_name" text,
	"to_status_id" text,
	"to_status_name" text NOT NULL,
	"proposed_status" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"jira_changed_by" text,
	"jira_changed_at" timestamp,
	"source" text NOT NULL,
	"resolved_by_user_id" text,
	"resolved_status" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_jira_status_proposal_state_check" CHECK ("ganttpro_jira_status_proposal"."state" IN ('pending', 'accepted', 'rejected', 'superseded')),
	CONSTRAINT "ganttpro_jira_status_proposal_source_check" CHECK ("ganttpro_jira_status_proposal"."source" IN ('webhook', 'poll', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "ganttpro_jira_user_token" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"user_id" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"email" text,
	"jira_account_id" text,
	"jira_username" text,
	"jira_display_name" text,
	"last_verified_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_jira_user_token_connection_user_unique" UNIQUE("connection_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "ganttpro_jira_connection" ADD CONSTRAINT "ganttpro_jira_connection_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_jira_issue_link" ADD CONSTRAINT "ganttpro_jira_issue_link_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_jira_issue_link" ADD CONSTRAINT "ganttpro_jira_issue_link_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_jira_issue_link" ADD CONSTRAINT "ganttpro_jira_issue_link_connection_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ganttpro_jira_connection"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_jira_mapping" ADD CONSTRAINT "ganttpro_jira_mapping_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_jira_mapping" ADD CONSTRAINT "ganttpro_jira_mapping_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_jira_mapping" ADD CONSTRAINT "ganttpro_jira_mapping_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_jira_mapping" ADD CONSTRAINT "ganttpro_jira_mapping_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_jira_status_proposal" ADD CONSTRAINT "ganttpro_jira_status_proposal_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_jira_status_proposal" ADD CONSTRAINT "ganttpro_jira_status_proposal_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_jira_status_proposal" ADD CONSTRAINT "ganttpro_jira_status_proposal_link_fk" FOREIGN KEY ("link_id") REFERENCES "public"."ganttpro_jira_issue_link"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_jira_user_token" ADD CONSTRAINT "ganttpro_jira_user_token_connection_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ganttpro_jira_connection"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_jira_user_token" ADD CONSTRAINT "ganttpro_jira_user_token_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ganttpro_jira_issue_link_issue_key_idx" ON "ganttpro_jira_issue_link" USING btree ("issue_key");--> statement-breakpoint
CREATE INDEX "ganttpro_jira_issue_link_created_by_idx" ON "ganttpro_jira_issue_link" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "ganttpro_jira_mapping_project_id_idx" ON "ganttpro_jira_mapping" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ganttpro_jira_mapping_user_id_idx" ON "ganttpro_jira_mapping" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ganttpro_jira_status_proposal_task_state_idx" ON "ganttpro_jira_status_proposal" USING btree ("task_id","state");--> statement-breakpoint
CREATE INDEX "ganttpro_jira_status_proposal_link_id_idx" ON "ganttpro_jira_status_proposal" USING btree ("link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ganttpro_jira_status_proposal_one_pending_uidx" ON "ganttpro_jira_status_proposal" USING btree ("task_id") WHERE "ganttpro_jira_status_proposal"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "ganttpro_jira_user_token_user_id_idx" ON "ganttpro_jira_user_token" USING btree ("user_id");