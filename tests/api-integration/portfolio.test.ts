import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type PortfolioTask = {
  id: string;
  title: string;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  estimateMinutes: number | null;
  estimateUnit: string;
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

type PortfolioDependency = {
  id: string;
  sourceTaskId: string;
  sourceProjectId: string;
  targetTaskId: string;
  targetProjectId: string;
  dependencyType: string;
  lagDays: number;
};

type PortfolioResponse = {
  projects: PortfolioProject[];
  dependencies: PortfolioDependency[];
  undatedSuccessorDependencies: PortfolioDependency[];
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
    estimateMinutes: number;
    estimateUnit: string;
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
      estimateMinutes: overrides.estimateMinutes ?? null,
      estimateUnit: overrides.estimateUnit ?? "hours",
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
    const payload = (await response.json()) as PortfolioResponse;
    expect(payload.projects).toHaveLength(2);
    expect(payload.dependencies).toEqual([]);

    const byName = new Map(
      payload.projects.map((project) => [project.name, project]),
    );
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

  it("orders a project's tasks by schedule, undated tasks last", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const { project: other } = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Other",
      slug: "other",
    });

    // Every task keeps the default position, so the old (position, id) order
    // was effectively random. Insert them deliberately out of schedule order.
    const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
    await seedTask(project.id, { title: "Zeta undated", number: 1 });
    await seedTask(project.id, {
      title: "Design freeze review",
      startDate: day("2026-02-10"),
      dueDate: day("2026-02-20"),
      number: 2,
    });
    await seedTask(project.id, {
      title: "Requirements and safety concept",
      startDate: day("2026-01-10"),
      dueDate: day("2026-01-25"),
      number: 3,
    });
    await seedTask(project.id, { title: "Alpha undated", number: 4 });
    await seedTask(project.id, {
      title: "Same start, later due",
      startDate: day("2026-01-10"),
      dueDate: day("2026-01-30"),
      number: 5,
    });
    await seedTask(project.id, {
      title: "Due date only",
      dueDate: day("2026-01-05"),
      number: 6,
    });
    await seedTask(project.id, {
      title: "Alpha same dates",
      startDate: day("2026-01-10"),
      dueDate: day("2026-01-25"),
      number: 7,
    });
    await seedTask(other.id, {
      title: "Other project task",
      startDate: day("2026-01-01"),
      number: 1,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/project/portfolio?workspaceId=${member.workspace.id}`,
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as PortfolioResponse;
    const tasks = payload.projects.find(
      (entry) => entry.id === project.id,
    )?.tasks;

    expect(tasks?.map((task) => task.title)).toEqual([
      "Due date only",
      "Alpha same dates",
      "Requirements and safety concept",
      "Same start, later due",
      "Design freeze review",
      "Alpha undated",
      "Zeta undated",
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
    const payload = (await response.json()) as PortfolioResponse;

    expect(payload.projects[0]?.tasks.map((task) => task.title)).toEqual([
      "Still open",
    ]);
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
    expect(((await hidden.json()) as PortfolioResponse).projects.length).toBe(
      0,
    );

    const shown = await app.request(
      `/api/project/portfolio?workspaceId=${member.workspace.id}&includeArchived=true`,
    );
    expect(((await shown.json()) as PortfolioResponse).projects.length).toBe(1);
  });

  it("includes a cross-project blocks relation as a dependency", async () => {
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

    const gate = await seedTask(alpha.id, {
      title: "Client sign-off",
      number: 1,
    });
    const cutover = await seedTask(beta.id, { title: "Cutover", number: 1 });
    // Same-project "blocks" and a cross-project non-blocking relation, to
    // prove the endpoint only surfaces the cross-project scheduling gate.
    const sibling = await seedTask(alpha.id, {
      title: "Same-project follow-up",
      number: 2,
    });
    const related = await seedTask(beta.id, {
      title: "Related but not blocking",
      number: 2,
    });

    const [dependency] = await db
      .insert(schema.taskRelationTable)
      .values({
        sourceTaskId: gate.id,
        targetTaskId: cutover.id,
        relationType: "blocks",
        dependencyType: "fs",
        lagDays: 2,
      })
      .returning();
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: gate.id,
      targetTaskId: sibling.id,
      relationType: "blocks",
      dependencyType: "fs",
      lagDays: 0,
    });
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: gate.id,
      targetTaskId: related.id,
      relationType: "related",
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/project/portfolio?workspaceId=${member.workspace.id}`,
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as PortfolioResponse;

    expect(payload.dependencies).toEqual([
      {
        id: dependency?.id,
        sourceTaskId: gate.id,
        sourceProjectId: alpha.id,
        targetTaskId: cutover.id,
        targetProjectId: beta.id,
        dependencyType: "fs",
        lagDays: 2,
      },
    ]);
    // Both targets here are undated, so each blocks edge (the cross-project
    // one and the same-project one) is also a derivation input; the
    // non-blocking relation never is.
    expect(
      payload.undatedSuccessorDependencies.map((entry) => entry.targetTaskId),
    ).toEqual(expect.arrayContaining([cutover.id, sibling.id]));
    expect(payload.undatedSuccessorDependencies).toHaveLength(2);
  });

  it("returns each task's effort estimate", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await seedTask(project.id, {
      title: "Estimated",
      estimateMinutes: 960,
      estimateUnit: "days",
      number: 1,
    });
    await seedTask(project.id, { title: "Plain", number: 2 });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await app.request(
      `/api/project/portfolio?workspaceId=${member.workspace.id}`,
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as PortfolioResponse;
    const tasks = payload.projects[0]?.tasks ?? [];
    expect(tasks.find((task) => task.title === "Estimated")).toMatchObject({
      estimateMinutes: 960,
      estimateUnit: "days",
    });
    expect(tasks.find((task) => task.title === "Plain")).toMatchObject({
      estimateMinutes: null,
      estimateUnit: "hours",
    });
  });

  it("returns undated tasks and the blocks edges into them, same-project, cross-project and chained", async () => {
    const member = await createWorkspaceMember();
    const { project: alpha } = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Alpha",
    });
    const { project: softlab } = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Softlab",
    });
    const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

    const dated = await seedTask(alpha.id, {
      title: "Dated predecessor",
      startDate: day("2026-01-12"),
      dueDate: day("2026-01-14"),
      number: 1,
    });
    const sameProject = await seedTask(alpha.id, {
      title: "Same-project successor",
      estimateMinutes: 480,
      number: 2,
    });
    const crossProject = await seedTask(softlab.id, {
      title: "Softlab successor",
      estimateMinutes: 960,
      number: 1,
    });
    const chained = await seedTask(softlab.id, {
      title: "Softlab chained",
      number: 2,
    });
    // An edge into a DATED task, same project: never needed to derive anything.
    const datedTarget = await seedTask(alpha.id, {
      title: "Dated target",
      startDate: day("2026-02-01"),
      dueDate: day("2026-02-02"),
      number: 3,
    });
    // A non-blocking relation into an undated task: not a dependency.
    const relatedOnly = await seedTask(softlab.id, {
      title: "Related only",
      number: 3,
    });
    // An archived undated successor: hidden everywhere.
    const archived = await seedTask(softlab.id, {
      title: "Archived successor",
      status: "archived",
      number: 4,
    });

    const blocks = async (
      source: string,
      target: string,
      lagDays = 0,
      dependencyType = "fs",
    ) => {
      const [row] = await db
        .insert(schema.taskRelationTable)
        .values({
          sourceTaskId: source,
          targetTaskId: target,
          relationType: "blocks",
          dependencyType,
          lagDays,
        })
        .returning();
      return row;
    };
    const sameEdge = await blocks(dated.id, sameProject.id);
    const crossEdge = await blocks(dated.id, crossProject.id, 2, "ss");
    const chainEdge = await blocks(crossProject.id, chained.id);
    await blocks(dated.id, datedTarget.id);
    await blocks(dated.id, archived.id);
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: dated.id,
      targetTaskId: relatedOnly.id,
      relationType: "related",
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await app.request(
      `/api/project/portfolio?workspaceId=${member.workspace.id}`,
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as PortfolioResponse;

    // The undated tasks are in the payload (last in their project) with their
    // estimates, so the client can place them.
    const softlabTasks = payload.projects.find(
      (entry) => entry.id === softlab.id,
    )?.tasks;
    expect(softlabTasks?.map((task) => task.title)).toEqual([
      "Related only",
      "Softlab chained",
      "Softlab successor",
    ]);
    expect(
      softlabTasks?.find((task) => task.title === "Softlab successor")
        ?.estimateMinutes,
    ).toBe(960);

    expect(
      payload.undatedSuccessorDependencies.map((entry) => entry.id).sort(),
    ).toEqual([sameEdge.id, crossEdge.id, chainEdge.id].sort());
    expect(payload.undatedSuccessorDependencies).toContainEqual({
      id: crossEdge.id,
      sourceTaskId: dated.id,
      sourceProjectId: alpha.id,
      targetTaskId: crossProject.id,
      targetProjectId: softlab.id,
      dependencyType: "ss",
      lagDays: 2,
    });
    // The drawn cross-project dependency list is unchanged by this: only the
    // cross-project edges, whatever their target.
    expect(payload.dependencies.map((entry) => entry.id)).toEqual([
      crossEdge.id,
    ]);
  });

  it("does not expose a project the caller cannot see through the new edges", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const restricted = await addWorkspaceMember(member.workspace.id, "member");
    const { project: visible } = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Visible",
      members: "none",
    });
    const { project: hidden } = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Hidden",
      members: "none",
    });
    await addProjectMember(visible.id, restricted.id, "member");

    const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
    const visibleDated = await seedTask(visible.id, {
      title: "Visible dated",
      startDate: day("2026-01-12"),
      dueDate: day("2026-01-14"),
      number: 1,
    });
    const visibleUndated = await seedTask(visible.id, {
      title: "Visible undated",
      estimateMinutes: 480,
      number: 2,
    });
    const hiddenDated = await seedTask(hidden.id, {
      title: "Hidden dated",
      startDate: day("2026-01-05"),
      dueDate: day("2026-01-06"),
      number: 1,
    });
    const hiddenUndated = await seedTask(hidden.id, {
      title: "Hidden undated",
      estimateMinutes: 480,
      number: 2,
    });
    const link = async (source: string, target: string) => {
      const [row] = await db
        .insert(schema.taskRelationTable)
        .values({
          sourceTaskId: source,
          targetTaskId: target,
          relationType: "blocks",
          dependencyType: "fs",
          lagDays: 0,
        })
        .returning();
      return row;
    };
    const visibleEdge = await link(visibleDated.id, visibleUndated.id);
    // Hidden predecessor into a visible undated task, visible predecessor
    // into a hidden undated task, and an edge entirely inside the hidden
    // project: none may surface for the restricted caller.
    await link(hiddenDated.id, visibleUndated.id);
    await link(visibleDated.id, hiddenUndated.id);
    await link(hiddenDated.id, hiddenUndated.id);

    mockAuthenticatedSession(restricted);
    const { app } = createApp();
    const restrictedResponse = await app.request(
      `/api/project/portfolio?workspaceId=${member.workspace.id}`,
    );
    expect(restrictedResponse.status).toBe(200);
    const restrictedPayload =
      (await restrictedResponse.json()) as PortfolioResponse;
    expect(restrictedPayload.projects.map((entry) => entry.id)).toEqual([
      visible.id,
    ]);
    expect(
      restrictedPayload.undatedSuccessorDependencies.map((entry) => entry.id),
    ).toEqual([visibleEdge.id]);
    expect(restrictedPayload.dependencies).toEqual([]);
    const serialized = JSON.stringify(restrictedPayload);
    expect(serialized).not.toContain(hidden.id);
    expect(serialized).not.toContain(hiddenDated.id);
    expect(serialized).not.toContain(hiddenUndated.id);

    // A full-access caller (workspace owner) still sees all four edges.
    mockAuthenticatedSession(member.user);
    const ownerResponse = await app.request(
      `/api/project/portfolio?workspaceId=${member.workspace.id}`,
    );
    const ownerPayload = (await ownerResponse.json()) as PortfolioResponse;
    expect(ownerPayload.undatedSuccessorDependencies).toHaveLength(4);
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
