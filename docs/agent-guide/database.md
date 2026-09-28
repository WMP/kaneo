# Database and migrations

Define schema in `apps/api/src/database/schema.ts` and relations in `apps/api/src/database/relations.ts`. Generate migrations with `pnpm --filter @kaneo/api db:generate`, inspect the resulting SQL and Drizzle metadata, and include schema and migration together. Never edit or renumber a migration already applied to an installation. Preserve the migration journal's upstream lineage when syncing this fork; check for colliding migration numbers and inspect changes to snapshots.

Review defaults and backfill behavior against populated tables, not just an empty database. Consider indexes, foreign keys, uniqueness, deletes and nullable legacy rows. Prefer additive migrations when an older binary can still run during rollout. The `ganttpro_` prefix is used for additions in this fork's Gantt migration; a new field does not justify an unrelated rename of upstream tables.

The API migrates on startup. Use disposable PostgreSQL and the relevant `tests/api-integration/` tests to prove constraints and authorization. For schema changes, inspect the upgrade from the prior shape as well as fresh creation; the bundled image's upgrade scenario is described in `scripts/ci/README.md`. A passed unit test with a mocked database is not migration proof.
