CREATE TABLE "ganttpro_invitation_project" (
	"id" text PRIMARY KEY NOT NULL,
	"invitation_id" text NOT NULL,
	"project_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "ganttpro_invitation_project_invitation_project_unique" UNIQUE("invitation_id","project_id"),
	CONSTRAINT "ganttpro_invitation_project_role_not_owner" CHECK (NOT ("ganttpro_invitation_project"."role" ~ '(^|,)\s*owner\s*(,|$)'))
);
--> statement-breakpoint
CREATE TABLE "ganttpro_project_member" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_project_member_project_user_unique" UNIQUE("project_id","user_id"),
	CONSTRAINT "ganttpro_project_member_role_not_owner" CHECK (NOT ("ganttpro_project_member"."role" ~ '(^|,)\s*owner\s*(,|$)'))
);
--> statement-breakpoint
ALTER TABLE "ganttpro_invitation_project" ADD CONSTRAINT "ganttpro_invitation_project_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_invitation_project" ADD CONSTRAINT "ganttpro_invitation_project_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_project_member" ADD CONSTRAINT "ganttpro_project_member_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_project_member" ADD CONSTRAINT "ganttpro_project_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ganttpro_invitation_project_project_id_idx" ON "ganttpro_invitation_project" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ganttpro_project_member_user_id_idx" ON "ganttpro_project_member" USING btree ("user_id");