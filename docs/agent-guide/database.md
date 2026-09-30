# Database and migrations

Define schema in `apps/api/src/database/schema.ts` and relations in `apps/api/src/database/relations.ts`. Generate migrations with `pnpm --filter @kaneo/api db:generate`, inspect the resulting SQL and Drizzle metadata, and include schema and migration together. Never edit or renumber a migration already applied to an installation. Name, order and sync migrations as described in the last three sections.


Review defaults and backfill behavior against populated tables, not just an empty database. Consider indexes, foreign keys, uniqueness, deletes and nullable legacy rows. Prefer additive migrations when an older binary can still run during rollout. The `ganttpro_` prefix is used for additions in this fork's Gantt migration; a new field does not justify an unrelated rename of upstream tables.

The API migrates on startup. Use disposable PostgreSQL and the relevant `tests/api-integration/` tests to prove constraints and authorization. For schema changes, inspect the upgrade from the prior shape as well as fresh creation; the bundled image's upgrade scenario is described in `scripts/ci/README.md`. A passed unit test with a mocked database is not migration proof.

Migration `0056_ganttpro_project_members` adds project membership tables and no rows: workspace owners, administrators and roles granting `workspace:manage_settings` keep reaching every project through the full-access rule, while every other member of an existing installation loses access to all projects until they are added. `tests/api-integration/project-membership-migration.test.ts` applies migrations up to 0055, populates a database, upgrades it and checks both the empty tables and the access rule against the migrated data. If a workspace edited its `admin` role and removed `workspace:manage_settings`, those admins are no longer full-access users, so after the upgrade they lose access to existing projects until they are added (a role row that cannot be parsed falls back to the built-in role and keeps the permission).

Migration `0057_ganttpro_invitation_origin` adds `ganttpro_invitation_origin` (one row per invitation created through the project invitation routes, `source = 'project'`) and the trigger `ganttpro_invitation_project_cancel_empty`, which cancels a pending project-origin invitation when its last `ganttpro_invitation_project` row disappears, whether a route removed it, the project was deleted (cascade) or moved (`move-project.ts` deletes the rows). It backfills nothing, so every invitation that exists at upgrade time counts as a workspace invitation and is never canceled by the trigger. `tests/api-integration/project-invitation-origin-migration.test.ts` upgrades a populated 0056 database and checks the same objects on a fresh one. The trigger is hand-written SQL appended to the generated migration; keep it when regenerating.

Migration `0058_ganttpro_resource_invitation` adds the nullable `ganttpro_resource.ganttpro_invitation_id` (foreign key to `invitation.id`, ON DELETE SET NULL, indexed): the invitation sent from a person resource, cleared when the resource is linked. It backfills nothing, so every existing resource has no pending link, and an older binary ignores the column. `tests/api-integration/resource-invitation-migration.test.ts` upgrades a populated 0057 database (resources with assignments, one linked) and checks the same objects on a fresh one.

Migration `0059_ganttpro_actor_source` adds the nullable `activity.actor_via`, `activity.actor_token_hint` and `session.auth_via` (plain `text`, no default, no index). It backfills nothing: existing activity is shown as a plain user and existing sessions are not MCP sessions, and an older binary ignores the columns. `tests/api-integration/actor-source-migration.test.ts` upgrades a populated 0058 database and checks the same columns on a fresh one.

## Migration names

`apps/api/drizzle.config.ts` sets `migrations.prefix` to `timestamp`. `db:generate` names a new migration `YYYYMMDDHHMMSS_<name>.sql`, where the prefix is the UTC second of authoring (`date -u +%Y%m%d%H%M%S`), and its snapshot `meta/YYYYMMDDHHMMSS_snapshot.json`. Always pass `--name ganttpro_<description>`: `apps/api/src/utils/adopt-existing-database.ts` identifies this fork's migrations by `ganttpro` in the tag. The four-digit files `0000` to `0059` are frozen. Synced upstream migrations keep their upstream four-digit names. A timestamp prevents file-name collisions between branches and with upstream, and `0059_snapshot.json` sorts before every timestamp snapshot, so drizzle-kit keeps the correct parent. A timestamp does not prevent a conflict in `meta/_journal.json` or two snapshots with one `prevId` when two lineages each add a migration.

## How migrations apply

The startup migrator (`drizzle-orm/node-postgres/migrator`, called from `apps/api/src/index.ts`) reads `meta/_journal.json` in order. It runs an entry only if the entry's `when` is greater than the newest `created_at` in `drizzle.__drizzle_migrations`. It does not record file names. This is different from kenlasko/monize, whose runner records file names and runs every file that is not recorded:

- A renamed file does not run again. Do not rename a migration all the same: tests, documents and the upstream sync refer to tags.
- An upgraded database silently skips an entry whose `when` is not newer than every earlier entry. A migration merged late with an older `when` never runs there.

`tests/api/database/migration-journal.test.ts` (CI job `unit`) fails when an entry's `when` is out of order (three historical upstream entries are grandfathered), when SQL files and journal entries do not match, when two snapshots share a `prevId`, or when a new fork migration does not use the `<timestamp>_ganttpro_` form.

## Upstream sync

`.github/workflows/upstream-sync.yml` opens the sync pull request. Its report lists legacy number clashes and upstream migrations that are older than this fork's newest migration. To resolve the merge:

1. Keep every fork entry in `meta/_journal.json` with its position and `when`. Never regenerate or renumber a fork migration: each installation that applied it recorded its `when`.
2. For each new upstream migration, first check whether a fork migration already contains the change (the changes of upstream `0051` to `0053` are part of `0051_ganttpro_additions`, with `ganttpro_` object names). If it does, remove the upstream SQL and snapshot files. If it does not, append the entry after the last one. When its `when` is not newer than the last entry, a reviewer must decide how to apply it (see the known gap).
3. Link the snapshot chain again, so that no two snapshots share a `prevId`. The lexicographically last snapshot must describe the merged `schema.ts`; otherwise the next `db:generate` repeats upstream DDL.
4. Run the journal test and the relevant migration integration tests.

Known gap: one watermark cannot serve two lineages. An upstream migration that keeps its `when` does not run on a fork database with newer migrations. A new `when` breaks `reconcileMigrationJournal`, which assumes that every upstream migration is older than every fork migration: on a database created by upstream it records the upstream entries as applied, and fork migrations older than the new `when` do not run. By the same rule, a database created by upstream after its `0055_huge_sue_storm` (2026-09-30) skips fork migrations `0051` to `0058` when it changes to this fork's image; this follows from the migrator code and has no test. A migrator that records each applied entry, as monize does, would close the gap. It is not implemented.
