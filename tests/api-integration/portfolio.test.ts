import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type PortfolioTask = {
  id: string;
  title: string;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  isMilestone: boolean;
  status: string;
};

type PortfolioProject = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  icon: string | null;
  tasks: PortfolioTask[];
};

async function seedTask(
  projectId: string,
  overrides: Partial<{
    title: string;
    status: string;
    startDate: Date;
    dueDate: Date;
    progress: number;
    isMilestone: boolean;
    number: number;
  }>,
) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title: overrides.title ?? "Task",
      status: overrides.status ?? "to-do",
      startDate: overrides.startDate ?? null,
      dueDate: overrides.dueDate ?? null,
      progress: overrides.progress ?? 0,
      isMilestone: overrides.isMilestone ?? false,
      number: overrides.number ?? 1,
    })
    .returning();
  return task;
}

describe("API integration: workspace portfolio", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("returns every project with its tasks' scheduling data", async () => {
    const member = await createWorkspaceMember();
    const { project: alpha } = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Alpha",
      slug: "alpha",
    });
    const { project: beta } = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Beta",
      slug: "beta",
    });

    const start = new Date("2026-01-10T00:00:00.000Z");
    const due = new Date("2026-01-20T00:00:00.000Z");
    await seedTask(alpha.id, {
      title: "Migrate schema",
      startDate: start,
      dueDate: due,
      progress: 40,
      number: 1,
    });
    await seedTask(beta.id, {
      title: "Ship v1",
      startDate: due,
      dueDate: due,
      isMilestone: true,
      number: 1,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/project/portfolio?workspaceId=${member.workspace.id}`,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as PortfolioProject[];
    expect(payload).toHaveLength(2);

    const byName = new Map(payload.map((project) => [project.name, project]));
    const alphaPayload = byName.get("Alpha");
    expect(alphaPayload?.tasks).toEqual([
      expect.objectContaining({
        title: "Migrate schema",
        progress: 40,
        isMilestone: false,
        status: "to-do",
      }),
    ]);
    expect(new Date(alphaPayload?.tasks[0]?.startDate as string)).toEqual(
      start,
    );

    const betaPayload = byName.get("Beta");
    expect(betaPayload?.tasks).toEqual([
      expect.objectContaining({ title: "Ship v1", isMilestone: true }),
    ]);
  });

  it("excludes archived tasks from the timeline", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await seedTask(project.id, { title: "Still open", number: 1 });
    await seedTask(project.id, {
      title: "Filed away",
      status: "archived",
      number: 2,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/project/portfolio?workspaceId=${member.workspace.id}`,
    );
    const payload = (await response.json()) as PortfolioProject[];

    expect(payload[0]?.tasks.map((task) => task.title)).toEqual(["Still open"]);
  });

  it("excludes archived projects unless includeArchived is set", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Retired",
    });
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const hidden = await app.request(
      `/api/project/portfolio?workspaceId=${member.workspace.id}`,
    );
    expect(((await hidden.json()) as PortfolioProject[]).length).toBe(0);

    const shown = await app.request(
      `/api/project/portfolio?workspaceId=${member.workspace.id}&includeArchived=true`,
    );
    expect(((await shown.json()) as PortfolioProject[]).length).toBe(1);
  });

  it("rejects a user outside the workspace", async () => {
    const member = await createWorkspaceMember();
    const outsiderId = `user-${randomUUID()}`;
    const [outsider] = await db
      .insert(schema.userTable)
      .values({
        id: outsiderId,
        email: `${outsiderId}@example.com`,
        emailVerified: true,
        name: "Outsider",
      })
      .returning();

    mockAuthenticatedSession(outsider);
    const { app } = createApp();

    const response = await app.request(
      `/api/project/portfolio?workspaceId=${member.workspace.id}`,
    );

    expect(response.status).toBe(403);
  });
});
