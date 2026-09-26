import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

vi.mock("../../apps/api/src/events", async (original) => ({
  ...(await original<object>()),
  publishEvent: vi.fn(async () => undefined),
}));

beforeEach(async () => {
  await resetTestDatabase();
});

describe("GET /task/export/:projectId", () => {
  it("includes progress, milestone, baseline, constraint fields and relations", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const [source] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        columnId: columns.todo.id,
        title: "Foundation",
        status: "to-do",
        priority: "high",
        number: 1,
        position: 1,
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        dueDate: new Date("2026-04-05T00:00:00.000Z"),
        progress: 40,
        isMilestone: false,
        baselineStartDate: new Date("2026-04-01T00:00:00.000Z"),
        baselineDueDate: new Date("2026-04-06T00:00:00.000Z"),
        constraintType: "must_start_on",
        constraintDate: new Date("2026-04-01T00:00:00.000Z"),
      })
      .returning();

    const [target] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        columnId: columns.todo.id,
        title: "Framing",
        status: "to-do",
        priority: "medium",
        number: 2,
        position: 2,
        progress: 0,
        isMilestone: true,
      })
      .returning();

    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: source.id,
      targetTaskId: target.id,
      relationType: "blocks",
      dependencyType: "ss",
      lagDays: 2,
    });

    const { app } = createApp();
    const response = await app.request(`/api/task/export/${project.id}`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tasks: Array<{
        id: string;
        title: string;
        progress: number;
        isMilestone: boolean;
        baselineStartDate: string | null;
        baselineDueDate: string | null;
        constraintType: string;
        constraintDate: string | null;
        relations: Array<{
          relationType: string;
          dependencyType: string;
          lagDays: number;
          sourceTaskId: string;
          targetTaskId: string;
        }>;
      }>;
    };

    expect(body.tasks).toHaveLength(2);

    const exportedSource = body.tasks.find((t) => t.title === "Foundation");
    const exportedTarget = body.tasks.find((t) => t.title === "Framing");
    expect(exportedSource).toBeDefined();
    expect(exportedTarget).toBeDefined();

    expect(exportedSource).toMatchObject({
      id: source.id,
      progress: 40,
      isMilestone: false,
      baselineStartDate: "2026-04-01T00:00:00.000Z",
      baselineDueDate: "2026-04-06T00:00:00.000Z",
      constraintType: "must_start_on",
      constraintDate: "2026-04-01T00:00:00.000Z",
    });

    expect(exportedTarget).toMatchObject({
      id: target.id,
      progress: 0,
      isMilestone: true,
      baselineStartDate: null,
      baselineDueDate: null,
      constraintType: "none",
      constraintDate: null,
    });

    // The relation appears on both ends, so a consumer can build the
    // dependency graph regardless of which task it looks at first.
    expect(exportedSource?.relations).toEqual([
      {
        relationType: "blocks",
        dependencyType: "ss",
        lagDays: 2,
        sourceTaskId: source.id,
        targetTaskId: target.id,
      },
    ]);
    expect(exportedTarget?.relations).toEqual(exportedSource?.relations);
  });

  it("includes a relation to a task outside this project on the in-project side", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const { project: otherProject, columns: otherColumns } =
      await createProjectFixture({
        workspaceId: member.workspace.id,
        slug: "other-project",
      });
    mockAuthenticatedSession(member.user);

    const [inProject] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        columnId: columns.todo.id,
        title: "In project",
        status: "to-do",
        number: 1,
        position: 1,
      })
      .returning();

    const [outOfProject] = await db
      .insert(schema.taskTable)
      .values({
        projectId: otherProject.id,
        columnId: otherColumns.todo.id,
        title: "Elsewhere",
        status: "to-do",
        number: 1,
        position: 1,
      })
      .returning();

    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: inProject.id,
      targetTaskId: outOfProject.id,
      relationType: "related",
    });

    const { app } = createApp();
    const response = await app.request(`/api/task/export/${project.id}`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tasks: Array<{ title: string; relations: unknown[] }>;
    };

    const exported = body.tasks.find((t) => t.title === "In project");
    expect(exported?.relations).toEqual([
      {
        relationType: "related",
        dependencyType: "fs",
        lagDays: 0,
        sourceTaskId: inProject.id,
        targetTaskId: outOfProject.id,
      },
    ]);
    // The other task isn't part of this project's export.
    expect(body.tasks.some((t) => t.title === "Elsewhere")).toBe(false);
  });
});
