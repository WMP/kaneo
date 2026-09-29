CREATE TABLE "ganttpro_invitation_origin" (
	"invitation_id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "ganttpro_invitation_origin_source_check" CHECK ("ganttpro_invitation_origin"."source" IN ('project'))
);
--> statement-breakpoint
ALTER TABLE "ganttpro_invitation_origin" ADD CONSTRAINT "ganttpro_invitation_origin_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
-- A pending invitation that was created through the project invitation routes
-- (a ganttpro_invitation_origin row) exists for its projects only: when the
-- last of them goes away it is canceled. Whatever removes the row does it: the
-- routes, a deleted project (cascade), a moved project (its rows are deleted)
-- or an administrator. Invitations without an origin row (Better Auth's
-- workspace invitations, and every invitation older than this migration) are
-- never touched.
CREATE FUNCTION "ganttpro_cancel_empty_project_invitation"() RETURNS trigger AS $$
BEGIN
	UPDATE "invitation" SET "status" = 'canceled'
	WHERE "id" = OLD."invitation_id"
		AND "status" = 'pending'
		AND EXISTS (
			SELECT 1 FROM "ganttpro_invitation_origin" o
			WHERE o."invitation_id" = OLD."invitation_id" AND o."source" = 'project'
		)
		AND NOT EXISTS (
			SELECT 1 FROM "ganttpro_invitation_project" p
			WHERE p."invitation_id" = OLD."invitation_id"
		);
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "ganttpro_invitation_project_cancel_empty" AFTER DELETE ON "ganttpro_invitation_project" FOR EACH ROW EXECUTE FUNCTION "ganttpro_cancel_empty_project_invitation"();
