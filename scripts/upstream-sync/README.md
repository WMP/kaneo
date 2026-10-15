# Upstream sync tooling

Scripts that make the weekly `git merge upstream/main` faster. Node 24, no extra dependencies. The merge rules themselves live in [`docs/agent-guide/database.md`](../../docs/agent-guide/database.md) ("Upstream sync") and [`docs/plans/demo-data.md`](../../docs/plans/demo-data.md) (Stage 4). These scripts only do the mechanical part; a person reviews every result.

Run everything from the repository root. Every script has `--help`.

## Order of work

1. **Setup (once per clone).** `scripts/upstream-sync/setup-git.sh` enables `rerere` (with autoupdate), sets `merge.renameLimit`, and adds the `upstream` remote.
2. **Merge.** `git fetch upstream && git merge upstream/main` (or take the branch of the `upstream-sync.yml` pull request). Do not commit until the steps below are done.
3. **Report.** `node scripts/upstream-sync/conflict-report.mjs` lists every unmerged path by status (`UU`, `AA`, `UD` deleted by upstream with the deleting commit, `DU`, `AU`, `UA`, `DD`), by area and by conflict hunk count. `--json` is for machines, `--markdown` for a pull request comment. Areas come from the ordered rules in `areas.json`; edit them when the layout changes. The exit code is 1 while paths are unmerged.
4. **Migrations.** `node scripts/upstream-sync/merge-migrations.mjs` (try `--dry-run` first):
   - keeps every fork journal entry, appends new upstream entries (upstream tag and `when`, `idx` renumbered), and skips the tags in `excluded-migrations.json`;
   - keeps the fork's snapshots, deletes upstream-only snapshots that do not chain onto the fork's newest one, and deletes SQL and snapshot files of excluded migrations.

   Add a new upstream migration to `excluded-migrations.json` (`tag`, `reason`, `replacedBy`) when the fork already contains its change. Then run `git add -A apps/api/drizzle`.

   The newest snapshot must describe the merged `schema.ts`. Generate it and cut the SQL down:

   ```sh
   pnpm --filter @kaneo/api exec drizzle-kit generate --name ganttpro_adopt_upstream_<label>
   node scripts/upstream-sync/uncovered-ddl.mjs apps/api/drizzle/<new>.sql <upstream sql files...>
   ```

   Keep only the printed statements in the new SQL file (statements marked `VERIFY BY HAND` need a look: upstream may set those defaults in a `DO $$ ... LOOP` block). Make them idempotent, as the existing adopt migrations do.

   Finish with `node scripts/upstream-sync/merge-migrations.mjs --check` (journal and SQL files match one to one, `idx` is the position, no two snapshots share an `id` or `prevId`) and the journal test from [`docs/agent-guide/verification.md`](../../docs/agent-guide/verification.md).
5. **i18n.** `node scripts/upstream-sync/merge-i18n.mjs` (try `--dry-run`) does a 3-way merge of `en-US.json` and rebuilds every other locale from the merged English keys, choosing the fork or upstream value per key. Review the printed en-US conflicts. Options: `--en-prefer theirs|ours`, `--prefer-fork-locales pl-PL,...`. It does not stage the files. Then:

   ```sh
   pnpm i18n:schema && pnpm i18n:check && pnpm i18n:untranslated:check
   ```

   Values that are still English placeholders must be translated (or recorded in the untranslated baseline by a person) before the pull request is merged.
6. **Code.** Resolve the remaining conflicts one agent per area of the report (`api-access`, `api-tasks`, `api-other`, `web-task`, `web-views`, `web-settings`, `tests`, `docs-ci`, `other`). Read the decision log (`docs/upstream-sync/decisions.md`, Stage 4 of the demo-data plan) first, once it exists, and add an entry for each hard decision. For `UD` and `DU` paths, read the deleting commit before choosing.
7. **Generated files.** Do not merge them by hand; regenerate them after the code is resolved:
   - `pnpm install` for `pnpm-lock.yaml` (take upstream's lockfile as a starting point only if the install cannot resolve it);
   - `pnpm openapi:check:fix` for `apps/docs/openapi.json`;
   - `apps/web/src/routeTree.gen.ts`: there is no `tsr` CLI in this repository. The `@tanstack/router-plugin` Vite plugin writes the file, so run `pnpm --filter @kaneo/web build` (or start `pnpm --filter @kaneo/web dev` once) and inspect the diff;
   - `pnpm i18n:schema` (step 5).
8. **Schema drift.** With a disposable PostgreSQL server (never production):

   ```sh
   node scripts/upstream-sync/schema-drift.mjs --database-url postgresql://postgres:postgres@localhost:5432/postgres
   ```

   It applies `apps/api/drizzle` with the fork's runner to scratch database A, runs `drizzle-kit push --force` against scratch database B, and compares columns, indexes and constraints (triggers and functions are not compared). Differences listed in `schema-drift-allowlist.json` are reported but allowed; anything else exits 1. `--from-database-template <db>` starts A from an existing (for example upgraded) database. Scratch databases are named `kaneo_sync_drift_<random>_test` and dropped at the end.
9. **Tests.** Run the checks from [`docs/agent-guide/verification.md`](../../docs/agent-guide/verification.md): the journal test, `tests/api-integration/migration-runner.test.ts`, API and web typechecks and tests, `node --test scripts/upstream-sync/*.test.mjs scripts/ci/*.test.mjs`, and the upgrade check of Stage 4.

## Files

| File | Purpose |
| --- | --- |
| `setup-git.sh` | One-time git config and `upstream` remote |
| `conflict-report.mjs`, `areas.json` | Classify unmerged paths |
| `merge-migrations.mjs`, `excluded-migrations.json` | Merge the Drizzle journal and snapshots |
| `uncovered-ddl.mjs` | Find generated DDL that upstream migrations do not cover |
| `merge-i18n.mjs` | Merge the locale files |
| `schema-drift.mjs`, `schema-drift-apply.mjs`, `schema-drift-allowlist.json` | Compare migrations with `schema.ts` on scratch databases |
| `lib.mjs`, `test-utils.mjs` | Shared helpers |
| `*.test.mjs` | Tests: `node --test scripts/upstream-sync/*.test.mjs` |

## Limits

- `conflict-report.mjs` and `merge-*.mjs` read the merge stages with `git show :1:`, `:2:`, `:3:` and fall back to the refs; they never run a git command that changes the index or the worktree. They write files only (not staged).
- `merge-migrations.mjs --check` covers the journal, SQL and snapshot rules; the watermark and tag-name rules are only in the vitest journal test.
- `uncovered-ddl.mjs` compares normalized statement text. It does not understand SQL: a statement that upstream splits or reformats differently is reported as uncovered, and renames and drops are not tracked.
- `schema-drift.mjs` does not compare triggers, functions or data, and needs a PostgreSQL 13+ server (it uses `DROP DATABASE ... WITH (FORCE)`).
