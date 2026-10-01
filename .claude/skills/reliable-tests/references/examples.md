# Kaneo examples

Each example was run at commit `626f426` with Node 24.19.0, Vitest 5.0.1 and PostgreSQL 16.14. The test code was run in a scratch worktree and is not part of the repository's test suites. Copy the patterns, not the claims: check them again on the current commit.

Contents: [Behavior map](#behavior-map) · [Independent oracle](#independent-oracle) · [Refusal with a positive control](#refusal-with-a-positive-control) · [Rollback after a failure](#rollback-after-a-failure) · [Time-zone probe](#time-zone-probe) · [Characterization test](#characterization-test) · [Report](#report)

## Behavior map

Change: implement the API part of DEC-SCHED-04 (reject a working-days mask `0`). Sources: `docs/agent-guide/project-decisions.md` (DEC-SCHED-04), `docs/agent-guide/invariants.md` (KAN-SCHED-004, `partial`), `docs/agent-guide/scheduling.md`. Route: `PUT /api/calendar/{workspaceId}` with `{ "workingDays": n }`, permission `workspace:manage_settings`; the MCP tool `update_workspace_working_days` sends the same request and has its own Zod schema.

| Rule and source | Scenario | Expected result and state | Wrong implementation it catches |
| --- | --- | --- | --- |
| DEC-SCHED-04: reject `0` on new writes | admin sends `0` | 400; stored mask unchanged; no `workspace.calendar.working_days_updated` event | schema still `min(0)` |
| DEC-SCHED-04: one working day of the week is enough (`scheduling.md` calls each of the seven mask bits a weekday) | admin sends `1` (Sunday only) | 200; stored `1` | rule written as "at least one of Monday-Friday", or `min(2)` |
| existing schema limit | admin sends `127`, then `128` | 200 and stored; then 400 and unchanged | upper bound changed while editing the lower one |
| alternative input | MCP tool with `0` | refused; tool schema states the same limit | tool keeps `min(0)` and shows a confusing API error |
| DEC-SCHED-04: no silent rewrite | a workspace stored with `0` before the change | still `0` after reads and unrelated writes | migration or read path rewrites `0` to `62` |
| DEC-SCHED-04: correction path | — | **open question for the user**: the decision asks for an explicit path but does not define it | — |

The last row is not a test. It records a decision that the agent must not make alone.

## Independent oracle

Circular: the expected count comes from `isWorkingDay`, which `makeWorkingDayIndexer` itself uses. If `isWorkingDay` reads the wrong bit, both sides agree and the test stays green.

```ts
let expected = 0;
for (let k = 0; k < d; k++) if (isWorkingDay(day(k), 62, new Set())) expected++;
expect(index(day(d))).toBe(expected);
```

Independent: hand-checked calendar facts plus a metamorphic relation that counts the mask bits in a different way. This passes with `TZ=UTC`, `TZ=Europe/Warsaw` and `TZ=America/New_York`; the second test spans the end of daylight saving time in Europe.

```ts
import { makeWorkingDayIndexer } from "./gantt-working-calendar";

it("counts working days from hand-checked calendar facts", () => {
  // January 2026: Thu 1, Fri 2, Sat 3, Sun 4, Mon 5. Mask 62 = Monday..Friday.
  const index = makeWorkingDayIndexer(new Date(2026, 0, 1), 62, new Set());
  expect(index(new Date(2026, 0, 5))).toBe(2);
  expect(index(new Date(2026, 0, 12))).toBe(7);
});

it("adds one week's working weekdays per week, for every mask", () => {
  for (let mask = 0; mask < 128; mask++) {
    const index = makeWorkingDayIndexer(new Date(2026, 0, 1), mask, new Set());
    const weekdays = [...mask.toString(2)].filter((bit) => bit === "1").length;
    // 19 -> 26 October 2026 crosses the end of daylight saving time in Europe.
    expect(index(new Date(2026, 9, 26)) - index(new Date(2026, 9, 19)), `mask ${mask}`).toBe(weekdays);
  }
});
```

Tautologies that exist at `626f426`: `apps/web/src/components/gantt/timeline.test.ts` ("keeps Day's window at the existing 91-day constant") compares `GANTT_UNIT_WINDOW_DAYS.day` with `GANTT_WINDOW_DAYS`, which is how the production code defines it, and never asserts 91. `apps/web/src/lib/token-fingerprint.test.ts` checks that the result is stable and changes with the input, but has no known-answer value, so a different hash would also pass.

## Refusal with a positive control

Route under test: `PUT /api/task/status/{id}` (middleware `workspaceAccess.fromTask()`, then `requireWorkspacePermission({ task: ["update"] })`; the route schema declares 403 for both refusals). The file mocks only `publishEvent`; routes, middleware and PostgreSQL are real.

```ts
const publish = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../apps/api/src/events", async (original) => ({
  ...(await original<object>()),
  publishEvent: publish,
}));

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
});

function putStatus(taskId: string, status: string) {
  return createApp().app.request(`/api/task/status/${taskId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

const storedTask = (id: string) =>
  db.query.taskTable.findFirst({ where: eq(schema.taskTable.id, id) });

it("refuses an owner of another workspace without a change, then lets the owner move the task", async () => {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({ workspaceId: owner.workspace.id });
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId: project.id, title: "Private", number: 1, status: "to-do" })
    .returning();
  const outsider = await createWorkspaceMember({ role: "owner" }); // owner elsewhere

  mockAuthenticatedSession(outsider.user);
  expect((await putStatus(task.id, "done")).status).toBe(403);
  expect((await storedTask(task.id))?.status).toBe("to-do");
  expect(publish).not.toHaveBeenCalled();

  mockAuthenticatedSession(owner.user); // positive control: the request itself is valid
  expect((await putStatus(task.id, "done")).status).toBe(200);
  expect((await storedTask(task.id))?.status).toBe("done");
});

it("refuses a project viewer without task:update and keeps the status", async () => {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({ workspaceId: owner.workspace.id, members: "none" });
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId: project.id, title: "Shared", number: 1, status: "to-do" })
    .returning();
  const viewer = await addWorkspaceMember(owner.workspace.id, "viewer");
  await addProjectMember(project.id, viewer.id, "viewer");

  mockAuthenticatedSession(viewer);
  expect((await putStatus(task.id, "done")).status).toBe(403);
  expect((await storedTask(task.id))?.status).toBe("to-do");
  expect(publish).not.toHaveBeenCalled();
});
```

Mutation results (`.claude/skills/reliable-tests/scripts/mutation-probe.mjs`):

| Mutant | First test | Second test | Existing suites |
| --- | --- | --- | --- |
| remove `workspaceAccess.fromTask()` from the route | KILLED | not run | not run |
| remove `requireWorkspacePermission({ task: ["update"] })` from the route | SURVIVED | KILLED | SURVIVED the full API unit suite (930 tests) and the full API integration suite (1455 tests) |

The first test alone could not detect the second mutant: the outsider is stopped by the workspace check before the permission check runs. The survivor was a real gap (no wrong-role case), not an equivalent mutant. The second test closes it. At `626f426` no API test detects the removal of this permission check, so the gap is in the repository, not only in the example (issue #36).

## Rollback after a failure

`bulkUpdateTasks` (`updateSchedule`) validates every entry, then writes all tasks in one transaction. KAN-SCHED-003 lists rollback after a failure in the middle of the batch as not proven.

First attempt (weak): a trigger that fails when the update touches task B. The order of the writes is not specified (the task query has no `ORDER BY`), and B was written first, so nothing had been written before the failure. The test passed on the original code and also on a mutant that writes outside the transaction (`tx.update` changed to `db.update`): it proved nothing about rollback. The existing `tests/api-integration/bulk-task-schedule.test.ts` also lets that mutant survive (issue #39).

Second attempt (strong): fail the second write, whichever task it is. The test passes on the original code and kills the mutant.

```ts
it("leaves every task unchanged and publishes nothing when the second write fails", async () => {
  const { user, workspace } = await createWorkspaceMember();
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  const [a, b] = await db
    .insert(schema.taskTable)
    .values([
      { projectId: project.id, title: "A", number: 1, status: "to-do",
        startDate: new Date("2026-01-01T00:00:00.000Z"), dueDate: new Date("2026-01-05T00:00:00.000Z") },
      { projectId: project.id, title: "B", number: 2, status: "to-do",
        startDate: new Date("2026-01-06T00:00:00.000Z"), dueDate: new Date("2026-01-08T00:00:00.000Z") },
    ])
    .returning();
  if (!a || !b) throw new Error("seed failed");
  // A sequence is not transactional, so it counts writes on every connection.
  await db.execute(sql.raw("CREATE SEQUENCE skill_example_writes"));
  await db.execute(sql.raw(
    "CREATE FUNCTION fail_second_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('skill_example_writes') >= 2 THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$",
  ));
  await db.execute(sql.raw(
    "CREATE TRIGGER fail_second_write BEFORE UPDATE ON task FOR EACH ROW EXECUTE FUNCTION fail_second_write()",
  ));
  const scheduleUpdates = [
    { taskId: a.id, startDate: "2026-01-10T00:00:00.000Z", dueDate: "2026-01-15T00:00:00.000Z" },
    { taskId: b.id, startDate: "2026-01-16T00:00:00.000Z", dueDate: "2026-01-18T00:00:00.000Z" },
  ];
  const run = () =>
    bulkUpdateTasks({ taskIds: [a.id, b.id], operation: "updateSchedule", scheduleUpdates, userId: user.id });
  try {
    // Drizzle wraps the PostgreSQL error ("Failed query: ..."); the original is in `cause`.
    await expect(run()).rejects.toMatchObject({
      cause: { message: expect.stringContaining("injected failure") },
    });
    expect((await storedTask(a.id))?.startDate?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect((await storedTask(b.id))?.startDate?.toISOString()).toBe("2026-01-06T00:00:00.000Z");
    expect(publish).not.toHaveBeenCalled();
  } finally {
    await db.execute(sql.raw("DROP TRIGGER fail_second_write ON task"));
    await db.execute(sql.raw("DROP FUNCTION fail_second_write()"));
    await db.execute(sql.raw("DROP SEQUENCE skill_example_writes"));
  }
  await run(); // positive control: the same batch succeeds without the failure
  expect((await storedTask(a.id))?.startDate?.toISOString()).toBe("2026-01-10T00:00:00.000Z");
});
```

The lesson is general: a mutation probe also tests your new test. Run it before you claim that a test proves a property.

## Time-zone probe

`docs/agent-guide/scheduling.md` requires local calendar days and warns against millisecond day arithmetic across daylight-saving changes. `computeDependencyCascade` shifts dates with `addDaysExact` (milliseconds), and its tests use UTC dates, so CI (UTC) cannot see a local-day error. A metamorphic probe: the cascade result in local calendar days must be the same in every time zone.

```ts
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const key = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

it("FS lag 0: the dependent starts on the predecessor's end day in any time zone", () => {
  const shifts = computeDependencyCascade({
    movedTaskId: "a",
    edges: [{ sourceTaskId: "a", targetTaskId: "b", dependencyType: "fs", lagDays: 0 }],
    tasksById: new Map([
      ["a", { start: local(2026, 10, 19), end: local(2026, 10, 27) }],
      ["b", { start: local(2026, 10, 20), end: local(2026, 10, 21) }],
    ]),
  });
  const b = shifts.get("b");
  expect(b && key(b.start)).toBe("2026-10-27");
});
```

Result at `626f426`: PASS with `TZ=UTC` and `TZ=America/New_York`; FAIL with `TZ=Europe/Warsaw`, where the dependent starts at 2026-10-26 23:00 local time, and the Gantt route would send `toIsoDay(start)` = `2026-10-25T23:00:00.000Z` (26 October, one day before the predecessor ends). New York passes only because its DST change (1 November 2026) is outside these dates: the same probe with dates from 26 October to 3 November fails with `TZ=America/New_York`. A time-zone probe detects an error only when its dates cross that zone's DST change. This is a candidate defect from a unit-level probe (issue #37). It is not verified in a browser, and the maintainers decide the fix. If the probe passes on your commit, the behavior has changed; keep a test like it.

## Characterization test

`tests/api-integration/bulk-task-schedule.test.ts` has "ignores a scheduleUpdates entry for a task outside the requested taskIds". No contract states this rule; the controller comment describes it. If you write such a test during a refactor, name it as what it is:

```ts
it("characterization: ignores a schedule entry for a task outside taskIds", async () => {
  // Current behavior (bulk-update-tasks.ts comment), not a contract rule.
});
```

## Report

```text
Scope and risk: PUT /api/task/status/{id} permission check; high (KAN-AUTH-003, partial).
Contracts checked: docs/agent-guide/api-and-boundaries.md; KAN-AUTH-003 (partial). Open: none.
Scenarios: outsider owner -> 403, unchanged, no event; project viewer -> 403, unchanged, no event;
  owner -> 200, stored "done".
Detection evidence: mutation-probe at 626f426 + uncommitted test file:
  remove workspaceAccess.fromTask()      KILLED by the outsider test
  remove requireWorkspacePermission(...)  KILLED by the viewer test (SURVIVED the outsider test)
Commands and results (HEAD 626f426, one new untracked test file):
  pnpm exec turbo run build --filter='@kaneo/api^...'                      PASS
  DATABASE_URL=.../kaneo_test pnpm --filter @kaneo/api exec vitest run \
    --config vitest.integration.config.ts ../../tests/api-integration/<file>  PASS (3 tests)
  node .claude/skills/reliable-tests/scripts/test-change-audit.mjs          0 signals; info: 1 new test file, seen in the run
  pnpm --filter @kaneo/api typecheck                                       NOT RUN
  CI                                                                       NOT RUN (no push)
Gaps: authentication is mocked (mockAuthenticatedSession); API-key scope on this route not tested.
```
