# Cases and techniques by risk

Use the sections that match the risks of your change. Each section gives failure modes, cases and the level that can detect them. The contracts in `docs/agent-guide/` decide the expected behavior; when they are silent, record an open question instead of choosing a rule.

Contents: [Authorization and scope](#authorization-and-scope) · [Input and boundaries](#input-and-boundaries) · [State, repetition, concurrency, atomicity](#state-repetition-concurrency-atomicity) · [Asynchronous work and realtime](#asynchronous-work-and-realtime) · [External services](#external-services) · [Migrations, compatibility and existing data](#migrations-compatibility-and-existing-data) · [Billing](#billing) · [Deletion](#deletion) · [Techniques](#techniques) · [Mutation probe](#mutation-probe) · [Coverage and performance](#coverage-and-performance)

## Authorization and scope

Contracts: `docs/agent-guide/api-and-boundaries.md`; IDs KAN-AUTH-001 to KAN-AUTH-006, KAN-REALTIME-001.

Failure modes: a referenced resource is not checked for membership; a list, search, count, export, activity feed or notification leaks rows from other projects; a bulk payload carries a foreign id; an MCP tool, API key or WebSocket path skips a check that the route has; a role grant exceeds the granter's own permissions.

- Select cells from this matrix that the change touches: actor (anonymous, guest, viewer, member, admin, owner, project member, workspace member without project membership, member of another workspace, API key with a narrow scope) × entry point (route, list or search, export, activity, notifications, bulk operation, MCP tool, WebSocket) × resource (own project, other project in the same workspace, other workspace, missing id).
- Assert the refusal that the contract and route schema specify. Kaneo uses both 403 (for example "You don't have access to this project" from `workspaceAccess`) and 404 (a resource the caller may not see "does not exist", so the route is no oracle for ids). Copy the convention from the contract and the neighboring tests; do not choose one yourself.
- After the refusal, compare the stored rows with the state before the request, and assert that no event, notification, sync or socket message happened.
- Include a positive control in the same test or file: the same request by an authorized actor succeeds.
- Use real Better Auth sessions when the behavior depends on cookies, Bearer tokens, API-key scope or session state; `mockAuthenticatedSession` cannot prove those paths.
- Mutants that a good test kills: remove `workspaceAccess.*()` or `requireWorkspacePermission(...)` from the route; replace a `projectScopeCondition(...)` with no condition; compare with the wrong workspace id; allow `owner` in a delegation check.

## Input and boundaries

- Test both sides of each limit. For `z.number().int().min(0).max(127)` that is -1, 0, 1, 126, 127, 128 and a non-integer. When the domain is small, test all of it (for example all 128 working-day masks) instead of a sample.
- Text: empty, blank, maximum length and maximum + 1, Unicode (combining marks, emoji, right-to-left text), case and whitespace variants of unique names.
- Dates: date-only fields (holidays are stored at UTC midnight) versus timestamps (`validateDateRange` compares task dates exactly; comments that call task `startDate`/`dueDate` date-only do not match the code, issue #40); local versus UTC calendar day; daylight-saving changes (in Europe, the last Sunday of March and of October; in the United States, the second Sunday of March and the first Sunday of November); 29 February; the time zone as a parameter versus the environment `TZ`.
- Numbers: precision and rounding (progress percentage, assignment `units`), negative values where they mean something (a negative `lagDays` is a lead).
- Alternative inputs: the same field can arrive through REST, MCP tools (`apps/api/src/mcp/tools.ts` has its own Zod schemas), the stdio MCP package, imports and integrations. Test each path that the contract covers, or report the paths you did not cover.

## State, repetition, concurrency, atomicity

- Illegal transitions and skipped steps, for example accepting an expired or cancelled invitation, or re-sending after acceptance.
- Repetition: send the same request twice; replay a webhook with the same event id; retry after a failure. The second attempt must not apply the change twice. Assert idempotency only when the contract promises it.
- Stale data: an update based on an old read, or two operations on the same row in a different order.
- Concurrency: start competing requests together (`Promise.all`) and assert the invariant on the final state (one administrator left, unique numbers, one code). When the race window is narrow, hold a lock in one transaction and wait in `pg_stat_activity` until the other one blocks. A parallel run without such synchronization does not prove that a race is closed; report it as "not proven".
- Atomicity: make a later step fail inside the transaction and assert that nothing from the earlier steps remains. Make the failure hit a write that comes after a successful write. When the order of writes is not specified, fail on the N-th write (see the sequence trigger in `examples.md`), not on a chosen row. `retryTransaction` retries `40P01` and `40001` three times; test the retry and the exhausted case.
- Events after a commit: decide what the contract promises. A commit does not guarantee delivery, and a failing publish is only logged.

## Asynchronous work and realtime

- Wait for completion: `publishEvent(..., { waitForHandlers: true })`, `waitForPendingEventHandlers()`, or `vi.waitFor(() => condition)`. Before a negative assertion, wait for the same completion signal. Use a fixed delay only as a last resort, with a stated horizon.
- Fake only `Date` when the code under test also does real I/O: `vi.useFakeTimers({ toFake: ["Date"] })`.
- WebSocket: authorization at the upgrade, revalidation after `ACCESS_REVALIDATE_MS`, close codes 1008 and 1011, and payloads limited to the project's task ids. Realtime must work on one instance without Redis; only the `docker-build` job tests Redis fan-out.

## External services

- No public Internet. Stub `fetch`, start a local `node:http` server on 127.0.0.1, or mock the client module at its boundary.
- Cases: timeout, non-2xx status, malformed JSON, a body that is too large, a redirect (outbound requests use `redirect: "error"`), a private destination (`assertPublicDestination`). A test that sets `KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS` no longer tests SSRF protection.
- A test of the request shape does not prove the business effect; also assert what was stored or shown.
- Check an adapter against its provider's contract with a local stand-in where one exists, for example MinIO for S3 in `tests/storage-integration/` (CI job `storage`). Keep checks that need the real provider or the Internet out of the default suites.
- Do not copy the network-dependent pattern in `tests/api-integration/project-membership-access.test.ts`, which resolves `hooks.example.com` and accepts any status except 401 and 403.

## Migrations, compatibility and existing data

Contract: `docs/agent-guide/database.md`; ID KAN-DATA-001.

- For a change to a route, request or response schema: `pnpm openapi:check`, then the typed consumers (`packages/libs`, the web fetchers in `apps/web/src/fetchers/`, the MCP tools in `apps/api/src/mcp/tools.ts` and the published package in `packages/mcp`). An older published MCP package or integration can still send the old shape.

- Generate with `pnpm --filter @kaneo/api db:generate` and read the SQL.
- Upgrade a database that has the previous schema and representative rows: null values, legacy values, duplicates, rows that a new constraint would reject. Compare with a fresh database. Copy the pattern of `tests/api-integration/actor-source-migration.test.ts`.
- Check defaults, backfill, indexes, foreign keys and `ON DELETE` behavior, and whether an older binary can still run against the new schema.
- A mocked database is never migration evidence.

## Billing

- The Creem client is mocked in every test; never call a real payment provider.
- Cases: webhook signature at the HTTP route (no test calls `/api/billing/webhook` over HTTP today), duplicate event id, an event without an id, a failure during apply and then a retry, the entitlement boundary at the trial end, and seat counts after members are added and removed.

## Deletion

- Assert what disappears and what must stay: rows of other workspaces, shared tasks with `userId` set to null, audit rows. Test the refusals (sole owner, active subscription: 409).
- Clean-up of stored objects often runs asynchronously; observe the effect or report it as untested.

## Techniques

Properties must come from the domain. Do not assume commutativity, reversibility or idempotency without a source. An implementation that does nothing passes an idempotency check, and fuzzing without a crash proves no business rule. Combine each property with concrete examples that have literal expected values.

- **Exhaustive small domains:** all masks, all role pairs, all dependency types. Prefer this to random data when the domain is small.
- **Property-based:** `fast-check` is in the lockfile only as a transitive dependency (through `effect`); no workspace package declares it, so do not import it. Adding it is a dependency decision for the user. Without it, use a seeded generator in plain Vitest: put the seed in the assertion message, reduce a failing case by hand to a minimal counterexample, and keep that counterexample as a normal example test. Vary the seed while you explore; do not freeze exploration to one data set for ever.
- **Metamorphic:** state how the output must change when you change the input in a controlled way. Kaneo examples: the cascade result in local calendar days does not depend on `TZ`; the order of `edges` does not change the cascade; a holiday on a non-working day changes nothing; a repeated billing webhook with the same event id has no extra effect (the handler deduplicates by event id in `apps/api/src/billing/controllers/handle-webhook.ts`); with no holidays, `index(d + 7 days) - index(d)` of `makeWorkingDayIndexer` equals the number of working weekdays.
- **Stateful or model-based:** run a sequence of operations (invite, accept, move the project, remove the member) against a small model inside the test, and check the invariants after each step (no project access without workspace membership, no duplicate member rows).
- **Differential:** compare with an independent, trusted reference, for example a naive day-by-day counter against `makeWorkingDayIndexer`, or the old implementation during a refactor. Write down the allowed differences and the known bugs of the reference first.
- **Architecture rules:** the repository has no import-boundary tool; do not add one without a decision.

## Mutation probe

`.claude/skills/reliable-tests/scripts/mutation-probe.mjs` copies the current state (HEAD, uncommitted changes and untracked files that git does not ignore) into a temporary git worktree, installs dependencies offline, runs the test command once on the original and then once per mutant, and removes the worktree. It never changes your working tree.

Write the mutants to a JSON file outside the repository, for example in your scratch directory:

```json
{
  "mutants": [
    { "id": "range-gt-to-gte", "file": "apps/api/src/utils/validate-dates.ts",
      "search": "startDate.getTime() > dueDate.getTime()",
      "replace": "startDate.getTime() >= dueDate.getTime()" }
  ]
}
```

`search` must occur exactly once in the file. For a change in several places, use `{ "id": "...", "patch": "<file.patch>" }`. Then run:

```sh
node .claude/skills/reliable-tests/scripts/mutation-probe.mjs --mutants <mutants.json> \
  --setup "pnpm exec turbo run build --filter=@kaneo/api^..." \
  -- pnpm --filter @kaneo/api exec vitest run --config vitest.config.ts ../../tests/api/utils/validate-dates.test.ts
```

- Statuses: `KILLED` (a test failed), `SURVIVED` (all tests passed), `ERROR` (non-zero exit without a failed test: compile, import or start-up error, or timeout; this is not detection), `INVALID` (the mutant did not apply). Exit code 0 means every mutant was killed, 1 means at least one was not, 2 means a usage error, a failed install or setup, or a red baseline.
- For integration tests, export a dedicated database first, for example `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kaneo_mutation_test`, and do not run other integration tests on it at the same time.
- A mutant in `packages/permissions` or `packages/email` needs a build inside the test command, for example `-- sh -c "pnpm --filter @kaneo/permissions build && pnpm --filter @kaneo/api exec vitest run ..."`, because the API imports their `dist/`.
- Read the evidence lines of each `KILLED` mutant: the failing test must be the one that covers the changed behavior.
- A timeout stops only the direct child process; check for left-over test processes after a timeout. The default timeout is 600 s (`--timeout` changes it).

## Coverage and performance

- Coverage: `pnpm --filter @kaneo/api test:coverage` runs the API unit tests with the v8 provider and writes `apps/api/coverage`. Use it to find branches in the changed code that no test executes. Other packages have no coverage setup. Do not add thresholds.
- Performance: test it only for a requirement or a known large-board concern. Use stable measures (number of queries, rows touched, growth with the number of tasks) instead of wall-clock milliseconds, and take budgets from the requirement.
