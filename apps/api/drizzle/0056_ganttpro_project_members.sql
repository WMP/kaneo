CREATE TABLE "ganttpro_invitation_project" (
	"id" text PRIMARY KEY NOT NULL,
	"invitation_id" text NOT NULL,
	"project_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "ganttpro_invitation_project_invitation_project_unique" UNIQUE("invitation_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "ganttpro_project_member" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_project_member_project_user_unique" UNIQUE("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "ganttpro_invitation_project" ADD CONSTRAINT "ganttpro_invitation_project_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_invitation_project" ADD CONSTRAINT "ganttpro_invitation_project_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_project_member" ADD CONSTRAINT "ganttpro_project_member_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ganttpro_project_member" ADD CONSTRAINT "ganttpro_project_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ganttpro_invitation_project_project_id_idx" ON "ganttpro_invitation_project" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ganttpro_project_member_user_id_idx" ON "ganttpro_project_member" USING btree ("user_id");
--> statement-breakpoint
-- Backfill for existing installations. Project data access now comes from a
-- project membership, so give every workspace owner and admin membership in
-- every existing project of their workspace. Everyone else (member, viewer,
-- custom roles) loses access to project data until an administrator adds them.
-- `owner` is never a project role: an owner is stored as a project `admin`, so
-- a later demotion of the workspace role cannot leave an owner-level project
-- row behind. Idempotent: existing rows are kept.
INSERT INTO "ganttpro_project_member" ("id", "project_id", "user_id", "role")
SELECT gen_random_uuid()::text, p."id", m."user_id", 'admin'
FROM "workspace_member" m
JOIN "project" p ON p."workspace_id" = m."workspace_id"
WHERE m."role" = 'admin'
   OR 'owner' = ANY (string_to_array(replace(m."role", ' ', ''), ','))
ON CONFLICT ("project_id", "user_id") DO NOTHING;
