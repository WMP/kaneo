-- Upstream 0057_common_deadpool, adapted for this fork when it was merged:
-- the project background columns are ganttpro_background_* here, so the
-- partial index and the trigger function use the fork's column (the function
-- reads both names). A database created by upstream recorded this entry with
-- upstream's SQL; 20261015040923_ganttpro_adopt_upstream_schema
-- (see its header) brings such a database to the same state.
CREATE TABLE "storage_cleanup" (
	"object_key" text PRIMARY KEY NOT NULL,
	"last_attempt_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ganttpro_project_background_object_key_idx" ON "project" USING btree ("ganttpro_background_object_key") WHERE "project"."ganttpro_background_object_key" is not null;
--> statement-breakpoint
-- Capture keys for every cascade, including workspace deletion. The outbox has
-- no owner FK, so its records survive the deletion transaction.
CREATE OR REPLACE FUNCTION queue_deleted_storage_object() RETURNS trigger AS $$
DECLARE
  old_row jsonb := to_jsonb(OLD);
  cleanup_key text;
BEGIN
  -- Read the keys through jsonb: this fork stores project backgrounds in
  -- ganttpro_background_object_key, and a database created by upstream also
  -- has background_object_key. A missing column reads as NULL.
  IF TG_TABLE_NAME = 'asset' THEN
    cleanup_key := old_row ->> 'object_key';
    IF cleanup_key IS NOT NULL THEN
      INSERT INTO storage_cleanup (object_key) VALUES (cleanup_key)
        ON CONFLICT (object_key) DO NOTHING;
    END IF;
  ELSE
    FOREACH cleanup_key IN ARRAY ARRAY[
      old_row ->> 'ganttpro_background_object_key',
      old_row ->> 'background_object_key'
    ] LOOP
      IF cleanup_key IS NOT NULL THEN
        INSERT INTO storage_cleanup (object_key) VALUES (cleanup_key)
          ON CONFLICT (object_key) DO NOTHING;
      END IF;
    END LOOP;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER asset_storage_cleanup BEFORE DELETE ON asset
  FOR EACH ROW EXECUTE FUNCTION queue_deleted_storage_object();
--> statement-breakpoint
CREATE TRIGGER project_storage_cleanup BEFORE DELETE ON project
  FOR EACH ROW EXECUTE FUNCTION queue_deleted_storage_object();
