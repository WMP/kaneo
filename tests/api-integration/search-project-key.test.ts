import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import globalSearch from "../../apps/api/src/search/controllers/global-search";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

async function addTasks(
  projectId: string,
  tasks: Array<{ number: number; title?: string }>,
) {
  for (const { number, title } of tasks) {
    await db.insert(schema.taskTable).values({
      projectId,
      title: title ?? `Unrelated work ${number}`,
      status: "to-do",
      number,
      position: number,
    });
  }
}

const keys = (results: Array<{ projectSlug?: string; taskNumber?: number }>) =>
  results.map((r) => `${r.projectSlug}-${r.taskNumber}`);

describe("search by project key and task number prefix", () => {
  it("lists a project's tasks, newest number first, for DC, dc and DC-", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
      slug: "DC",
    });
    await addTasks(project.id, [{ number: 1 }, { number: 2 }, { number: 3 }]);

    for (const query of ["DC", "dc", "DC-", " Dc- "]) {
      const result = await globalSearch({
        query,
        userId: member.user.id,
        workspaceId: member.workspace.id,
        type: "tasks",
      });
      expect(keys(result.results)).toEqual(["DC-3", "DC-2", "DC-1"]);
      expect(result.results.every((r) => r.relevanceScore === 5)).toBe(true);
    }
  });

  it("does not treat the key as a wildcard and respects the limit", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
      slug: "DEP",
    });
    await addTasks(project.id, [{ number: 1 }, { number: 2 }, { number: 3 }]);

    const wildcard = await globalSearch({
      query: "DE_",
      userId: member.user.id,
      workspaceId: member.workspace.id,
      type: "tasks",
    });
    expect(wildcard.results).toEqual([]);

    const limited = await globalSearch({
      query: "DEP",
      userId: member.user.id,
      workspaceId: member.workspace.id,
      type: "tasks",
      limit: 2,
    });
    expect(keys(limited.results)).toEqual(["DEP-3", "DEP-2"]);
  });

  it("DC-1 returns DC-1 first, then DC-10 and DC-12, but not DC-2", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
      slug: "DC",
    });
    await addTasks(
      project.id,
      [1, 2, 10, 12, 100].map((number) => ({ number })),
    );

    const result = await globalSearch({
      query: "DC-1",
      userId: member.user.id,
      workspaceId: member.workspace.id,
      type: "tasks",
    });
    expect(keys(result.results)).toEqual(["DC-1", "DC-10", "DC-12", "DC-100"]);
    expect(result.results.map((r) => r.relevanceScore)).toEqual([10, 4, 4, 4]);
  });

  it("does not return tasks of a project the caller is not a member of", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      slug: "DC",
      members: "none",
    });
    await addTasks(project.id, [{ number: 1 }, { number: 10 }]);
    const restricted = await addWorkspaceMember(owner.workspace.id, "member");

    for (const query of ["DC", "DC-", "DC-1"]) {
      const hidden = await globalSearch({
        query,
        userId: restricted.id,
        workspaceId: owner.workspace.id,
        type: "tasks",
      });
      expect(hidden.results).toEqual([]);
    }

    await addProjectMember(project.id, restricted.id, "member");
    const visible = await globalSearch({
      query: "DC",
      userId: restricted.id,
      workspaceId: owner.workspace.id,
      type: "tasks",
    });
    expect(keys(visible.results)).toEqual(["DC-10", "DC-1"]);
  });

  it("excludeProjectId still excludes the project, projectId still scopes", async () => {
    const member = await createWorkspaceMember();
    const { project: dc } = await createProjectFixture({
      workspaceId: member.workspace.id,
      slug: "DC",
    });
    const { project: other } = await createProjectFixture({
      workspaceId: member.workspace.id,
      slug: "DX",
    });
    await addTasks(dc.id, [{ number: 1 }, { number: 10 }]);
    await addTasks(other.id, [{ number: 1 }]);

    for (const query of ["DC", "DC-1"]) {
      const excluded = await globalSearch({
        query,
        userId: member.user.id,
        workspaceId: member.workspace.id,
        type: "tasks",
        excludeProjectId: dc.id,
      });
      expect(excluded.results).toEqual([]);
    }

    const scoped = await globalSearch({
      query: "DC",
      userId: member.user.id,
      workspaceId: member.workspace.id,
      type: "tasks",
      projectId: other.id,
    });
    expect(scoped.results).toEqual([]);
  });

  it("returns a task once, at its highest-scoring match", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
      slug: "DC",
    });
    await addTasks(project.id, [
      { number: 1, title: "DC rollout" },
      { number: 2 },
    ]);

    const byKey = await globalSearch({
      query: "DC",
      userId: member.user.id,
      workspaceId: member.workspace.id,
      type: "tasks",
    });
    expect(keys(byKey.results)).toEqual(["DC-2", "DC-1"]);
    expect(byKey.results.map((r) => r.relevanceScore)).toEqual([5, 5]);

    const byShortId = await globalSearch({
      query: "DC-1",
      userId: member.user.id,
      workspaceId: member.workspace.id,
      type: "all",
    });
    const dc1 = byShortId.results.filter((r) => r.type === "task");
    expect(dc1).toHaveLength(1);
    expect(dc1[0]?.relevanceScore).toBe(10);
  });
});
