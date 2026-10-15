import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import createResource from "../../apps/api/src/resource/controllers/create-resource";
import deleteResource from "../../apps/api/src/resource/controllers/delete-resource";
import updateResource from "../../apps/api/src/resource/controllers/update-resource";
import { filterWorkspaceResources } from "../../apps/api/src/resource/workspace-resources";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

beforeEach(resetTestDatabase);

const viewer = (userId: string) => ({
  userId,
  canSeeInvitations: async () => false,
});

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const { res, status } = error as { res?: Response; status?: number };
    return { status, code: ((await res?.json()) as { code?: string })?.code };
  }
  throw new Error("expected a rejection");
}

describe("resource controllers: refusals", () => {
  it("create refuses a blank name, an email on equipment and an unknown workspace, storing nothing", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const v = viewer(owner.user.id);

    expect(
      await codeOf(createResource(owner.workspace.id, v, "person", "   ")),
    ).toEqual({
      status: 400,
      code: "RESOURCE_NAME_REQUIRED",
    });
    expect(
      await codeOf(
        createResource(
          owner.workspace.id,
          v,
          "equipment",
          "Drill",
          "x@example.com",
        ),
      ),
    ).toEqual({ status: 400, code: "RESOURCE_EMAIL_NOT_ALLOWED" });
    expect(await codeOf(createResource("missing", v, "person", "Ann"))).toEqual(
      {
        status: 404,
        code: "WORKSPACE_NOT_FOUND",
      },
    );
    expect(await db.select().from(schema.resourceTable)).toHaveLength(0);
  });

  it("update and delete answer 404 for an unknown resource; update refuses a blank name and keeps the stored one", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const v = viewer(owner.user.id);
    const created = await createResource(
      owner.workspace.id,
      v,
      "person",
      "Ann",
      "Ann@Example.com",
    );
    expect(created).toMatchObject({
      name: "Ann",
      email: "ann@example.com",
      kind: "person",
    });

    expect(await codeOf(updateResource("missing", v, "x"))).toEqual({
      status: 404,
      code: "RESOURCE_NOT_FOUND",
    });
    expect(await codeOf(deleteResource("missing", v))).toEqual({
      status: 404,
      code: "RESOURCE_NOT_FOUND",
    });
    expect(await codeOf(updateResource(created.id, v, "  "))).toEqual({
      status: 400,
      code: "RESOURCE_NAME_REQUIRED",
    });
    expect(
      (
        await db.query.resourceTable.findFirst({
          where: eq(schema.resourceTable.id, created.id),
        })
      )?.name,
    ).toBe("Ann");
  });

  it("filterWorkspaceResources returns only ids of that workspace and nothing for an empty list", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const other = await createWorkspaceMember({ role: "owner" });
    const v = viewer(owner.user.id);
    const mine = await createResource(owner.workspace.id, v, "person", "Mine");
    const theirs = await createResource(
      other.workspace.id,
      viewer(other.user.id),
      "person",
      "Theirs",
    );

    expect(await filterWorkspaceResources([], owner.workspace.id)).toEqual(
      new Set(),
    );
    expect(
      await filterWorkspaceResources(
        [mine.id, theirs.id, "nope"],
        owner.workspace.id,
      ),
    ).toEqual(new Set([mine.id]));
  });

  it("the create route answers 400 with a code for a whitespace-only name", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    const response = await createApp().app.request(
      `/api/resource/workspace/${owner.workspace.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "person", name: "   " }),
      },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "RESOURCE_NAME_REQUIRED",
    });
    expect(await db.select().from(schema.resourceTable)).toHaveLength(0);
  });
});
