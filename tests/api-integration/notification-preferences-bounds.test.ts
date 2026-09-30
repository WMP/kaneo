import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Refusals of the notification preference routes: a workspace rule needs
// workspace membership, projects of the same workspace and channels enabled
// globally; global delivery settings need a public destination and a lead time
// between 5 minutes and 30 days. Every refused request must leave the stored
// preferences exactly as they were.

// 203.0.113.0/24 (TEST-NET-3) is routable as far as the destination check is
// concerned, and an IP literal needs no DNS lookup.
const publicWebhookUrl = "https://203.0.113.10/hooks/notifications";

const emptyRule = {
  isActive: true,
  emailEnabled: false,
  ntfyEnabled: false,
  gotifyEnabled: false,
  webhookEnabled: false,
  projectMode: "all",
};

function putGlobal(body: unknown) {
  return createApp().app.request("/api/notification-preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function putRule(workspaceId: string, body: unknown) {
  return createApp().app.request(
    `/api/notification-preferences/workspaces/${workspaceId}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

async function preferenceRows(userId: string) {
  return db
    .select()
    .from(schema.userNotificationPreferenceTable)
    .where(eq(schema.userNotificationPreferenceTable.userId, userId));
}

async function ruleRows(userId: string) {
  return db
    .select()
    .from(schema.userNotificationWorkspaceRuleTable)
    .where(eq(schema.userNotificationWorkspaceRuleTable.userId, userId));
}

describe("API integration: notification preference bounds", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    // Private destinations must stay refused, whatever the runner exports.
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses a workspace rule for a workspace the caller is not a member of", async () => {
    const caller = await createWorkspaceMember({ role: "owner" });
    const other = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(caller.user);

    const response = await putRule(other.workspace.id, emptyRule);

    expect(response.status).toBe(403);
    expect(await response.text()).toContain(
      "You don't have access to this workspace",
    );
    expect(await ruleRows(caller.user.id)).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.userNotificationWorkspaceRuleTable)
        .where(
          eq(
            schema.userNotificationWorkspaceRuleTable.workspaceId,
            other.workspace.id,
          ),
        ),
    ).toEqual([]);
  });

  it.each(["owner", "member"])(
    "refuses a project of another workspace for a %s",
    async (role) => {
      const caller = await createWorkspaceMember({ role });
      const other = await createWorkspaceMember({ role: "owner" });
      const { project: foreignProject } = await createProjectFixture({
        workspaceId: other.workspace.id,
      });
      mockAuthenticatedSession(caller.user);

      const response = await putRule(caller.workspace.id, {
        ...emptyRule,
        projectMode: "selected",
        selectedProjectIds: [foreignProject.id],
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain(
        "One or more selected projects are invalid",
      );
      expect(await ruleRows(caller.user.id)).toEqual([]);
      expect(
        await db.select().from(schema.userNotificationWorkspaceProjectTable),
      ).toEqual([]);
    },
  );

  it.each([
    ["webhook", { webhookEnabled: true, webhookUrl: "URL" }],
    [
      "ntfy",
      { ntfyEnabled: true, ntfyServerUrl: "URL", ntfyTopic: "synthetic-topic" },
    ],
    [
      "gotify",
      {
        gotifyEnabled: true,
        gotifyServerUrl: "URL",
        gotifyToken: "synthetic-app-token",
      },
    ],
  ])(
    "refuses a private %s destination and keeps the stored settings",
    async (_channel, template) => {
      const member = await createWorkspaceMember();
      mockAuthenticatedSession(member.user);

      // A stored configuration the refused requests must not disturb.
      const baseline = await putGlobal({
        webhookEnabled: true,
        webhookUrl: publicWebhookUrl,
        dueDateReminderLeadTimeMinutes: 60,
      });
      expect(baseline.status).toBe(200);
      const [stored] = await preferenceRows(member.user.id);
      expect(stored?.webhookUrl).toBe(publicWebhookUrl);

      for (const address of [
        "http://127.0.0.1/hooks/notifications",
        "http://10.0.0.1/hooks/notifications",
        "http://169.254.169.254/latest/meta-data",
        "http://localhost/hooks/notifications",
      ]) {
        const body = Object.fromEntries(
          Object.entries(template).map(([key, value]) => [
            key,
            value === "URL" ? address : value,
          ]),
        );
        const response = await putGlobal(body);

        expect(response.status, address).toBe(400);
        // The destination check is shared with the generic webhook plugin.
        expect(await response.text(), address).toContain(
          "destination resolves to a non-routable address",
        );
        expect(await preferenceRows(member.user.id), address).toEqual([stored]);
      }
    },
  );

  it("refuses a private webhook destination when no preferences exist yet", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);

    const response = await putGlobal({
      webhookEnabled: true,
      webhookUrl: "http://10.0.0.1/hooks/notifications",
    });

    expect(response.status).toBe(400);
    expect(await preferenceRows(member.user.id)).toEqual([]);
  });

  it.each([0, 4, -1, 5.5, 43_201])(
    "refuses a due date reminder lead time of %s",
    async (minutes) => {
      const member = await createWorkspaceMember();
      mockAuthenticatedSession(member.user);

      const response = await putGlobal({
        dueDateReminderLeadTimeMinutes: minutes,
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("dueDateReminderLeadTimeMinutes");
      expect(await preferenceRows(member.user.id)).toEqual([]);
    },
  );

  it.each([5, 43_200])(
    "accepts a due date reminder lead time of %s",
    async (minutes) => {
      const member = await createWorkspaceMember();
      mockAuthenticatedSession(member.user);

      const response = await putGlobal({
        dueDateReminderLeadTimeMinutes: minutes,
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        dueDateReminderLeadTimeMinutes: minutes,
      });
      const [stored] = await preferenceRows(member.user.id);
      expect(stored?.dueDateReminderLeadTimeMinutes).toBe(minutes);
    },
  );

  it("keeps the stored lead time when a later update is out of bounds", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    expect(
      (await putGlobal({ dueDateReminderLeadTimeMinutes: 90 })).status,
    ).toBe(200);
    const [stored] = await preferenceRows(member.user.id);

    expect(
      (await putGlobal({ dueDateReminderLeadTimeMinutes: 4 })).status,
    ).toBe(400);
    expect(
      (await putGlobal({ dueDateReminderLeadTimeMinutes: 43_201 })).status,
    ).toBe(400);

    expect(await preferenceRows(member.user.id)).toEqual([stored]);
  });

  it.each([
    ["email", "emailEnabled", "Enable email notifications globally"],
    ["ntfy", "ntfyEnabled", "Enable ntfy notifications globally"],
    ["gotify", "gotifyEnabled", "Enable Gotify notifications globally"],
    ["webhook", "webhookEnabled", "Enable webhook notifications globally"],
  ])(
    "refuses a workspace rule enabling %s when it is not enabled globally",
    async (_channel, flag, message) => {
      const member = await createWorkspaceMember();
      mockAuthenticatedSession(member.user);

      const response = await putRule(member.workspace.id, {
        ...emptyRule,
        [flag]: true,
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain(message);
      expect(await preferenceRows(member.user.id)).toEqual([]);
      expect(await ruleRows(member.user.id)).toEqual([]);
    },
  );

  it("refuses a workspace rule enabling a channel that is configured but switched off globally", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    expect(
      (
        await putGlobal({
          webhookEnabled: false,
          webhookUrl: publicWebhookUrl,
        })
      ).status,
    ).toBe(200);

    const response = await putRule(member.workspace.id, {
      ...emptyRule,
      webhookEnabled: true,
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      "Enable webhook notifications globally",
    );
    expect(await ruleRows(member.user.id)).toEqual([]);
  });

  it("accepts a workspace rule enabling a channel that is enabled globally", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    expect(
      (
        await putGlobal({
          webhookEnabled: true,
          webhookUrl: publicWebhookUrl,
        })
      ).status,
    ).toBe(200);

    const response = await putRule(member.workspace.id, {
      ...emptyRule,
      webhookEnabled: true,
    });

    expect(response.status).toBe(200);
    const [rule] = await ruleRows(member.user.id);
    expect(rule).toMatchObject({
      workspaceId: member.workspace.id,
      webhookEnabled: true,
      projectMode: "all",
    });
  });
});
