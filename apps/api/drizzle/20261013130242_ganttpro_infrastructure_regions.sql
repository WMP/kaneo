CREATE TABLE "ganttpro_infra_region" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_infra_region_workspace_id_code_unique" UNIQUE("workspace_id","code"),
	CONSTRAINT "ganttpro_infra_region_code_check" CHECK ("ganttpro_infra_region"."code" ~ '^[A-Z0-9-]{1,16}$')
);
--> statement-breakpoint
ALTER TABLE "ganttpro_infra_region" ADD CONSTRAINT "ganttpro_infra_region_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ganttpro_infra_region_workspace_id_idx" ON "ganttpro_infra_region" USING btree ("workspace_id");--> statement-breakpoint
-- Backfill (hand-written): every region code already used by a model, a host or
-- a storage cluster becomes a catalog row of its workspace (name = code), so
-- existing data stays valid under the new "region must be in the catalog"
-- rule. Codes that do not match the catalog format are skipped (the API has
-- always normalized them, so this only guards against hand-edited rows).
INSERT INTO "ganttpro_infra_region" ("id", "workspace_id", "code", "name")
SELECT 'reg_' || substr(md5(random()::text || used.workspace_id || used.code), 1, 21),
  used.workspace_id,
  used.code,
  used.code
FROM (
  SELECT p.workspace_id, r.code
  FROM "ganttpro_infra_model" m
  JOIN "project" p ON p.id = m.project_id
  CROSS JOIN LATERAL jsonb_array_elements_text(m.regions) AS r(code)
  UNION
  SELECT p.workspace_id, h.region
  FROM "ganttpro_infra_host" h
  JOIN "project" p ON p.id = h.project_id
  UNION
  SELECT c.workspace_id, c.region
  FROM "ganttpro_infra_storage_cluster" c
) AS used
WHERE used.code ~ '^[A-Z0-9-]{1,16}$'
ON CONFLICT ("workspace_id", "code") DO NOTHING;
