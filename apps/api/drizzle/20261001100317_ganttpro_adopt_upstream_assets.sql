-- Adopt project backgrounds and calendar feeds written by upstream Kaneo v2.28+.
--
-- Upstream stores them in project.background_* (its 0052_dear_beyonder) and
-- calendar_feed (its 0053_calendar_feeds). This fork reads only
-- project.ganttpro_background_* and ganttpro_calendar_feed (0051), and 0051 does
-- not copy upstream rows, so on an upgraded database the data stayed behind and
-- was invisible. Copy it once. Nothing is dropped or rewritten in the upstream
-- objects, so rolling back to an upstream image still finds its data.
--
-- Both statements are no-ops when the upstream objects do not exist (a database
-- created by this fork, or by an upstream release before v2.28) or when the
-- fork's own objects are missing.
DO $$
BEGIN
	IF (
		SELECT count(*) FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'project'
			AND column_name IN (
				'background_object_key', 'background_mime_type', 'background_version',
				'ganttpro_background_object_key', 'ganttpro_background_mime_type', 'ganttpro_background_version'
			)
	) = 6 THEN
		-- Only fill a project whose fork background is entirely unset, so a
		-- background set through this fork is never replaced. The object key is
		-- copied verbatim: both builds use workspace/<id>/project/<id>/backgrounds/background-<version>
		-- under the same storage key prefix, so it addresses the object upstream stored.
		EXECUTE 'UPDATE "project" SET
				"ganttpro_background_object_key" = "background_object_key",
				"ganttpro_background_mime_type" = "background_mime_type",
				"ganttpro_background_version" = "background_version"
			WHERE "background_object_key" IS NOT NULL
				AND "ganttpro_background_object_key" IS NULL
				AND "ganttpro_background_mime_type" IS NULL
				AND "ganttpro_background_version" IS NULL';
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF to_regclass('public.calendar_feed') IS NOT NULL
		AND to_regclass('public.ganttpro_calendar_feed') IS NOT NULL
		AND (
			SELECT count(*) FROM information_schema.columns
			WHERE table_schema = 'public'
				AND table_name IN ('calendar_feed', 'ganttpro_calendar_feed')
				AND column_name IN ('id', 'project_id', 'token', 'label_ids', 'time_zone', 'created_at')
		) = 12 THEN
		-- Keep ids and tokens so subscribed calendar URLs keep working. A feed
		-- that already exists in the fork table (same id or token) is skipped.
		EXECUTE 'INSERT INTO "ganttpro_calendar_feed" ("id", "project_id", "token", "label_ids", "time_zone", "created_at")
			SELECT "id", "project_id", "token", "label_ids", "time_zone", "created_at"
			FROM "calendar_feed"
			ON CONFLICT DO NOTHING';
	END IF;
END
$$;
