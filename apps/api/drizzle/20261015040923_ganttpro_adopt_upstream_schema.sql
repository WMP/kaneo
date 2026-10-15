-- Adopt the schema of upstream Kaneo up to its 0063_import_runs.
--
-- The upstream migrations 0054-0059 and 0061-0063 are part of this journal with
-- their upstream names and `when` values. Upstream 0060_flaky_ezekiel
-- (workspace_member_access / workspace_member_project and the invitation
-- columns project_access / project_ids) is not: this fork restricts project
-- access with ganttpro_project_member (0056_ganttpro_project_members). A
-- database created by upstream keeps those objects; nothing reads them.
--
-- This migration only covers what the upstream migrations cannot do for this
-- fork. Every statement is idempotent, because a database created by upstream
-- recorded upstream's 0057 and skips the adapted copy in this journal.

-- Upstream 0062 sets UTC defaults on its calendar_feed table; this fork keeps
-- the feeds in ganttpro_calendar_feed (0051_ganttpro_additions).
ALTER TABLE "ganttpro_calendar_feed" ALTER COLUMN "created_at" SET DEFAULT (now() AT TIME ZONE 'utc');
--> statement-breakpoint
-- Upstream 0057 queues storage objects of deleted assets and projects. Its
-- trigger function reads project.background_object_key, which this fork does
-- not have (it uses ganttpro_background_object_key), so deleting a project
-- would fail on a fork database and leak the fork's background object on a
-- database created by upstream. Read both columns through jsonb.
CREATE OR REPLACE FUNCTION queue_deleted_storage_object() RETURNS trigger AS $$
DECLARE
  old_row jsonb := to_jsonb(OLD);
  cleanup_key text;
BEGIN
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
CREATE INDEX IF NOT EXISTS "ganttpro_project_background_object_key_idx" ON "project" USING btree ("ganttpro_background_object_key") WHERE "project"."ganttpro_background_object_key" is not null;
