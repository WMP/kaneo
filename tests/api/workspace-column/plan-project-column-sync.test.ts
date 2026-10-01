import { describe, expect, it } from "vitest";
import {
  ColumnSyncPlanError,
  isNoopPlan,
  type ProjectColumnData,
  planProjectColumnSync,
  type WorkspaceColumnData,
} from "../../../apps/api/src/workspace-column/sync-plan";

function workspaceColumn(
  id: string,
  name: string,
  position: number,
  overrides: Partial<WorkspaceColumnData> = {},
): WorkspaceColumnData {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    position,
    icon: null,
    color: null,
    isFinal: false,
    ...overrides,
  };
}

function projectColumn(
  id: string,
  name: string,
  position: number,
  overrides: Partial<ProjectColumnData> = {},
): ProjectColumnData {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    position,
    icon: null,
    color: null,
    isFinal: false,
    workspaceColumnId: null,
    ...overrides,
  };
}

const backlog = workspaceColumn("w-backlog", "Backlog", 0);
const doing = workspaceColumn("w-doing", "Doing", 1);
const done = workspaceColumn("w-done", "Done", 2, { isFinal: true });

describe("planProjectColumnSync", () => {
  it("matches a project column by its link before anything else", () => {
    const plan = planProjectColumnSync(
      [
        // Same slug as the workspace column, but linked to another one.
        projectColumn("p-1", "Backlog", 0, { workspaceColumnId: "w-doing" }),
        projectColumn("p-2", "Whatever", 1, { workspaceColumnId: "w-backlog" }),
      ],
      [backlog, doing],
    );

    const byWorkspace = Object.fromEntries(
      plan.matches.map((m) => [m.workspaceColumn.id, m]),
    );
    expect(byWorkspace["w-backlog"]).toMatchObject({
      projectColumnId: "p-2",
      matchedBy: "link",
      changed: true,
    });
    expect(byWorkspace["w-doing"]).toMatchObject({
      projectColumnId: "p-1",
      matchedBy: "link",
    });
    expect(plan.create).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("falls back to the same slug, then to toSlug(name)", () => {
    const plan = planProjectColumnSync(
      [
        projectColumn("p-1", "Backlog", 0),
        // Name slugifies to "doing" although the stored slug differs.
        projectColumn("p-2", "  DOING! ", 1, { slug: "legacy-doing" }),
      ],
      [backlog, doing],
    );

    expect(plan.matches).toHaveLength(2);
    expect(plan.matches[0]).toMatchObject({
      projectColumnId: "p-1",
      matchedBy: "slug",
    });
    expect(plan.matches[1]).toMatchObject({
      projectColumnId: "p-2",
      matchedBy: "name",
      changed: true,
      previous: { slug: "legacy-doing" },
    });
  });

  it("lets a slug match win over a name match of another workspace column", () => {
    // "Doing" slugifies to the slug of w-doing, but the column with the slug
    // "doing" also exists: the slug match is taken first.
    const plan = planProjectColumnSync(
      [
        projectColumn("p-name", "Doing", 0, { slug: "x" }),
        projectColumn("p-slug", "Something else", 1, { slug: "doing" }),
      ],
      [doing],
    );

    expect(plan.matches).toHaveLength(1);
    expect(plan.matches[0]).toMatchObject({
      projectColumnId: "p-slug",
      matchedBy: "slug",
    });
    expect(plan.remove.map((c) => c.id)).toEqual(["p-name"]);
  });

  it("uses a project column at most once and prefers the lowest position", () => {
    const plan = planProjectColumnSync(
      [
        projectColumn("p-late", "Backlog", 5),
        projectColumn("p-early", "Backlog", 1),
      ],
      [backlog],
    );

    expect(plan.matches[0]?.projectColumnId).toBe("p-early");
    expect(plan.remove.map((c) => c.id)).toEqual(["p-late"]);
  });

  it("creates workspace columns without a match and removes the rest", () => {
    const plan = planProjectColumnSync(
      [projectColumn("p-1", "Backlog", 0), projectColumn("p-2", "Review", 1)],
      [backlog, doing, done],
    );

    expect(plan.matches.map((m) => m.workspaceColumn.id)).toEqual([
      "w-backlog",
    ]);
    expect(plan.create.map((c) => c.id)).toEqual(["w-doing", "w-done"]);
    expect(plan.remove.map((c) => c.id)).toEqual(["p-2"]);
  });

  it("defaults the fallback to the first column by position", () => {
    const plan = planProjectColumnSync([], [done, doing, backlog]);
    expect(plan.fallbackWorkspaceColumnId).toBe("w-backlog");
    expect(plan.create.map((c) => c.id)).toEqual([
      "w-backlog",
      "w-doing",
      "w-done",
    ]);
  });

  it("uses the requested fallback column", () => {
    const plan = planProjectColumnSync([], [backlog, doing, done], "w-done");
    expect(plan.fallbackWorkspaceColumnId).toBe("w-done");
  });

  it("rejects an unknown fallback and an empty workspace", () => {
    expect(() => planProjectColumnSync([], [backlog], "nope")).toThrow(
      expect.objectContaining({ code: "UNKNOWN_FALLBACK" }),
    );
    expect(() => planProjectColumnSync([], [])).toThrow(ColumnSyncPlanError);
    expect(() => planProjectColumnSync([], [])).toThrow(
      expect.objectContaining({ code: "EMPTY_WORKSPACE" }),
    );
  });

  it("marks a match unchanged only when every field equals the workspace column", () => {
    const same = planProjectColumnSync(
      [
        projectColumn("p-1", "Backlog", 0, { workspaceColumnId: "w-backlog" }),
        projectColumn("p-2", "Doing", 1, { workspaceColumnId: "w-doing" }),
        projectColumn("p-3", "Done", 2, {
          workspaceColumnId: "w-done",
          isFinal: true,
        }),
      ],
      [backlog, doing, done],
    );
    expect(same.matches.every((m) => !m.changed)).toBe(true);
    expect(isNoopPlan(same)).toBe(true);

    const drift = planProjectColumnSync(
      [
        projectColumn("p-1", "Backlog", 0, {
          workspaceColumnId: "w-backlog",
          color: "red",
        }),
      ],
      [backlog],
    );
    expect(drift.matches[0]?.changed).toBe(true);
    expect(isNoopPlan(drift)).toBe(false);

    // Matched by slug only (no link yet) still counts as a change: the link is
    // written.
    const unlinked = planProjectColumnSync(
      [projectColumn("p-1", "Backlog", 0)],
      [backlog],
    );
    expect(unlinked.matches[0]?.changed).toBe(true);
  });

  it("is deterministic regardless of the input order", () => {
    const projectColumns = [
      projectColumn("p-2", "Review", 1),
      projectColumn("p-1", "Backlog", 0),
      projectColumn("p-3", "Done", 2),
    ];
    const a = planProjectColumnSync(projectColumns, [done, backlog, doing]);
    const b = planProjectColumnSync([...projectColumns].reverse(), [
      doing,
      backlog,
      done,
    ]);
    expect(a).toEqual(b);
  });
});
