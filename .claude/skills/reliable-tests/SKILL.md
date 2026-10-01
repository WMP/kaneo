---
name: reliable-tests
description: Kaneo procedure for designing, writing, reviewing and running tests that catch real defects instead of confirming what the code already does. Use it whenever you implement a feature, fix a bug, refactor code in a way that changes risk (authorization, workspace or project scope, stored data, migrations, scheduling dates, events or realtime, billing, deletion), add, change, delete or skip tests, are asked to make a failing test or CI pass or to relax an assertion, change test, runner or CI configuration, or review test quality or test results, even when the user does not mention tests. For documentation-, copy- or translation-only edits that change no behavior, do not start the full process.
---

# Reliable tests

AI agents write most of Kaneo's code and tests. The usual failure is a test that mirrors the implementation: it passes for the code as written, bugs included. A test is useful only when a plausible wrong implementation makes it fail. This skill gives the procedure. The rules of the product stay in `docs/agent-guide/`; this skill points to them and does not restate them.

## Size the work first

| Change | What to do |
| --- | --- |
| Documentation, copy or translation only | No behavior tests. Run only the check that owns the files: `node --test scripts/ci/agent-guidance.test.mjs` for `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/` and `docs/agent-guide/`; `pnpm i18n:check` (and `pnpm i18n:report` for changed web strings) for locale files. Then stop. |
| Small, low-risk behavior change | Two or three sentences of behavior map in your reply or PR, focused tests, the checks of the affected package. |
| Significant change or high risk | A written behavior map, detection evidence for each important rule, targeted mutations, and a fresh-context review when possible. |

High risk in Kaneo: permissions and role delegation, workspace and project isolation (KAN-AUTH-*), billing and seats, migrations and existing data (KAN-DATA-001), deletion and other irreversible operations, concurrency and atomic writes, and every behavior that `docs/agent-guide/invariants.md` marks `partial` or `unenforced`. A change to shared test infrastructure (fixtures, `tests/api-integration/setup.ts`, Vitest configs, `packages/permissions`) widens the scope, because many tests depend on it.

## Load only what you need

- [references/project-map.md](references/project-map.md): suites, verified commands, environment, runner traps, helpers, CI gates. Read it before your first test run in a session.
- [references/risk-techniques.md](references/risk-techniques.md): negative and boundary cases per risk; property, metamorphic, stateful, differential, mutation and concurrency techniques; the mutation script. Read it when you design scenarios.
- [references/examples.md](references/examples.md): Kaneo examples of behavior maps, independent oracles, denial tests, rollback tests, mutation results and a report. Read it when you write or review tests.
- The contracts through the matrix in `AGENTS.md`, the invariant IDs in `docs/agent-guide/invariants.md` and the accepted targets in `docs/agent-guide/project-decisions.md`. An accepted decision is a target, not a description of the current code.

## Rule 1: fix the expected behavior before you look at the result

Take the expected result from a source that does not depend on the code under test: accepted requirements, a contract, an invariant ID, an accepted decision (DEC-*), a domain rule, a verified worked example, or an independent reference model.

- Do not compute an expected value with the function, algorithm or production helper under test, or with code that shares its logic. Shared data factories, such as `tests/api-integration/helpers/fixtures.ts`, are allowed. Shared logic that produces the answer is not.
- Write literal expected values that a person can check by hand, or derive them with a different and simpler method.
- Output that the application produced (a snapshot, a recorded response, a value copied from a run) is not the truth. It becomes a reference only after you check it against the source.
- When the source is silent or contradictory, say so. Do not decide rules about permissions, money or data loss yourself. Put the open question in your report and ask the user.

A test that records existing behavior without an accepted source is a **characterization test**. Mark it in the test name or a comment (`characterization:`). It protects compatibility during a refactor; it does not prove business correctness. If you compare with an old implementation, list its known bugs first, so that the comparison does not preserve them.

## Rule 2: write the behavior map

For a significant change, write the map before the test code:

| Rule and source | Scenario | Expected result and state | Wrong implementation it catches |
| --- | --- | --- | --- |

Each row names a concrete defect: "`>` changed to `>=`", "project filter removed from the list query", "event published twice", "first write kept after the second write fails". A row without a defect is a coverage wish, not a test design. For a small change, two or three sentences with the same parts are enough; do not create a document for them. Put the table in the PR description or in the feature plan.

## Workflow

1. **Scope.** Name the changed behavior, the contracts and invariant IDs it touches, and the risk level. Record the baseline: `git rev-parse HEAD`, `git status --short`, and a run of the existing focused tests. Note the failures that exist before your change.
2. **Design.** Write the behavior map. Select cases with [references/risk-techniques.md](references/risk-techniques.md). Select the lowest test level that can detect each defect ("Levels and mocks" below).
3. **Write the tests** from the map, not from the implementation.
4. **Prove detection.**
   - Bug fix: run the new regression test on the defective code and see it fail; fix the code and see it pass. If you cannot run the defective version, say so and use a targeted mutation.
   - New feature: a test that fails because the feature does not exist yet is a normal TDD step. It does not prove that the assertions are strong. For important rules, run targeted mutations after the implementation.
   - Read every failure. It must come from the asserted behavior: expected value against received value, or the specified status and error `code`. An import error, an unbuilt workspace package, a missing database, a syntax error or a timeout proves nothing.
5. **Implement**, or complete the implementation.
6. **Run** the focused tests, then the tests of the code that depends on the change, then the gates that `docs/agent-guide/verification.md` requires. Check the counts ("Trust the run, not the summary"). Vitest is installed per package, so `npx vitest` from the repository root fails; use the package form, for example `pnpm --filter @kaneo/api exec vitest run --config vitest.config.ts ../../tests/api/<file>` (more in the project map).
7. **Review the test changes** as carefully as production code. Run `node .claude/skills/reliable-tests/scripts/test-change-audit.mjs` and give a reason for each signal. For high risk, use a fresh-context reviewer.
8. **Report** with the template at the end of this file.

## Negative and boundary cases

Select them from the real risks of the change, not only from form validation:

- **Data:** missing value, `null`, empty or blank text, zero, minimum and maximum, and the values on both sides of each boundary. Also Unicode, dates and time zones, and number precision where they matter.
- **Access:** no authentication, a role without the permission, a resource in another workspace, a project the caller is not a member of. Also the other entry points to the same data: lists, search, counts, export, activity, notifications, bulk operations, MCP tools, API keys and WebSocket delivery.
- **State:** an illegal transition, a skipped step, a repeated request, a duplicate, stale data, two concurrent requests.
- **Dependencies:** a timeout, a malformed response, a database error, and a failure after part of the operation is done.

For each refusal, assert the kind of refusal that the contract specifies (status and error `code`) **and** the absence of forbidden effects: no row written or changed, no event, notification, email or integration sync, and no private data in the body, logs or socket messages. The contract decides which effects are allowed, for example an audit row or a rate-limit counter. For asynchronous work, wait until the work is complete before you assert that something did not happen (`publishEvent(..., { waitForHandlers: true })`, `waitForPendingEventHandlers()`, or `vi.waitFor` on a condition).

**Authorization pattern.** The other user's resource really exists. The request is valid and reaches the real route. The owner can do the operation (positive control). The other user cannot: the response is the specified refusal and the stored state does not change. A random 404 or 500, or a mocked permission helper that returns "deny", does not prove authorization.

## Levels and mocks

- Use the lowest level that can detect the defect: unit tests for pure logic; PostgreSQL integration tests (`tests/api-integration/`) for queries, constraints, transactions, routing and authorization; a browser run for drag, persistence and reload. Kaneo has no fixed test-pyramid ratio, so do not invent one.
- Do not mock the behavior that you verify. A stub repository cannot prove a query, a transaction or a constraint. If the necessary infrastructure is missing, report the gap; do not hide it with a mock.
- `mockAuthenticatedSession` replaces authentication only; routes, permission middleware and the database stay real. Use real Better Auth sessions (sign-up, cookies, Bearer tokens, `x-api-key`) when the authentication path, the API-key scope or the session state is the behavior.
- Control time (`vi.useFakeTimers`, `vi.setSystemTime`), the time zone (`TZ=` on the command), randomness and external services. A test must not need the public Internet.
- Create test data in the test or a fixture. Never copy data from production or from a customer installation, and never use production connection strings or credentials.
- Keep tests independent. Each test creates its own users, workspaces, sessions, files and settings, restores global state (environment variables, timers, spies), and passes alone and in any order. To find an order dependence, run with `--sequence.shuffle --sequence.seed=<n>` and record the seed.
- Wait for an observable condition with a time limit (`vi.waitFor`), not for a fixed delay. A parallel run alone does not reproduce a race.
- A contract test of a message does not prove the stored effect. A component test with mocked hooks does not prove the user flow.
- In the UI, test what the user can see and stable interfaces (roles, labels, accessible names). Kaneo has no snapshot tests. Add a snapshot only for a deliberate comparison that a person reviews.

## Trust the run, not the summary

- Confirm that tests ran: the file and test counts are above zero and include your new tests. In Vitest 5, a `-t` pattern that matches nothing exits 0 with all tests skipped.
- Read file-level failures. A file that fails to load is not in the `Tests` count.
- Do not get a green result by weakening assertions, catching and ignoring errors, adding `.only`, `.skip`, `.todo`, `.fails`, `skipIf` or `runIf`, narrowing `include` or filters, raising timeouts to hide slowness, lowering thresholds, or updating snapshots without review. Do not keep an incorrect test because it already exists.
- Change an expected behavior only when the requirement changes. Name the source of the change and ask for review. A request to loosen or skip a test needs the steps in the next section.
- A retry can help to diagnose a flaky test. A pass on retry does not remove the instability; report it. Quarantine needs an explicit decision, an owner and an exit condition from the user; the repository has no quarantine mechanism.
- Use the baseline run to separate inherited failures from new ones.

## When someone asks to loosen, skip or delete a test

Such a request asks the suite to stop detecting something, often without showing what. Treat it as a question about the requirement, not as an edit.

1. Run the failing test first and read why it fails.
2. If the failure comes from the code change, the test did its job. Say so and propose to fix or revert the code.
3. If the requirement really changed, write the new exact expectation: the new status, value, count or stored state. A looser check (`toBeGreaterThanOrEqual`, `toBeDefined`, a wider range) also passes the next regression, and `.skip` or a deleted test passes everything.
4. Do not apply the loosening, skip or deletion in the same step. State what the weaker test would stop detecting, offer the exact alternative, and wait for the user's decision. A statement that the change is harmless, rare or an edge case is a claim to check against the contract and the code that uses the behavior, not a decided requirement.
5. If the user confirms after seeing this, do what they decided, update the comment or contract that stated the old rule, and record the decision and the lost protection in the report.

## Check the strength of the tests

- Assert the meaningful result and the resulting state. Status 200, `toBeDefined()` or `toHaveBeenCalled()` without arguments seldom proves a business operation. One scenario can have several assertions.
- Use **targeted mutation** for critical logic and for tests that look weak: change `>` to `>=`, remove a permission check, drop the owner or project filter, invert a sign, remove a deduplication, skip a write. Run each mutant in an isolated copy with `.claude/skills/reliable-tests/scripts/mutation-probe.mjs` (usage in [references/risk-techniques.md](references/risk-techniques.md)). Never put a mutation in the working tree. The script stops when the original is not green.
- Classify each surviving mutant: real gap, equivalent mutant, behavior outside the contract, or tool problem. Do not remove a mutant to get a better result. A mutant that causes a compile, import or start-up error does not count as detected. If you did not run a mutation, report a hypothesis, not proven strength.
- Use coverage to find paths that no test executes, not as a quality gate. Only `@kaneo/api` has a coverage script (`test:coverage`, unit tests); there are no thresholds, and this skill adds none.

## Fresh-context review for high risk

If the environment can start a separate agent, review in two steps. First, give it only the requirements, contracts and interfaces, and ask for test cases and counterexamples. Then show it the implementation and the tests, and ask for inputs that break them and for tests that cannot fail. A second agent, even a different model, does not guarantee independence and does not replace executable checks. Report whether a review took place and what it found. Never claim a review that did not take place.

## Cost tiers

- While you work: the focused test files and the code that depends on them.
- Before a requested PR: the gates of the affected packages from `docs/agent-guide/verification.md`, which match the CI jobs.
- When the risk justifies it: mutation probes, more time zones, concurrency loops, and the browser, realtime or upgrade checks in `scripts/ci/README.md`.

Do not run the full suite after every edit, and do not use every technique for a copy change. Do not skip a required check to save time. Justify each extra check with a concrete failure mode, not with a number of tests.

## Instructions are not enforcement

This skill guides agents. CI, permissions and human review protect the criteria. The project map lists what CI enforces and the known gaps, for example: nothing in CI rejects a new `.skip`, `.todo` or `skipIf`; there is no CODEOWNERS file; CI runs only in UTC (no job sets `TZ`). Do not present `AGENTS.md`, this skill or a second agent as a security boundary. Do not change CI or branch protection as part of a test task unless the user asks for it.

## Report

Keep the report short and use this structure:

1. **Scope and risk:** what changed, the risk level and the reason.
2. **Contracts checked:** files and IDs (for example KAN-AUTH-003, DEC-SCHED-04) with their current statuses, and open questions.
3. **Scenarios:** the behavior map, or the rows that you added or changed.
4. **Detection evidence:** fail before and pass after, or mutants with status and cause. Write "not run" where you did not run it.
5. **Commands and results:** paste each command line exactly as you ran it (not a label such as "calendar tests"), then PASS, FAIL, BLOCKED or NOT RUN and the counts, for the state `git rev-parse HEAD` plus a note about uncommitted changes. Check every number and quotation in the report against the output you saw. Example line: `` `pnpm --filter @kaneo/api exec vitest run --config vitest.config.ts ../../tests/api/utils/validate-dates.test.ts` → FAIL (1 failed, 11 passed), HEAD 626f426 + uncommitted changes ``.
6. **Gaps:** skipped checks, flaky results, blockers and remaining risks.

Typecheck and lint are not behavior tests. A local pass is not a CI pass. A planned test is not an executed test. A green suite does not prove that the application is correct.
