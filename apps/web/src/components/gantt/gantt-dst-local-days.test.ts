import { format, startOfDay } from "date-fns";
import { describe, expect, it } from "vitest";
import {
  type CriticalPathEdgeInput,
  type CriticalPathTaskInput,
  computeCriticalPath,
} from "./gantt-critical-path";
import {
  type CascadeEdge,
  type CascadeSchedule,
  computeDependencyCascade,
} from "./gantt-dependency-cascade";
import { deriveUndatedSuccessorSchedules } from "./gantt-derived-schedule";
import {
  addCalendarDays,
  estimatedSpanFromAnchor,
} from "./gantt-estimated-span";

// Independent check of issues #37 and #38: the Gantt works in LOCAL calendar
// days (docs/agent-guide/scheduling.md), a finish-to-start hand-off lands on
// the day AFTER the predecessor's end day plus lag (FS_HANDOFF_DAYS = 1), and
// the route saves startOfDay(date).toISOString() (toIsoDay in
// gantt-task-bar.tsx). Every expected day below is a literal local calendar
// day worked out by hand from the 2026 calendar:
//   Warsaw DST: starts Sun 29 Mar, ends Sun 25 Oct.
//   New York DST: starts Sun 8 Mar, ends Sun 1 Nov.
//   Auckland DST: ends Sun 5 Apr, starts Sun 27 Sep.
// The cases are meaningful only in the zone whose change they cross; run them
// with `pnpm --filter @kaneo/web run test:tz`. In UTC they must pass too.

const local = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min);
const ymd = (d: Date) => format(d, "yyyy-MM-dd");
// What the route sends to the API for a shifted date.
const savedDay = (d: Date) => startOfDay(d).toISOString();
const savedAs = (y: number, m: number, d: number) =>
  local(y, m, d).toISOString();
const monFri = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5;

function edge(
  dependencyType: CascadeEdge["dependencyType"],
  lagDays = 0,
  sourceTaskId = "a",
  targetTaskId = "b",
): CascadeEdge {
  return { sourceTaskId, targetTaskId, dependencyType, lagDays };
}

function expectSavedSpan(
  actual: CascadeSchedule | undefined,
  start: [number, number, number],
  end: [number, number, number],
) {
  expect(actual).toBeDefined();
  if (!actual) return;
  expect([ymd(actual.start), ymd(actual.end)]).toEqual([
    ymd(local(...start)),
    ymd(local(...end)),
  ]);
  // The saved ISO instants are the local midnights of the expected days.
  expect([savedDay(actual.start), savedDay(actual.end)]).toEqual([
    savedAs(...start),
    savedAs(...end),
  ]);
}

type YMD = [number, number, number];

describe("cascade: forced delta and shift in local days for every dependency type", () => {
  // [label, edge, A, B, expected B]. A is the moved task.
  it.each<[string, CascadeEdge, [YMD, YMD], [YMD, YMD], [YMD, YMD]]>([
    [
      "Auckland DST end, FS: A ends Tue 7 Apr -> B on Wed 8 Apr",
      edge("fs"),
      [
        [2026, 4, 1],
        [2026, 4, 7],
      ],
      [
        [2026, 4, 2],
        [2026, 4, 3],
      ],
      [
        [2026, 4, 8],
        [2026, 4, 9],
      ],
    ],
    [
      "Auckland DST start, FS: A ends Tue 29 Sep -> B on Wed 30 Sep",
      edge("fs"),
      [
        [2026, 9, 21],
        [2026, 9, 29],
      ],
      [
        [2026, 9, 22],
        [2026, 9, 23],
      ],
      [
        [2026, 9, 30],
        [2026, 10, 1],
      ],
    ],
    [
      "Warsaw DST end, SF: A starts Mon 26 Oct -> B must end on Mon 26 Oct",
      edge("sf"),
      [
        [2026, 10, 26],
        [2026, 10, 30],
      ],
      [
        [2026, 10, 20],
        [2026, 10, 22],
      ],
      [
        [2026, 10, 24],
        [2026, 10, 26],
      ],
    ],
    [
      "Warsaw DST end, FS with lead -2: A ends Tue 27 Oct -> B starts Mon 26 Oct",
      edge("fs", -2),
      [
        [2026, 10, 19],
        [2026, 10, 27],
      ],
      [
        [2026, 10, 20],
        [2026, 10, 21],
      ],
      [
        [2026, 10, 26],
        [2026, 10, 27],
      ],
    ],
    [
      "New York DST end, FF with lead -1: A ends Tue 3 Nov -> B ends Mon 2 Nov",
      edge("ff", -1),
      [
        [2026, 10, 26],
        [2026, 11, 3],
      ],
      [
        [2026, 10, 27],
        [2026, 10, 28],
      ],
      [
        [2026, 11, 1],
        [2026, 11, 2],
      ],
    ],
    [
      "New York DST end, SS with lag 5: A starts Wed 28 Oct -> B starts Mon 2 Nov",
      edge("ss", 5),
      [
        [2026, 10, 28],
        [2026, 11, 5],
      ],
      [
        [2026, 10, 27],
        [2026, 10, 29],
      ],
      [
        [2026, 11, 2],
        [2026, 11, 4],
      ],
    ],
    [
      "Warsaw DST end, boundary: A ends Sun 25 Oct (the 25-hour day) -> B (25-26 Oct) moves one day",
      edge("fs"),
      [
        [2026, 10, 19],
        [2026, 10, 25],
      ],
      [
        [2026, 10, 25],
        [2026, 10, 26],
      ],
      [
        [2026, 10, 26],
        [2026, 10, 27],
      ],
    ],
  ])("%s", (_label, e, [aStart, aEnd], [bStart, bEnd], [expStart, expEnd]) => {
    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: [e],
      tasksById: new Map([
        ["a", { start: local(...aStart), end: local(...aEnd) }],
        ["b", { start: local(...bStart), end: local(...bEnd) }],
      ]),
    });

    expectSavedSpan(shifts.get("b"), expStart, expEnd);
  });

  it("does not shift an already satisfied dependent across the DST change (A ends Sat 24 Oct, B starts Sun 25 Oct)", () => {
    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      tasksById: new Map([
        ["a", { start: local(2026, 10, 19), end: local(2026, 10, 24) }],
        ["b", { start: local(2026, 10, 25), end: local(2026, 10, 26) }],
      ]),
    });

    expect(shifts.size).toBe(0);
  });

  it("does not shift when a lead exactly satisfies the edge across the DST change", () => {
    // A ends Fri 23 Oct, lead -3: B may start on 23 + 1 - 3 = Wed 21 Oct.
    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs", -3)],
      tasksById: new Map([
        ["a", { start: local(2026, 10, 19), end: local(2026, 10, 23) }],
        ["b", { start: local(2026, 10, 21), end: local(2026, 10, 22) }],
      ]),
    });

    expect(shifts.size).toBe(0);
  });
});

describe("cascade: working-day nudge and estimates over a DST change", () => {
  it("Auckland DST end: Saturday 4 Apr is nudged over Sunday 5 Apr to Monday 6 Apr", () => {
    // A ends Fri 3 Apr; B (Tue 31 Mar - Wed 1 Apr) starts Sat 4 Apr, nudged by
    // 2 days: Mon 6 - Tue 7 Apr.
    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      isWorkingDay: monFri,
      tasksById: new Map([
        ["a", { start: local(2026, 3, 30), end: local(2026, 4, 3) }],
        ["b", { start: local(2026, 3, 31), end: local(2026, 4, 1) }],
      ]),
    });

    expectSavedSpan(shifts.get("b"), [2026, 4, 6], [2026, 4, 7]);
  });

  it("Auckland DST start: Saturday 26 Sep is nudged over Sunday 27 Sep to Monday 28 Sep", () => {
    // A ends Fri 25 Sep; B (Tue 22 - Wed 23 Sep) starts Sat 26 Sep -> Mon 28 -
    // Tue 29 Sep.
    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      isWorkingDay: monFri,
      tasksById: new Map([
        ["a", { start: local(2026, 9, 21), end: local(2026, 9, 25) }],
        ["b", { start: local(2026, 9, 22), end: local(2026, 9, 23) }],
      ]),
    });

    expectSavedSpan(shifts.get("b"), [2026, 9, 28], [2026, 9, 29]);
  });

  it("a holiday on Monday 26 Oct pushes the Warsaw nudge to Tuesday 27 Oct", () => {
    const isWorkingDay = (d: Date) => monFri(d) && ymd(d) !== "2026-10-26";
    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      isWorkingDay,
      tasksById: new Map([
        ["a", { start: local(2026, 10, 19), end: local(2026, 10, 23) }],
        ["b", { start: local(2026, 10, 20), end: local(2026, 10, 21) }],
      ]),
    });

    // Start Sat 24 -> Sun 25 -> Mon 26 (holiday) -> Tue 27; end 21 + 4 + 3.
    expectSavedSpan(shifts.get("b"), [2026, 10, 27], [2026, 10, 28]);
  });

  it("due-only estimated dependent: the walk-forward over the Warsaw DST end keeps the span on or after the forced start", () => {
    // B moves to Mon 26 - Tue 27 Oct. A 3-working-day estimate anchored on the
    // due date Tue 27 would start Fri 23 Oct (Tue, Mon, Fri), before the forced
    // start; the due date walks to Wed 28 Oct, which starts Mon 26 Oct.
    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      isWorkingDay: monFri,
      tasksById: new Map([
        ["a", { start: local(2026, 10, 19), end: local(2026, 10, 23) }],
        ["b", { start: local(2026, 10, 20), end: local(2026, 10, 21) }],
      ]),
      estimatedTasks: new Map([
        ["b", { anchor: "due", estimateMinutes: 1440 }],
      ]),
    });

    expectSavedSpan(shifts.get("b"), [2026, 10, 26], [2026, 10, 28]);
  });
});

describe("cascade: repeated shifts across a DST change", () => {
  // Each step saves the result (startOfDay ISO) and reloads it, as after a
  // refetch, before the next drag.
  const reload = (s: CascadeSchedule): CascadeSchedule => ({
    start: new Date(savedDay(s.start)),
    end: new Date(savedDay(s.end)),
  });

  it.each<[string, YMD, YMD, YMD, YMD, YMD, YMD, YMD, YMD, YMD, YMD]>([
    [
      "Warsaw",
      [2026, 10, 19],
      [2026, 10, 27],
      [2026, 10, 20],
      [2026, 10, 21],
      [2026, 10, 28],
      [2026, 10, 29],
      [2026, 11, 5],
      [2026, 11, 6],
      [2026, 11, 7],
      [2026, 11, 7],
    ],
    [
      "New York",
      [2026, 10, 26],
      [2026, 11, 3],
      [2026, 10, 27],
      [2026, 10, 28],
      [2026, 11, 4],
      [2026, 11, 5],
      [2026, 11, 10],
      [2026, 11, 11],
      [2026, 11, 12],
      [2026, 11, 12],
    ],
  ])(
    "%s: a second cascade starts from the saved first result",
    (_zone, aStart, aEnd1, bStart, bEnd, exp1Start, exp1End, aEnd2, exp2Start, exp2End) => {
      const first = computeDependencyCascade({
        movedTaskId: "a",
        edges: [edge("fs")],
        tasksById: new Map([
          ["a", { start: local(...aStart), end: local(...aEnd1) }],
          ["b", { start: local(...bStart), end: local(...bEnd) }],
        ]),
      });
      const b1 = first.get("b");
      expectSavedSpan(b1, exp1Start, exp1End);
      if (!b1) return;

      const second = computeDependencyCascade({
        movedTaskId: "a",
        edges: [edge("fs")],
        tasksById: new Map([
          ["a", { start: local(...aStart), end: local(...aEnd2) }],
          ["b", reload(b1)],
        ]),
      });

      expectSavedSpan(second.get("b"), exp2Start, exp2End);
    },
  );
});

describe("cascade: inputs that are not local midnight (API instants)", () => {
  it("FS is measured in local calendar days: A ending 23:30 and B starting 00:30 the next day is already satisfied", () => {
    // FS hand-off is the DAY AFTER the predecessor's end day (not 24 hours).
    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      tasksById: new Map([
        ["a", { start: local(2026, 10, 22), end: local(2026, 10, 26, 23, 30) }],
        [
          "b",
          {
            start: local(2026, 10, 27, 0, 30),
            end: local(2026, 10, 28, 0, 30),
          },
        ],
      ]),
    });

    expect(shifts.size).toBe(0);
  });

  it("FS violation of one calendar day is found even when the clock times are 1 hour apart", () => {
    // A ends Tue 27 Oct 00:30, so B must start on Wed 28 Oct. B starts Tue 27
    // Oct 23:30: one calendar day early, 25 minutes of the clock before A's
    // end plus a day.
    const shifts = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      tasksById: new Map([
        ["a", { start: local(2026, 10, 22), end: local(2026, 10, 27, 0, 30) }],
        [
          "b",
          {
            start: local(2026, 10, 27, 23, 30),
            end: local(2026, 10, 28, 23, 30),
          },
        ],
      ]),
    });

    const b = shifts.get("b");
    expect(b && [ymd(b.start), ymd(b.end)]).toEqual([
      "2026-10-28",
      "2026-10-29",
    ]);
    expect(b && [savedDay(b.start), savedDay(b.end)]).toEqual([
      savedAs(2026, 10, 28),
      savedAs(2026, 10, 29),
    ]);
  });

  it.each([0, 1, 2, 3, 12, 23])(
    "the shifted days do not depend on the clock time (%i:30) over the Warsaw and New York DST ends",
    (hour) => {
      const w = computeDependencyCascade({
        movedTaskId: "a",
        edges: [edge("fs")],
        tasksById: new Map([
          [
            "a",
            {
              start: local(2026, 10, 19, hour, 30),
              end: local(2026, 10, 27, hour, 30),
            },
          ],
          [
            "b",
            {
              start: local(2026, 10, 20, hour, 30),
              end: local(2026, 10, 21, hour, 30),
            },
          ],
        ]),
      });
      const wb = w.get("b");
      expect(wb && [savedDay(wb.start), savedDay(wb.end)]).toEqual([
        savedAs(2026, 10, 28),
        savedAs(2026, 10, 29),
      ]);

      const n = computeDependencyCascade({
        movedTaskId: "a",
        edges: [edge("fs")],
        tasksById: new Map([
          [
            "a",
            {
              start: local(2026, 10, 26, hour, 30),
              end: local(2026, 11, 3, hour, 30),
            },
          ],
          [
            "b",
            {
              start: local(2026, 10, 27, hour, 30),
              end: local(2026, 10, 28, hour, 30),
            },
          ],
        ]),
      });
      const nb = n.get("b");
      expect(nb && [savedDay(nb.start), savedDay(nb.end)]).toEqual([
        savedAs(2026, 11, 4),
        savedAs(2026, 11, 5),
      ]);
    },
  );

  it("a 02:30 start that lands on the spring-forward day (a time that does not exist there) still saves that day", () => {
    // Warsaw 29 Mar and New York 8 Mar have no 02:30. B moves onto that day.
    const warsaw = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      tasksById: new Map([
        ["a", { start: local(2026, 3, 23), end: local(2026, 3, 28) }],
        [
          "b",
          { start: local(2026, 3, 24, 2, 30), end: local(2026, 3, 25, 2, 30) },
        ],
      ]),
    });
    const wb = warsaw.get("b");
    expect(wb && [ymd(wb.start), ymd(wb.end)]).toEqual([
      "2026-03-29",
      "2026-03-30",
    ]);

    const newYork = computeDependencyCascade({
      movedTaskId: "a",
      edges: [edge("fs")],
      tasksById: new Map([
        ["a", { start: local(2026, 3, 2), end: local(2026, 3, 7) }],
        [
          "b",
          { start: local(2026, 3, 3, 2, 30), end: local(2026, 3, 4, 2, 30) },
        ],
      ]),
    });
    const nb = newYork.get("b");
    expect(nb && [ymd(nb.start), ymd(nb.end)]).toEqual([
      "2026-03-08",
      "2026-03-09",
    ]);
  });
});

describe("derived schedule: every dependency type over a DST change (local days)", () => {
  const ymdh = (d: Date) => `${ymd(d)} ${d.getHours()}h`;
  const place = (
    pred: [YMD, YMD],
    type: CascadeEdge["dependencyType"],
    lagDays: number,
  ) => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge(type, lagDays, "a", "b")],
      datedScheduleById: new Map([
        ["a", { start: local(...pred[0]), end: local(...pred[1]) }],
      ]),
      undatedCandidateIds: ["b"],
    });
    const b = derived.get("b");
    return b && [ymdh(b.start), ymdh(b.end)];
  };

  it.each<[string, [YMD, YMD], CascadeEdge["dependencyType"], number, string]>([
    // Warsaw: A Tue 20 - Fri 23 Oct (end), the change is on Sun 25 Oct.
    [
      "Warsaw FS lag 5: 23 + 1 + 5",
      [
        [2026, 10, 20],
        [2026, 10, 23],
      ],
      "fs",
      5,
      "2026-10-29",
    ],
    [
      "Warsaw SS lag 6: 20 + 6",
      [
        [2026, 10, 20],
        [2026, 10, 23],
      ],
      "ss",
      6,
      "2026-10-26",
    ],
    [
      "Warsaw FF lag 4: 23 + 4",
      [
        [2026, 10, 20],
        [2026, 10, 23],
      ],
      "ff",
      4,
      "2026-10-27",
    ],
    [
      "Warsaw SF lag 7: 20 + 7",
      [
        [2026, 10, 20],
        [2026, 10, 23],
      ],
      "sf",
      7,
      "2026-10-27",
    ],
    // Backwards over the change: A Wed 28 Oct - Mon 2 Nov, FS lead -10.
    [
      "Warsaw FS lead -10: 2 Nov + 1 - 10",
      [
        [2026, 10, 28],
        [2026, 11, 2],
      ],
      "fs",
      -10,
      "2026-10-24",
    ],
    // New York: change on Sun 1 Nov.
    [
      "New York FS lag 4: 30 Oct + 1 + 4",
      [
        [2026, 10, 27],
        [2026, 10, 30],
      ],
      "fs",
      4,
      "2026-11-04",
    ],
    // Auckland: change on Sun 5 Apr (end) and Sun 27 Sep (start).
    [
      "Auckland FS lag 4 over DST end: 3 Apr + 1 + 4",
      [
        [2026, 4, 1],
        [2026, 4, 3],
      ],
      "fs",
      4,
      "2026-04-08",
    ],
    [
      "Auckland FS lag 4 over DST start: 25 Sep + 1 + 4",
      [
        [2026, 9, 22],
        [2026, 9, 25],
      ],
      "fs",
      4,
      "2026-09-30",
    ],
  ])("%s", (_label, pred, type, lag, expectedDay) => {
    expect(place(pred, type, lag)).toEqual([
      `${expectedDay} 0h`,
      `${expectedDay} 0h`,
    ]);
  });

  it("an estimated FS successor spans calendar days over the Warsaw DST end (3 days from Sat 24 Oct)", () => {
    const derived = deriveUndatedSuccessorSchedules({
      edges: [edge("fs", 0, "a", "b")],
      datedScheduleById: new Map([
        ["a", { start: local(2026, 10, 19), end: local(2026, 10, 23) }],
      ]),
      undatedCandidateIds: ["b"],
      estimateMinutesById: new Map([["b", 1440]]),
    });

    const b = derived.get("b");
    expect(b && [ymdh(b.start), ymdh(b.end)]).toEqual([
      "2026-10-24 0h",
      "2026-10-26 0h",
    ]);
  });
});

describe("estimated-span helpers over a DST change (local days)", () => {
  it.each<[string, YMD, number, string]>([
    ["Warsaw end, +3 from Sat 24 Oct", [2026, 10, 24], 3, "2026-10-27"],
    ["Warsaw end, -3 from Tue 27 Oct", [2026, 10, 27], -3, "2026-10-24"],
    ["New York end, +4 from Fri 30 Oct", [2026, 10, 30], 4, "2026-11-03"],
    ["Auckland end, +3 from Sat 4 Apr", [2026, 4, 4], 3, "2026-04-07"],
    ["Auckland start, +3 from Sat 26 Sep", [2026, 9, 26], 3, "2026-09-29"],
  ])("addCalendarDays %s", (_label, from, days, expected) => {
    const result = addCalendarDays(local(...from), days);
    expect([ymd(result), result.getHours()]).toEqual([expected, 0]);
  });

  it("addCalendarDays keeps the local calendar day for a midday instant over the Auckland DST end", () => {
    expect(ymd(addCalendarDays(local(2026, 4, 4, 12, 0), 3))).toBe(
      "2026-04-07",
    );
  });

  it("start-anchored and due-anchored 3-day estimates cover the Warsaw DST end", () => {
    const fromStart = estimatedSpanFromAnchor(
      "start",
      local(2026, 10, 24),
      1440,
      undefined,
    );
    expect([ymd(fromStart.start), ymd(fromStart.end)]).toEqual([
      "2026-10-24",
      "2026-10-26",
    ]);
    const fromDue = estimatedSpanFromAnchor(
      "due",
      local(2026, 10, 26),
      1440,
      undefined,
    );
    expect([ymd(fromDue.start), ymd(fromDue.end)]).toEqual([
      "2026-10-24",
      "2026-10-26",
    ]);
  });
});

describe("critical path: slack in local days over each DST change", () => {
  const blocksEdge = (
    id: string,
    sourceTaskId: string,
    targetTaskId: string,
  ): CriticalPathEdgeInput => ({
    id,
    sourceTaskId,
    targetTaskId,
    dependencyType: "fs",
    lagDays: 0,
  });
  const t = (id: string, s: YMD, e: YMD): CriticalPathTaskInput => ({
    id,
    scheduleStart: local(...s),
    scheduleEnd: local(...e),
  });

  // A -> B is tight (B starts the day after A ends). C starts one day later
  // than A -> C requires, so C has exactly one day of slack and is not
  // critical (a sink's slack is its scheduled position minus its earliest).
  it.each<[string, YMD, YMD, YMD, YMD, YMD, YMD]>([
    [
      "Warsaw DST end",
      [2026, 10, 22],
      [2026, 10, 25],
      [2026, 10, 26],
      [2026, 10, 28],
      [2026, 10, 27],
      [2026, 10, 28],
    ],
    [
      "New York DST end",
      [2026, 10, 29],
      [2026, 11, 1],
      [2026, 11, 2],
      [2026, 11, 4],
      [2026, 11, 3],
      [2026, 11, 4],
    ],
    [
      "Auckland DST end",
      [2026, 4, 1],
      [2026, 4, 5],
      [2026, 4, 6],
      [2026, 4, 8],
      [2026, 4, 7],
      [2026, 4, 8],
    ],
    [
      "Auckland DST start",
      [2026, 9, 24],
      [2026, 9, 27],
      [2026, 9, 28],
      [2026, 9, 30],
      [2026, 9, 29],
      [2026, 9, 30],
    ],
    [
      "Warsaw DST start",
      [2026, 3, 26],
      [2026, 3, 29],
      [2026, 3, 30],
      [2026, 4, 1],
      [2026, 3, 31],
      [2026, 4, 1],
    ],
    [
      "New York DST start",
      [2026, 3, 5],
      [2026, 3, 8],
      [2026, 3, 9],
      [2026, 3, 11],
      [2026, 3, 10],
      [2026, 3, 11],
    ],
  ])(
    "%s: the branch with a free day is not critical",
    (_label, as, ae, bs, be, cs, ce) => {
      const result = computeCriticalPath(
        [t("a", as, ae), t("b", bs, be), t("c", cs, ce)],
        [blocksEdge("e1", "a", "b"), blocksEdge("e2", "a", "c")],
      );

      expect([...result.criticalTaskIds].sort()).toEqual(["a", "b"]);
      expect([...result.criticalEdgeIds]).toEqual(["e1"]);
    },
  );

  it("a one-day gap over the DST end is slack, not tight (Warsaw, New York, Auckland)", () => {
    // A -> B with a free day between them, and a parallel tight chain
    // A -> C -> D that makes the project longer than A -> B.
    const cases: [YMD, YMD, YMD, YMD, YMD, YMD, YMD, YMD][] = [
      [
        [2026, 10, 22],
        [2026, 10, 24],
        [2026, 10, 26],
        [2026, 10, 26],
        [2026, 10, 25],
        [2026, 10, 25],
        [2026, 10, 26],
        [2026, 10, 28],
      ],
      [
        [2026, 10, 29],
        [2026, 10, 31],
        [2026, 11, 2],
        [2026, 11, 2],
        [2026, 11, 1],
        [2026, 11, 1],
        [2026, 11, 2],
        [2026, 11, 4],
      ],
      [
        [2026, 4, 1],
        [2026, 4, 3],
        [2026, 4, 5],
        [2026, 4, 5],
        [2026, 4, 4],
        [2026, 4, 4],
        [2026, 4, 5],
        [2026, 4, 7],
      ],
    ];
    for (const [as, ae, bs, be, cs, ce, ds, de] of cases) {
      const result = computeCriticalPath(
        [t("a", as, ae), t("b", bs, be), t("c", cs, ce), t("d", ds, de)],
        [
          blocksEdge("ab", "a", "b"),
          blocksEdge("ac", "a", "c"),
          blocksEdge("cd", "c", "d"),
        ],
      );
      expect([...result.criticalTaskIds].sort(), ymd(local(...as))).toEqual([
        "a",
        "c",
        "d",
      ]);
      expect([...result.criticalEdgeIds].sort()).toEqual(["ac", "cd"]);
    }
  });

  it("clock times inside the day do not change the local-day result (tight chain and slack branch)", () => {
    // A ends 23:30 on Mon 26 Oct and B starts 00:30 on Tue 27 Oct: tight in
    // calendar days. C starts Wed 28 Oct 06:00, one calendar day after the
    // earliest day A -> C allows (Tue 27 Oct), so it has one day of slack.
    const result = computeCriticalPath(
      [
        {
          id: "a",
          scheduleStart: local(2026, 10, 22, 9, 0),
          scheduleEnd: local(2026, 10, 26, 23, 30),
        },
        {
          id: "b",
          scheduleStart: local(2026, 10, 27, 0, 30),
          scheduleEnd: local(2026, 10, 29, 18, 0),
        },
        {
          id: "c",
          scheduleStart: local(2026, 10, 28, 6, 0),
          scheduleEnd: local(2026, 10, 29, 6, 0),
        },
      ],
      [blocksEdge("e1", "a", "b"), blocksEdge("e2", "a", "c")],
    );

    expect([...result.criticalTaskIds].sort()).toEqual(["a", "b"]);
    expect([...result.criticalEdgeIds]).toEqual(["e1"]);
  });
});
