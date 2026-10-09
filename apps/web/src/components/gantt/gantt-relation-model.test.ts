import { describe, expect, it } from "vitest";
import {
  buildExternalRelatedTasks,
  buildNeighborhoodData,
  buildOwnScheduleByTaskId,
  type ProjectTaskRelation,
} from "./gantt-relation-model";

const everyDay = () => true;
const day = (iso: string) => {
  const [year, month, date] = iso.split("-").map(Number);
  return new Date(year, month - 1, date);
};
const span = (start: string, end: string) => ({
  start: day(start),
  end: day(end),
});

type Endpoint = {
  id: string;
  title: string;
  number: number;
  projectId: string;
  projectSlug: string;
  startDate?: string | null;
  dueDate?: string | null;
  estimateMinutes?: number | null;
};

function endpoint(input: Endpoint) {
  return {
    status: "to-do",
    priority: "medium",
    projectName: input.projectSlug,
    userId: null,
    assigneeName: null,
    isMilestone: false,
    estimateMinutes: null,
    estimateUnit: "hours",
    startDate: null,
    dueDate: null,
    ...input,
  };
}

function relation(
  id: string,
  type: "blocks" | "related" | "subtask",
  source: Endpoint,
  target: Endpoint,
  dependencyType: "fs" | "ss" | "ff" | "sf" = "fs",
): ProjectTaskRelation {
  return {
    id,
    sourceTaskId: source.id,
    targetTaskId: target.id,
    relationType: type,
    dependencyType,
    lagDays: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    sourceTask: endpoint(source),
    targetTask: endpoint(target),
  } as unknown as ProjectTaskRelation;
}

const own = (
  id: string,
  number: number,
  overrides: Partial<Endpoint> = {},
): Endpoint => ({
  id,
  title: `Task ${id}`,
  number,
  projectId: "p1",
  projectSlug: "AFB",
  ...overrides,
});

// Own tasks.
const dated = own("dated", 1, {
  startDate: "2026-08-10",
  dueDate: "2026-08-14",
});
const undatedEstimated = own("undated-est", 2, { estimateMinutes: 960 });
const lateOwn = own("late", 3, {
  startDate: "2026-08-18",
  dueDate: "2026-08-20",
});
const estimatedStartOnly = own("est-start", 4, {
  startDate: "2026-08-17",
  estimateMinutes: 960,
});
const parent = own("parent", 5);
const child = own("child", 6, {
  startDate: "2026-08-03",
  dueDate: "2026-08-05",
});
// Tasks of another project.
const foreignUndated = {
  id: "foreign-undated",
  title: "Foreign undated",
  number: 9,
  projectId: "p2",
  projectSlug: "OTH",
};
const foreignDated = {
  id: "foreign-dated",
  title: "Foreign dated",
  number: 10,
  projectId: "p2",
  projectSlug: "OTH",
  startDate: "2026-09-01",
  dueDate: "2026-09-03",
};

const tasks = [
  dated,
  undatedEstimated,
  lateOwn,
  estimatedStartOnly,
  parent,
  child,
];
const relations = [
  relation("r-derived-own", "blocks", dated, undatedEstimated),
  relation("r-derived-foreign", "blocks", dated, foreignUndated),
  relation("r-violated", "blocks", foreignDated, lateOwn),
  relation("r-related", "related", lateOwn, estimatedStartOnly),
  relation("r-subtask", "subtask", parent, child),
];

function build() {
  return buildNeighborhoodData({
    tasks: tasks.map((task) => ({
      ...task,
      startDate: task.startDate ?? null,
      dueDate: task.dueDate ?? null,
      estimateMinutes: task.estimateMinutes ?? null,
    })),
    relations,
    projectId: "p1",
    projectSlug: "AFB",
    isWorkingDay: everyDay,
  });
}

describe("buildNeighborhoodData", () => {
  it("draws only blocks and related relations as edges", () => {
    expect(build().edges.map((edge) => edge.id)).toEqual([
      "r-derived-own",
      "r-derived-foreign",
      "r-violated",
      "r-related",
    ]);
  });

  it("uses own dates, the estimate span and a summary parent's rolled-up span", () => {
    const { scheduleByTaskId } = build();
    expect(scheduleByTaskId.get("dated")).toEqual(
      span("2026-08-10", "2026-08-14"),
    );
    // Start only plus a 2 day estimate.
    expect(scheduleByTaskId.get("est-start")).toEqual(
      span("2026-08-17", "2026-08-18"),
    );
    // The parent has no dates: its row is its child's span.
    expect(scheduleByTaskId.get("parent")).toEqual(
      span("2026-08-03", "2026-08-05"),
    );
  });

  it("places undated successors from their predecessor, own and cross-project", () => {
    const { scheduleByTaskId, taskInfoById } = build();
    // Finish-to-start: the day after the predecessor's end, sized by estimate.
    expect(scheduleByTaskId.get("undated-est")).toEqual(
      span("2026-08-15", "2026-08-16"),
    );
    // No estimate: a single-day marker.
    expect(scheduleByTaskId.get("foreign-undated")).toEqual(
      span("2026-08-15", "2026-08-15"),
    );
    expect(taskInfoById.get("undated-est")?.isDerived).toBe(true);
    expect(taskInfoById.get("foreign-undated")?.isDerived).toBe(true);
    expect(taskInfoById.get("dated")?.isDerived).toBeUndefined();
  });

  it("includes dated cross-project far ends, keys and projects", () => {
    const { scheduleByTaskId, taskInfoById, projectIdByTaskId } = build();
    expect(scheduleByTaskId.get("foreign-dated")).toEqual(
      span("2026-09-01", "2026-09-03"),
    );
    expect(taskInfoById.get("foreign-dated")).toMatchObject({
      key: "OTH-10",
      title: "Foreign dated",
    });
    expect(taskInfoById.get("dated")?.key).toBe("AFB-1");
    expect(projectIdByTaskId.get("foreign-dated")).toBe("p2");
    expect(projectIdByTaskId.get("dated")).toBe("p1");
  });

  it("flags a violated edge from dated tasks only", () => {
    const { violatedEdgeIds } = build();
    // The foreign predecessor ends 3 Sep; its successor starts 18 Aug.
    expect([...violatedEdgeIds]).toEqual(["r-violated"]);
  });
});

describe("buildExternalRelatedTasks", () => {
  it("does not derive a row for an own task that already has one", () => {
    const rows = buildExternalRelatedTasks({
      relations: [relation("r", "blocks", dated, lateOwn)],
      projectId: "p1",
      ownScheduleByTaskId: buildOwnScheduleByTaskId(
        [dated, lateOwn].map((task) => ({
          ...task,
          startDate: task.startDate ?? null,
          dueDate: task.dueDate ?? null,
        })),
        everyDay,
      ),
      ownRowIds: new Set(["dated", "late"]),
      blocksEdges: [
        {
          sourceTaskId: "dated",
          targetTaskId: "late",
          dependencyType: "fs",
          lagDays: 0,
        },
      ],
      isWorkingDay: everyDay,
    });
    expect(rows).toEqual([]);
  });
});
