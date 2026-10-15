import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { S3Client } from "../../apps/api/node_modules/@aws-sdk/client-s3";
import db, { schema } from "../../apps/api/src/database";
import createExternalLink from "../../apps/api/src/external-link/controllers/create-external-link";
import { createApp } from "../../apps/api/src/index";
import globalSearch from "../../apps/api/src/search/controllers/global-search";
import deleteAccountData from "../../apps/api/src/user/controllers/delete-account-data";
import getWorkspaceActivityRetention from "../../apps/api/src/workspace/controllers/get-workspace-activity-retention";
import updateWorkspaceActivityRetention from "../../apps/api/src/workspace/controllers/update-workspace-activity-retention";
import {
  requireUserDirectoryRateLimit,
  userDirectoryRateLimiter,
} from "../../apps/api/src/workspace/rate-limit";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
  vi.restoreAllMocks();
});

function send(method: string, path: string, body?: unknown) {
  return createApp().app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedTask() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId: project.id, title: "T", number: 1, status: "to-do" })
    .returning();
  mockAuthenticatedSession(owner.user);
  return { owner, project, task };
}

describe("bulk task route preconditions", () => {
  it("requires a value for value operations and schedule entries for updateSchedule, changing nothing", async () => {
    const { task } = await seedTask();

    const noValue = await send("PATCH", "/api/task/bulk", {
      taskIds: [task.id],
      operation: "updateStatus",
    });
    expect(noValue.status).toBe(400);
    expect(await noValue.text()).toBe("Value is required for this operation");

    const noSchedule = await send("PATCH", "/api/task/bulk", {
      taskIds: [task.id],
      operation: "updateSchedule",
    });
    expect(noSchedule.status).toBe(400);
    expect(await noSchedule.text()).toBe(
      "scheduleUpdates is required for updateSchedule",
    );

    const ok = await send("PATCH", "/api/task/bulk", {
      taskIds: [task.id],
      operation: "updateStatus",
      value: "done",
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ success: true, updatedCount: 1 });
    expect(
      (
        await db.query.taskTable.findFirst({
          where: eq(schema.taskTable.id, task.id),
        })
      )?.status,
    ).toBe("done");
  });
});

describe("task image upload validation", () => {
  it("refuses a blank content type and an unconfigured storage, and refuses finalize of a blank content type", async () => {
    const { task } = await seedTask();
    vi.stubEnv("S3_ENDPOINT", "");
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(
      new Error("must not be called"),
    );

    const badType = await send("PUT", `/api/task/image-upload/${task.id}`, {
      filename: "x.bin",
      contentType: "   ",
      size: 10,
      surface: "description",
    });
    expect(badType.status).toBe(400);

    const unconfigured = await send(
      "PUT",
      `/api/task/image-upload/${task.id}`,
      {
        filename: "x.png",
        contentType: "image/png",
        size: 10,
        surface: "description",
      },
    );
    expect(unconfigured.status).toBe(503);

    const finalize = await send(
      "POST",
      `/api/task/image-upload/${task.id}/finalize`,
      {
        key: "k",
        filename: "x.bin",
        contentType: "   ",
        size: 10,
        surface: "description",
      },
    );
    expect(finalize.status).toBe(400);
    expect(await db.select().from(schema.assetTable)).toHaveLength(0);
    vi.unstubAllEnvs();
  });
});

describe("workspace, search and user edge cases", () => {
  it("global search for a named workspace finds nothing for a user who belongs to no workspace", async () => {
    const owner = await createWorkspaceMember({
      workspaceName: "Zqsolo Workspace",
    });
    await createProjectFixture({
      workspaceId: owner.workspace.id,
      name: "Zqsolo Project",
    });
    const [loner] = await db
      .insert(schema.userTable)
      .values({
        id: "loner-2",
        email: "loner2@example.com",
        emailVerified: true,
        name: "Loner",
      })
      .returning();

    const result = await globalSearch({
      query: "zqsolo",
      userId: loner.id,
      workspaceId: owner.workspace.id,
    });
    expect(result).toEqual({
      results: [],
      totalCount: 0,
      searchQuery: "zqsolo",
    });
  });

  it("characterization: an external link on an unknown task fails on the foreign key, not with a 404 (the route middleware answers first)", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await expect(
      createExternalLink({
        taskId: "missing",
        url: "https://example.com",
        userId: owner.user.id,
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    expect(await db.select().from(schema.externalLinkTable)).toHaveLength(0);
  });

  it("activity retention answers 404 for an unknown workspace and stores null for zero", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await expect(
      getWorkspaceActivityRetention("missing"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateWorkspaceActivityRetention("missing", 30),
    ).rejects.toMatchObject({ status: 404 });

    await updateWorkspaceActivityRetention(owner.workspace.id, 30);
    expect(await getWorkspaceActivityRetention(owner.workspace.id)).toEqual({
      activityRetentionDays: 30,
    });
    await updateWorkspaceActivityRetention(owner.workspace.id, 0);
    expect(await getWorkspaceActivityRetention(owner.workspace.id)).toEqual({
      activityRetentionDays: null,
    });
  });

  it("the workspace activity feed rejects an unparseable from or to with 400", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    const base = `/api/workspace/${owner.workspace.id}/activity`;

    const from = await send("GET", `${base}?from=not-a-date`);
    expect(from.status).toBe(400);
    expect(await from.text()).toContain('Invalid "from" timestamp');
    const to = await send("GET", `${base}?to=also-not`);
    expect(to.status).toBe(400);
    expect(await to.text()).toContain('Invalid "to" timestamp');
    expect(
      (await send("GET", `${base}?from=2026-01-01T00:00:00Z`)).status,
    ).toBe(200);
  });

  it("account data deletion for a user without memberships plans nothing and still succeeds", async () => {
    const [user] = await db
      .insert(schema.userTable)
      .values({
        id: "no-membership",
        email: "nm@example.com",
        emailVerified: true,
        name: "NM",
      })
      .returning();
    await expect(deleteAccountData(user.id)).resolves.toEqual({
      blockedWorkspaceNames: [],
      workspaceIdsToDelete: [],
      workspaceIdsToLeave: [],
    });
  });

  it("the user directory limiter answers 429 with Retry-After once the budget is spent", async () => {
    const userId = "directory-spammer";
    for (let i = 0; i < 120; i++)
      expect(userDirectoryRateLimiter.hit(userId).allowed).toBe(true);
    const context = {
      get: (key: string) => (key === "userId" ? userId : undefined),
    };

    const refusal = await requireUserDirectoryRateLimit(
      context as never,
      async () => undefined,
    ).catch((e: unknown) => e);
    const { status, res } = refusal as { status: number; res: Response };
    expect(status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await res.json()).toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("pending invitations and OAuth id token", () => {
  it("an unverified email sees no invitations, a verified one sees its own pending invitation only", async () => {
    const inviter = await createWorkspaceMember({
      role: "owner",
      workspaceName: "Inviting Co",
    });
    const invitee = await createWorkspaceMember();
    await db.insert(schema.invitationTable).values([
      {
        workspaceId: inviter.workspace.id,
        email: invitee.user.email,
        role: "member",
        inviterId: inviter.user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      {
        workspaceId: inviter.workspace.id,
        email: invitee.user.email,
        role: "member",
        status: "canceled",
        inviterId: inviter.user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      {
        workspaceId: inviter.workspace.id,
        email: "someone-else@example.com",
        role: "member",
        inviterId: inviter.user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    ]);

    mockAuthenticatedSession({ ...invitee.user, emailVerified: false });
    const hidden = await send("GET", "/api/invitation/pending");
    expect(hidden.status).toBe(200);
    expect(await hidden.json()).toEqual([]);

    mockAuthenticatedSession(invitee.user);
    const visible = (await (
      await send("GET", "/api/invitation/pending")
    ).json()) as Array<{
      email: string;
      workspaceName: string;
    }>;
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      email: invitee.user.email,
      workspaceName: "Inviting Co",
    });
  });

  it("returns the stored id token or null, scoped to the caller", async () => {
    const withToken = await createWorkspaceMember();
    const without = await createWorkspaceMember();
    await db.insert(schema.accountTable).values({
      id: "acc-1",
      accountId: "ext-1",
      providerId: "custom",
      userId: withToken.user.id,
      idToken: "id-token-value",
    });

    mockAuthenticatedSession(withToken.user);
    expect(await (await send("GET", "/api/oauth/id-token")).json()).toEqual({
      idToken: "id-token-value",
    });
    mockAuthenticatedSession(without.user);
    expect(await (await send("GET", "/api/oauth/id-token")).json()).toEqual({
      idToken: null,
    });
  });
});
