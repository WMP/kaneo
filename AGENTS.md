# Kaneo agent guide

Kaneo is a self-hosted project-management platform. The Hono API owns domain behavior and authorization; React/Vite consumes the typed client; PostgreSQL stores durable state; events and WebSockets keep clients current. Redis is optional for multi-instance realtime delivery. This file is the tool-neutral entry point. Explicit user instructions take precedence.

## Before changing code

Read the relevant implementation and tests, then use the [agent guide](docs/agent-guide/README.md) to select only the contracts your change touches. The [invariant index](docs/agent-guide/invariants.md) records behavior, its enforcement mechanism and known gaps. Do not treat an instruction or a passing unit test as proof of an untested system-wide claim.

| Before you change | Read in full | Verify |
| --- | --- | --- |
| API, permissions, MCP or integrations | [API and boundaries](docs/agent-guide/api-and-boundaries.md) | Affected API unit tests; integration tests for routing, authorization and PostgreSQL behavior; OpenAPI check for contract changes |
| Web UI, client state, realtime or i18n | [Web and realtime](docs/agent-guide/web-and-realtime.md) | Focused component tests and web typecheck; browser flow when interaction or persistence cannot be proven otherwise |
| Schema, migrations or existing data | [Database](docs/agent-guide/database.md) | Inspect generated SQL, test on existing-schema data and run relevant PostgreSQL integration tests |
| Gantt, relations, dates or calendar | [Scheduling](docs/agent-guide/scheduling.md) | Pure scheduling tests plus API integration tests for persistence, access and cross-project behavior |
| Docker, Helm, release or CI | [Deployment and release](docs/agent-guide/deployment.md) | Validate the affected build, chart, workflow or startup path |

For a change spanning rows, follow every affected contract. [Verification](docs/agent-guide/verification.md) maps checks to actual commands and explains which checks mutate files.

Before changing scheduling, cross-project relations, working calendars, branch image publishing, or the agent guide itself, read the accepted [project decisions](docs/agent-guide/project-decisions.md) in full. An accepted decision describes the target; check the contracts and invariant statuses for what is implemented today.

For work spanning multiple packages or pull requests, keep a short, self-contained plan with assumptions, scope, stages and verification before implementing the later stages. Place it with the relevant feature work; the existing `plans/` index is specific to motion improvements. Small changes do not need a plan.

## Rules that apply everywhere

- Keep Kaneo simple, responsive on large boards, and usable on a single instance without Redis. Preserve both bundled same-origin and separately hosted API/web deployments.
- The API enforces authentication, workspace permissions and data scope; a hidden UI control is not authorization. Never expose credentials or private workspace data in responses, events, WebSockets, logs or MCP.
- Follow a behavior change through its relevant surfaces: API schema/controller, permissions, typed client, UI/cache, events/realtime, MCP/integrations, database migration, documentation and translations. Check reverse actions and deletion where they apply; do not expand scope just to touch every surface.
- Use `@hono/zod-openapi` and the `apiRouter()` pattern for public routes, `@kaneo/permissions` for workspace permissions, `@kaneo/libs` for typed web requests, and `publishEvent()` for mutations that drive activity or realtime. Details and exceptions live in the linked contracts.
- Add user-facing text through static i18n keys in `i18n/en-US.json`, and translate each new or changed value into every locale in `i18n/` in the same change. An English placeholder in another locale is not a translation. Preserve accessibility and verify the relevant UI states.
- Existing installations and data matter. Generate a new Drizzle migration for schema changes, review its SQL and OpenAPI output where applicable, and test the upgrade path.
- When a user reports a recurring agent mistake, fix the behavior and add a meaningful regression check; document the rule in the appropriate contract. Prefer a type, constraint, lint rule or test to another long instruction.

## Safe working practice

- Use Node.js 24 (CI and images use 24.19.0) and pnpm 10.32.1, as declared in `package.json`. Server variables come from root `.env`; local Vite overrides belong in `apps/web/.env.local`.
- Never point development or test commands at production data, storage or credentials. Preserve unrelated work in a dirty worktree and stop only processes you started.
- Root and package `lint` scripts use Biome `--write` and can change unrelated files. Prefer a targeted read-only check while iterating; inspect any formatter diff.
- Do not commit, push or open a pull request unless explicitly requested.

Run the smallest meaningful checks during implementation, then the affected package gates before a requested PR. Report the behavior changed, checks actually run, checks not run, and known limitations. Do not claim a behavior is protected by CI without identifying the job and its test.

When opening a requested PR, name the affected IDs from the invariant index and their current statuses in the PR description, or say `None` if none applies. Do not mark a gap as enforced merely because this PR updates a document.

For releases, follow [deployment and release](docs/agent-guide/deployment.md). Put narrow workflows in their contract or an existing skill; keep this file short.
