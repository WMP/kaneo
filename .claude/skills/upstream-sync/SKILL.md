---
name: upstream-sync
description: Merge usekaneo/kaneo (upstream) into this fork. Use when asked to sync, pull or merge upstream changes, or to resolve the weekly upstream-sync pull request.
---

# Upstream sync

The fork ("Kaneo Pro") merges `usekaneo/kaneo` `main` regularly. A merge is one merge commit on a branch, never a rebase. Read these first:

- `docs/upstream-sync/decisions.md`: decisions from earlier syncs. Apply them again without asking.
- `docs/upstream-sync/exceptions.md`: upstream changes that are deliberately not merged, and what the fork uses instead.
- `docs/agent-guide/database.md` (section "Upstream sync") and `scripts/upstream-sync/README.md`.

## 1. Prepare

```bash
export PATH=/opt/node24/bin:$PATH   # Node 24, if the default node is older
bash scripts/upstream-sync/setup-git.sh   # rerere, rename limit, upstream remote
git fetch upstream main
git fetch --unshallow origin 2>/dev/null || true   # a shallow clone has no merge base
git merge --no-ff --no-commit upstream/main
node scripts/upstream-sync/conflict-report.mjs          # table by area
node scripts/upstream-sync/conflict-report.mjs --markdown > /tmp/conflicts.md
```

## 2. Mechanical parts (main session)

1. **Manifests and lockfile.** Resolve `package.json` files and `pnpm-workspace.yaml` by hand: take upstream's versions, keep the fork's extra dependencies. Keep `@better-auth/core` equal to `better-auth`. Then take upstream's `pnpm-lock.yaml` and run `pnpm install` to update it. Never merge the lockfile by hand.
2. **Database.** Resolve `apps/api/src/database/schema.ts` (both sides' columns; fork column names keep `ganttpro_`). Then run `node scripts/upstream-sync/merge-migrations.mjs`. It appends upstream entries, skips `scripts/upstream-sync/excluded-migrations.json` and fixes snapshots. Check each upstream SQL file against the fork schema (renamed `ganttpro_` columns and tables), and adapt it if needed with a header comment. Then run `pnpm --filter @kaneo/api exec drizzle-kit generate --name ganttpro_adopt_upstream_<label>`, and use `node scripts/upstream-sync/uncovered-ddl.mjs <generated.sql> <upstream sql files>` to reduce the SQL to idempotent statements that no upstream migration covers. Verify with `node scripts/upstream-sync/schema-drift.mjs --database-url postgresql://postgres:postgres@localhost:5432/postgres`, and also on a copy of a database created by upstream.
3. **i18n.** Run `node scripts/upstream-sync/merge-i18n.mjs`, then `pnpm i18n:schema`, `pnpm i18n:check` and `pnpm i18n:untranslated:check`. Translate the new keys into every locale. Use one agent per group of locales, and give each agent the list of keys and the English text.
4. **Generated files** at the end: `pnpm openapi:check:fix`, the web build for `apps/web/src/routeTree.gen.ts`, `pnpm i18n:schema`.

## 3. Code (agents, one per area)

Give each agent: the policy below, its list of paths from the conflict report, and the read-only git rule. Agents edit files only. The main session runs `git add`/`git rm`.

Policy:

- The fork's features stay. When both sides built the same feature, the fork's behaviour, API contract and tests win. Upstream's extra improvements are taken where they fit.
- **Project access:** only the fork's model (`ganttpro_project_member`, `apps/api/src/utils/project-access.ts`, `project-scope-filters.ts`). Upstream code that imports `apps/api/src/project-access/*` uses the adapters there. A function without an adapter is mapped as `docs/upstream-sync/exceptions.md` says. Never widen access while merging.
- **Web UI:** adopt upstream's redesign and port every fork feature into it. Add a row to `decisions.md` for each fork feature that moved.
- **Tooling:** Vite+ (`vp`). Do not reintroduce Biome or Turbo.
- To read a conflict: `git show :1:<path>` (base), `:2:` (fork), `:3:` (upstream). Fork history: `git log 1d61ceb6..origin/main -- <path>`, with the merge base instead of the hash. For a path deleted by upstream, find the replacement with `git log --diff-filter=D -1 upstream/main -- <path>`.

Suggested areas: `api-access`, `api-tasks`, `api-other`, `web-task`, `web-views`, `web-settings`, `docs-ci` (see `scripts/upstream-sync/areas.json`).

## 4. Verify, record, commit

1. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:integration` (PostgreSQL), `pnpm openapi:check`, `pnpm i18n:check`, `pnpm i18n:untranslated:check`, `node --test scripts/upstream-sync/*.test.mjs`.
2. Add new hard decisions to `docs/upstream-sync/decisions.md`, and new skipped changes to `exceptions.md`.
3. Commit the merge as one merge commit: `Merge upstream/main (<short sha>) into <branch>`. Push, then run CI (`workflow_dispatch` or a pull request).
4. After the merge lands on `main`, run the `update-readme` skill for the merged range.
