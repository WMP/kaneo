import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

describe("API integration: workspace activity retention setting", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("defaults to disabled (keep forever)", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity-retention`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ activityRetentionDays: null });
  });

  it("lets an admin set a retention window", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity-retention`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityRetentionDays: 90 }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ activityRetentionDays: 90 });

    const readBack = await app.request(
      `/api/workspace/${member.workspace.id}/activity-retention`,
    );
    expect(await readBack.json()).toEqual({ activityRetentionDays: 90 });
  });

  it("normalizes 0 to null (disabled)", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    await db
      .update(schema.workspaceTable)
      .set({ activityRetentionDays: 30 })
      .where(eq(schema.workspaceTable.id, member.workspace.id));

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity-retention`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityRetentionDays: 0 }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ activityRetentionDays: null });
  });

  it("rejects a member without workspace:manage_settings", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity-retention`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityRetentionDays: 30 }),
      },
    );

    expect(response.status).toBe(403);

    const stillDefault = await app.request(
      `/api/workspace/${member.workspace.id}/activity-retention`,
    );
    expect(await stillDefault.json()).toEqual({
      activityRetentionDays: null,
    });
  });

  it("rejects a user with no access to the workspace", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const outsider = await createWorkspaceMember();

    mockAuthenticatedSession(outsider.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity-retention`,
    );

    expect(response.status).toBe(403);
  });

  it("rejects an out-of-range value", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${member.workspace.id}/activity-retention`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityRetentionDays: -1 }),
      },
    );

    expect(response.status).toBe(400);
  });
});
