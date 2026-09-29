import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import globalSearch from "../../apps/api/src/search/controllers/global-search";
import { resolveUserProjectScope } from "../../apps/api/src/utils/project-scope-filters";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Search resolves the caller's project scope only as far as it needs it: for the
// named workspace alone, and not at all when there is nothing to search.

vi.mock("../../apps/api/src/utils/project-scope-filters", async (original) => {
  const actual =
    await original<
      typeof import("../../apps/api/src/utils/project-scope-filters")
    >();
  return {
    ...actual,
    resolveUserProjectScope: vi.fn(actual.resolveUserProjectScope),
  };
});

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
});

async function task(projectId: string, title: string, number: number) {
  const [row] = await db
    .insert(schema.taskTable)
    .values({ projectId, title, status: "to-do", number, position: number })
    .returning();
  return row;
}

describe("search scope resolution", () => {
  it("an instance administrator without memberships and without a workspace searches nothing and resolves no scope", async () => {
    await createWorkspaceMember({ role: "owner" });
    const [admin] = await db
      .insert(schema.userTable)
      .values({
        id: "lonely-admin",
        email: "lonely-admin@example.com",
        emailVerified: true,
        name: "Admin",
        role: "admin",
      })
      .returning();
    const result = await globalSearch({ query: "anything", userId: admin.id });
    expect(result).toEqual({
      results: [],
      totalCount: 0,
      searchQuery: "anything",
    });
    expect(resolveUserProjectScope).not.toHaveBeenCalled();
  });

  it("resolves the scope of the named workspace only", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project: ownProject } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      members: "none",
    });
    await task(ownProject.id, "needle in the owner's workspace", 1);

    // The same user is a restricted member of a second workspace.
    const second = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: second.workspace.id,
      userId: owner.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    const { project: visible } = await createProjectFixture({
      workspaceId: second.workspace.id,
      members: "none",
    });
    const { project: hidden } = await createProjectFixture({
      workspaceId: second.workspace.id,
      members: "none",
    });
    await addProjectMember(visible.id, owner.user.id, "member");
    await task(visible.id, "needle visible", 1);
    await task(hidden.id, "needle hidden", 1);

    const result = await globalSearch({
      query: "needle",
      userId: owner.user.id,
      workspaceId: second.workspace.id,
      type: "tasks",
    });
    expect(result.results.map((r) => r.title)).toEqual(["needle visible"]);
    expect(resolveUserProjectScope).toHaveBeenCalledTimes(1);
    expect(resolveUserProjectScope).toHaveBeenCalledWith(
      owner.user.id,
      second.workspace.id,
    );

    // Without a workspace the whole membership is searched.
    vi.mocked(resolveUserProjectScope).mockClear();
    const everywhere = await globalSearch({
      query: "needle",
      userId: owner.user.id,
      type: "tasks",
    });
    expect(everywhere.results.map((r) => r.title).sort()).toEqual([
      "needle in the owner's workspace",
      "needle visible",
    ]);
    expect(resolveUserProjectScope).toHaveBeenCalledWith(
      owner.user.id,
      undefined,
    );
  });

  it("a workspace-only search resolves no scope", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    await addWorkspaceMember(member.workspace.id, "member");
    const result = await globalSearch({
      query: "Integration",
      userId: member.user.id,
      type: "workspaces",
    });
    expect(result.results.length).toBeGreaterThan(0);
    expect(resolveUserProjectScope).not.toHaveBeenCalled();
  });
});
