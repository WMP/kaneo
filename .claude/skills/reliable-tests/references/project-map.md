# Kaneo test map

The facts below were checked at commit `626f426` (2026-10-01) with Node 24.19.0, pnpm 10.32.1, Vitest 5.0.1, Biome 2.5.7 and a local PostgreSQL 16.14. Commands run from the repository root unless stated otherwise. When a cited file changes, check the fact again before you rely on it. The canonical command table is `docs/agent-guide/verification.md`; this file adds what an agent needs to run tests correctly.

## Suites

| Suite | Files | Config | Focused command | Needs | CI job |
| --- | --- | --- | --- | --- | --- |
| API unit | `tests/api/**/*.test.ts` | `apps/api/vitest.config.ts` | `pnpm --filter @kaneo/api exec vitest run --config vitest.config.ts ../../tests/api/<path>` | built `@kaneo/permissions` and `@kaneo/email` | `unit` |
| API integration | `tests/api-integration/**/*.test.ts` | `apps/api/vitest.integration.config.ts` | `pnpm --filter @kaneo/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/<file>` | the same builds, PostgreSQL, `DATABASE_URL` | `integration` |
| Storage | `tests/storage-integration/` | `apps/api/vitest.storage.config.ts` | `pnpm --filter @kaneo/api exec vitest run --config vitest.storage.config.ts` | disposable MinIO; `KANEO_STORAGE_TEST_ENDPOINT` on 127.0.0.1 | `storage` |
| Web | `apps/web/src/**/*.test.{ts,tsx}` | `apps/web/vitest.config.ts` (jsdom) | `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @kaneo/web exec vitest run --config vitest.config.ts <path>` | built `@kaneo/permissions` | `unit` |
| Packages | `packages/<name>/src/**/*.test.ts` for permissions, libs, mcp, email, planka-import | the package's `vitest.config.ts` | `pnpm --filter @kaneo/<name> exec vitest run --config vitest.config.ts` | nothing | `unit` |
| Guards | `scripts/ci/*.test.mjs`, `scripts/security/*.test.mjs` | node:test | `node --test scripts/ci/agent-guidance.test.mjs` | Docker for three security tests | `unit` |
| UI review bot | `scripts/ui-review-bot/tests/` | node:test | `npm ci --ignore-scripts && npm test` in `scripts/ui-review-bot` | nothing | `peekareq-tests` |
| Runtime | `scripts/ci/browser.mjs`, `scripts/ci/realtime.mjs`, `scripts/ci/upgrade.sh` | none | see `scripts/ci/README.md` | Docker and the image `kaneo:ci` | `docker-build` |

`pnpm test` runs each package's `test` script through Turbo, which builds the workspace dependencies first. For `@kaneo/api` that is the unit suite only; `pnpm test:integration` runs the integration suite. The skill's own scripts have self-tests: `node --test .claude/skills/reliable-tests/scripts/scripts.test.mjs` (CI does not run them).

Measured on 4 CPUs at `626f426`: API unit 123 files in about 22 s, web 185 files in about 140 s, integration 121 files in about 13 min (CI gives that job 15 min). Prefer focused files while you work.

## Before the first run

- Install with `pnpm install --frozen-lockfile`.
- Build the workspace packages that the API and the web app import from `dist/` (`@kaneo/permissions`, `@kaneo/email`): `pnpm exec turbo run build --filter='@kaneo/api^...'`. Without this build, 11 API unit files fail to load ("Failed to resolve entry for package `@kaneo/permissions`") while the `Tests` line shows only passed tests. After you change `packages/permissions` or `packages/email`, build again; otherwise the tests run against the old `dist/`.
- Integration tests: start a disposable PostgreSQL 16 (CI uses the `postgres:16` image) and set `DATABASE_URL` explicitly, for example `postgresql://postgres:postgres@localhost:5432/kaneo_test`. `tests/api-integration/setup.ts` refuses a database name that does not end in `_test`. Do not rely on its fallback: without `DATABASE_URL` it reads the root `.env`, adds `_test` to the name and can then create that database on the server that `.env` points to. Never point tests at production data.
- `tests/api-integration/helpers/database.ts` creates and migrates the test database and truncates every table before each test. Never run two integration processes against the same database at the same time; give each process its own `_test` database, for example `kaneo_<topic>_test`.
- If PostgreSQL does not answer, report the integration tests as BLOCKED with the error. Start a server yourself only when it is clearly a disposable local one, and say so in the report.
- Web tests: set `NODE_OPTIONS=--no-experimental-webstorage`, as CI does.

## Selecting tests

- A positional argument filters file paths by substring; it is not an exact path. From `apps/api`, `tests/api/client-ip.test.ts` and `../../tests/api/client-ip.test.ts` select the same file. A short filter can select many files.
- `-t "<pattern>"` filters test names. When no name matches, Vitest exits 0 and reports every test as skipped.
- A filter that matches no file exits 1 with "No test files found". `--passWithNoTests` changes that to exit 0; the repository does not use it.

## Runner behavior that hides problems

- `.only` passes locally and skips the other tests without a message. It fails only when the `CI` variable is set (Vitest's `allowOnly` defaults to `!CI`). Run with `CI=true` to see what CI will do.
- Biome, as configured, does not enable `noSkippedTests`. It reports `noFocusedTests` only as a warning and only where the nearest `package.json` depends on Vitest (`apps/web`, `packages/*`), not under `tests/`. `pnpm exec biome ci .` exits 0 in both cases. For an explicit check of changed test files: `pnpm exec biome lint --only=suspicious/noFocusedTests --only=suspicious/noSkippedTests --error-on-warnings <files>`. It does not detect `skipIf`, `runIf` or `todo`; `.claude/skills/reliable-tests/scripts/test-change-audit.mjs` does.
- `--retry` hides the first failure in the summary. No configuration sets `retry`.
- Time zone: no configuration or workflow sets `TZ`, so CI runs in UTC. At `626f426` the Gantt tests (`apps/web/src/components/gantt`) pass with `TZ=UTC` and `TZ=America/New_York`, and two tests in `gantt-portfolio.test.ts` fail with `TZ=Europe/Warsaw` and `TZ=Pacific/Auckland` (issue #38). For date work, also run the affected tests with `TZ=Europe/Warsaw` (daylight saving, east of UTC) and `TZ=America/New_York` (daylight saving, west of UTC), and compare with a baseline run in the same time zone. A daylight-saving case can fail only when its dates cross that zone's change.
- The cascade tests in `apps/web/src/components/gantt/gantt-dependency-cascade.test.ts` build dates with `Date.UTC` and use a `getUTCDay` working-day stub. Production uses local calendar days (`toDateKey`, `getDay`, `startOfDay`). In UTC the two agree, so these tests cannot detect a local-day error (see issue #37).

## How the application behaves in tests

- `createApp()` in `apps/api/src/index.ts` serves the routes without the start-up tasks: no plugin event subscriptions and no scheduler. Tests call scheduled jobs directly.
- `publishEvent` does not wait for handlers unless it gets `{ waitForHandlers: true }`. A handler error is logged and swallowed. `waitForPendingEventHandlers()` waits for handlers in progress. Work started with `void` (notification delivery, seat sync, asset clean-up after a task deletion) is outside that wait: wait for its visible effect with `vi.waitFor`.
- 26 of the 120 integration test files mock `publishEvent`. In those files, activity rows, notifications and WebSocket delivery do not run, so an assertion on the mock proves the call, not its effect.
- `mockAuthenticatedSession` (`tests/api-integration/helpers/auth.ts`) spies on `auth.api.getSession` and returns the same user for every request.
- In-process rate limits count per instance and are not reset between tests. Tests stay independent because each test creates new users.
- `bulkUpdateTasks` validates all schedule entries before its transaction. A test with a valid and an invalid entry proves validation before writing, not rollback.

## Helpers and models to copy

- Fixtures in `tests/api-integration/helpers/fixtures.ts`: `createWorkspaceMember`, `addWorkspaceMember`, `addProjectMember`, `createProjectFixture`. Use `members: "none"` for access tests, so that access comes only from explicit memberships.
- Refusal with no side effects and a positive control: `tests/api-integration/tenant-resource-boundaries.test.ts` (same 404 for a foreign and a missing id, nothing written, no sync or event, then the owner succeeds) and `tests/api-integration/task-relation-boundaries.test.ts`. A reusable "nothing written" helper: `expectNothingWritten` in `tests/api-integration/project-member-add-workspace.test.ts`.
- Real Better Auth sessions: `signUp` in `tests/api-integration/project-invitation-accept.test.ts`. API keys and Bearer tokens: `tests/api-integration/activity-actor-source.test.ts` and `tests/api-integration/workspace-role-delegation.test.ts`.
- Upgrade on populated data: `tests/api-integration/actor-source-migration.test.ts` (copy the migrations folder, cut the journal before the target migration, seed, upgrade, compare with a fresh database).
- Concurrency: `tests/api-integration/admin-role.test.ts` (two competing demotions) and `tests/api-integration/project-move.test.ts` (waits in `pg_stat_activity` until the second transaction blocks).
- Failure inside a transaction: a PL/pgSQL trigger that raises, as in `tests/api-integration/github-import-bounds.test.ts`; an injected `40P01` for `retryTransaction`, as in `tests/api-integration/resource-invitation.test.ts`.
- Time zone as an explicit parameter: `tests/api/calendar-feed/ical.test.ts`. Date-only reminders at several offsets with `vi.useFakeTimers({ toFake: ["Date"] })`: `tests/api-integration/date-only-reminders.test.ts`.
- External HTTP without the Internet: `vi.stubGlobal("fetch", ...)`, or a local `node:http` server as in `tests/api/utils/outbound-request.test.ts`.

## What CI enforces

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`, and Nightly reuses it. Jobs: `lint` (`biome ci .`), `i18n` (`pnpm i18n:check`), `openapi` (`pnpm openapi:check`), `typecheck`, `unit` (the guards and `pnpm test`), `build`, `integration` (PostgreSQL 16), `storage` (MinIO), `docker-build` (browser, realtime with and without Redis, upgrade from the latest upstream release), `split-images`, `workflows` (actionlint, shellcheck, zizmor), `secret-scan` and `peekareq-tests`. Local results cannot show that these jobs passed for a commit. `main` is a protected branch; which checks are required is not visible from the repository.

Not enforced today: a new `.skip`, `.todo`, `.fails`, `skipIf` or `runIf`; non-UTC time zones; coverage or mutation thresholds; `pnpm i18n:report`; owner review of test, runner or CI changes (there is no CODEOWNERS file); the browser path drag, cascade, save and reload (see `docs/agent-guide/scheduling.md`). The agent-guide guard checks links and paths in `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/` and `docs/agent-guide/`, not inside this skill.
