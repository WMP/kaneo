import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { scopeToProjectFromBody } from "../../apps/api/src/integrations/middleware";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type Caller = { userId?: string; apiKeyId?: string };

// The middleware is mounted on the GitHub, Gitea and GitLab integration routes.
// A tiny app isolates its contract from those routes' own behavior.
function buildApp(caller: Caller) {
  const app = new Hono();
  app.onError((error, c) =>
    error instanceof HTTPException
      ? c.json({ message: error.message }, error.status)
      : c.json({ message: "internal" }, 500),
  );
  app.use("*", async (c, next) => {
    if (caller.userId) c.set("userId", caller.userId);
    if (caller.apiKeyId) c.set("apiKey", { id: caller.apiKeyId });
    await next();
  });
  app.post("/scoped", scopeToProjectFromBody, (c) =>
    c.json({
      workspaceId: c.get("workspaceId"),
      projectId: c.get("projectId"),
      hasAccess: Boolean(c.get("projectAccess")),
    }),
  );
  return app;
}

const post = (app: Hono, body: string) =>
  app.request("/scoped", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

async function seed() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
    members: "none",
  });
  const member = await addWorkspaceMember(owner.workspace.id, "member");
  return { owner, project, member };
}

describe("API integration: scopeToProjectFromBody", () => {
  beforeEach(resetTestDatabase);

  it("answers 401 without a user and never reads the body", async () => {
    const { project } = await seed();
    const response = await post(
      buildApp({}),
      JSON.stringify({ projectId: project.id }),
    );
    expect(response.status).toBe(401);
  });

  it("answers 400 when projectId is missing, blank, not a string or the body is not JSON", async () => {
    const { owner } = await seed();
    const app = buildApp({ userId: owner.user.id });
    for (const body of [
      "{}",
      JSON.stringify({ projectId: "" }),
      JSON.stringify({ projectId: 42 }),
      JSON.stringify({ projectId: null }),
      "not json",
      "",
    ]) {
      const response = await post(app, body);
      expect(response.status, body).toBe(400);
      expect(await response.json()).toEqual({
        message: "projectId is required",
      });
    }
  });

  it("answers 404 for an unknown project", async () => {
    const { owner } = await seed();
    const response = await post(
      buildApp({ userId: owner.user.id }),
      JSON.stringify({ projectId: "ghost" }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Project not found" });
  });

  it("answers 403 for a project of a workspace the caller does not belong to", async () => {
    const { project } = await seed();
    const foreign = await createWorkspaceMember({ role: "owner" });
    const response = await post(
      buildApp({ userId: foreign.user.id }),
      JSON.stringify({ projectId: project.id }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      message: "You don't have access to this workspace",
    });
  });

  it("answers 403 for a workspace member who is not a member of the project", async () => {
    const { project, member } = await seed();
    const response = await post(
      buildApp({ userId: member.id }),
      JSON.stringify({ projectId: project.id }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      message: "You don't have access to this project",
    });
  });

  it("lets a project member and a full-access owner through and sets the workspace", async () => {
    const { owner, project, member } = await seed();
    await addProjectMember(project.id, member.id, "member");
    for (const userId of [member.id, owner.user.id]) {
      const response = await post(
        buildApp({ userId }),
        JSON.stringify({ projectId: project.id }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        workspaceId: owner.workspace.id,
        projectId: project.id,
        hasAccess: true,
      });
    }
  });

  it("rejects an API key that does not belong to the caller or is disabled", async () => {
    const { owner, project, member } = await seed();
    await addProjectMember(project.id, member.id, "member");
    const now = new Date();
    const keyOf = async (userId: string, enabled: boolean) => {
      const [row] = await db
        .insert(schema.apikeyTable)
        .values({
          referenceId: userId,
          userId,
          key: `hash-${userId}-${enabled}`,
          enabled,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return row?.id as string;
    };
    const ownKey = await keyOf(member.id, true);
    const ownerKey = await keyOf(owner.user.id, true);
    const disabledKey = await keyOf(member.id, false);
    const body = JSON.stringify({ projectId: project.id });

    expect(
      (await post(buildApp({ userId: member.id, apiKeyId: ownKey }), body))
        .status,
    ).toBe(200);
    for (const apiKeyId of [ownerKey, disabledKey, "missing-key"]) {
      const response = await post(
        buildApp({ userId: member.id, apiKeyId }),
        body,
      );
      expect(response.status, apiKeyId).toBe(403);
      expect(await response.json()).toEqual({
        message: "Invalid API key for this workspace",
      });
    }
  });
});
