import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import getWorkspaceWorkload from "../../apps/api/src/workload/controllers/get-workspace-workload";
import getWorkspaceWorkloadTasks from "../../apps/api/src/workload/controllers/get-workspace-workload-tasks";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(resetTestDatabase);

describe("workload: rows for people outside the member list", () => {
  it("lists a person resource without tasks with zero counts, and keeps a former member that still has a task", async () => {
    const owner = await createWorkspaceMember({
      role: "owner",
      userName: "Owner",
    });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const [resource] = await db
      .insert(schema.resourceTable)
      .values({
        workspaceId: owner.workspace.id,
        kind: "person",
        name: "Zed Resource",
      })
      .returning();
    await db.insert(schema.resourceTable).values({
      workspaceId: owner.workspace.id,
      kind: "equipment",
      name: "Drill",
    });
    const [former] = await db
      .insert(schema.userTable)
      .values({
        id: "former-user",
        email: "former@example.com",
        emailVerified: true,
        name: "Former Member",
      })
      .returning();
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Left behind",
        number: 1,
        status: "to-do",
        startDate: new Date("2026-03-02T00:00:00.000Z"),
        dueDate: new Date("2026-03-04T00:00:00.000Z"),
      })
      .returning();
    await db
      .insert(schema.taskAssignmentTable)
      .values({ taskId: task.id, userId: former.id, units: 100 });

    const result = await getWorkspaceWorkload({
      workspaceId: owner.workspace.id,
      from: new Date("2026-03-02T00:00:00.000Z"),
      to: new Date("2026-03-15T00:00:00.000Z"),
      userId: owner.user.id,
    });

    const byName = new Map(result.assignees.map((a) => [a.name, a]));
    // Equipment never counts as capacity.
    expect([...byName.keys()].sort()).toEqual([
      "Former Member",
      "Owner",
      "Zed Resource",
    ]);
    expect(byName.get("Zed Resource")).toMatchObject({ userId: resource.id });
    expect(byName.get("Zed Resource")?.counts.every((n) => n === 0)).toBe(true);
    expect(byName.get("Owner")?.counts.every((n) => n === 0)).toBe(true);
    expect(byName.get("Former Member")).toMatchObject({ userId: former.id });
    expect(
      byName.get("Former Member")?.counts.reduce((a, b) => a + b, 0),
    ).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });
});

describe("workload: drill-through date validation", () => {
  it("refuses unparseable and reversed ranges", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const base = {
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      assigneeId: owner.user.id,
    };

    await expect(
      getWorkspaceWorkloadTasks({
        ...base,
        from: new Date("nope"),
        to: new Date("2026-01-02"),
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "`from` and `to` must be valid dates",
    });
    await expect(
      getWorkspaceWorkloadTasks({
        ...base,
        from: new Date("2026-01-10"),
        to: new Date("2026-01-02"),
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "`to` must not be before `from`",
    });
    await expect(
      getWorkspaceWorkload({
        ...base,
        from: new Date("2026-01-10"),
        to: new Date("2026-01-02"),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
