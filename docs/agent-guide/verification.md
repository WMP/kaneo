# Verification recipes

Use Node.js 24.19.0 (supported engine: Node 24+) and pnpm 10.32.1. From the repository root:

| Change | Focused check | Broader check when appropriate |
| --- | --- | --- |
| Agent instructions or contracts | `node --test scripts/ci/agent-guidance.test.mjs` | `node --test scripts/ci/*.test.mjs` |
| README or its screenshots | `node --test scripts/ci/readme.test.mjs` | the `update-readme` skill in `.claude/skills/update-readme/SKILL.md` |
| Demo data or the demo tool | `node --test scripts/ci/demo-data.test.mjs` | seed a disposable instance with `node scripts/demo/seed.mjs --reset` (see `scripts/demo/README.md`) |
| API utility/route | `pnpm --filter @kaneo/api exec vitest run --config vitest.config.ts <test-file>` | `pnpm --filter @kaneo/api typecheck`; API integration job for routing/DB |
| PostgreSQL behavior | `pnpm --filter @kaneo/api exec vitest run --config vitest.integration.config.ts <test-file>` | `pnpm test:integration` with disposable PostgreSQL |
| Web component/Gantt math | `pnpm --filter @kaneo/web exec vitest run --config vitest.config.ts <test-file>` | `pnpm --filter @kaneo/web typecheck`; real browser for interaction |
| Routes or response schema | `pnpm openapi:check` | API tests and affected typed consumers |
| Translation catalog | `pnpm i18n:check` | `pnpm i18n:report` for changed web strings |
| Multi-package change | affected package builds/typechecks | `pnpm typecheck`, `pnpm test`, `pnpm build` |

Focused Vitest commands assume dependencies are installed. PostgreSQL integration tests need the disposable test database; CI's service configuration is in `.github/workflows/ci.yml`. Browser/image/realtime/upgrade instructions are in `scripts/ci/README.md`. Never use a production connection string or storage credentials to make a check pass.

The `unit` job in `.github/workflows/ci.yml` runs `node --test scripts/security/*.test.mjs scripts/ci/*.test.mjs`, so the agent guidance guard participates in PR CI. Its local Node checks do not substitute for a runtime image build or a Gantt browser test.

Test the failure paths of a changed behavior, not only its success path. For a changed input, route, validation or constraint, add at least one test with data the behavior must reject (malformed, missing, out of range, or referring to a resource of another workspace). Assert the status and error `code`, and assert that nothing was persisted or published. When a contract promises an atomic write, test the stored state after a failure in the middle of it. A test of a mocked validator does not prove that the API rejects the data; use the route or a PostgreSQL integration test when the rejection depends on routing, authorization or the database. Build invalid data in the test or its fixture; never copy it from production or from a customer installation. The topical contracts name specific cases: [API and boundaries](api-and-boundaries.md) for other-workspace access, [Database](database.md) for populated and legacy rows, and [Project decisions](project-decisions.md) for rejected calendars and rollback.

`pnpm lint` and package `lint` scripts run `biome check --write` and can rewrite unrelated files. For a read-only style check use `pnpm exec biome ci <changed paths>`; regenerate OpenAPI only when changing its source, using `pnpm openapi:check:fix`, and inspect the generated diff. A failing test is evidence; fix the cause instead of deleting, skipping or weakening it.

Before reporting completion, say which commands passed or failed, what was not run, whether any browser/upgrade test was needed, and whether a guard relied on a tracked file. Documentation cannot itself verify a deployment or a security property.
