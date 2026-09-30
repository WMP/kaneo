import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Obviously fake but format-valid values: they satisfy each validator's shape
// and never reach a real service.
const slackWebhookUrl = "https://hooks.slack.com/services/T000/B000/XXXX";
const discordWebhookUrl =
  "https://discord.com/api/webhooks/000000000000000000/fake-token";
const telegramBotToken = `123456789:${"A".repeat(35)}`;
const telegramChatId = "-1000000000000";
// TEST-NET-3 (RFC 5737): an IP literal outside the blocked ranges, so the
// public-destination check passes without any DNS query.
const genericWebhookUrl = "http://203.0.113.10/hooks/fake";

type IntegrationType = "slack" | "discord" | "telegram" | "generic-webhook";

async function findIntegrationRows(projectId: string, type: IntegrationType) {
  return db
    .select()
    .from(schema.integrationTable)
    .where(
      and(
        eq(schema.integrationTable.projectId, projectId),
        eq(schema.integrationTable.type, type),
      ),
    );
}

function integrationRequests(
  app: ReturnType<typeof createApp>["app"],
  route: string,
  projectId: string,
) {
  const path = `/api/${route}/project/${projectId}`;
  return (method: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}

describe("API integration: notification integration config bounds", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await resetTestDatabase();
    // The private-destination escape hatch must stay off for every case here.
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "false");
    // Validation only checks shape and addresses; no test may call out.
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected outbound request"));
  });

  afterEach(() => {
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  describe("Slack", () => {
    it("rejects a webhook URL that does not match the Slack pattern on create and update", async () => {
      const owner = await createWorkspaceMember({ role: "owner" });
      const { project } = await createProjectFixture({
        workspaceId: owner.workspace.id,
      });
      mockAuthenticatedSession(owner.user);
      const { app } = createApp();
      const request = integrationRequests(app, "slack-integration", project.id);

      const rejected = await request("POST", {
        webhookUrl: "https://hooks.example.com/services/T000/B000/XXXX",
      });
      expect(rejected.status).toBe(400);
      expect(await rejected.text()).toBe("Invalid Slack webhook URL");
      expect(await findIntegrationRows(project.id, "slack")).toHaveLength(0);

      // Positive control: the same request with a matching URL is accepted.
      const created = await request("POST", { webhookUrl: slackWebhookUrl });
      expect(created.status).toBe(200);
      const [stored] = await findIntegrationRows(project.id, "slack");
      expect(JSON.parse(stored.config).webhookUrl).toBe(slackWebhookUrl);

      const rejectedUpdate = await request("PATCH", {
        webhookUrl: "https://hooks.slack.com/services/T000/B000",
      });
      expect(rejectedUpdate.status).toBe(400);
      expect(await rejectedUpdate.text()).toBe("Invalid Slack webhook URL");
      const [afterRejected] = await findIntegrationRows(project.id, "slack");
      expect(afterRejected.config).toBe(stored.config);
      expect(afterRejected.updatedAt).toEqual(stored.updatedAt);

      const updated = await request("PATCH", { channelName: "alerts" });
      expect(updated.status).toBe(200);
      const [afterUpdate] = await findIntegrationRows(project.id, "slack");
      expect(JSON.parse(afterUpdate.config)).toMatchObject({
        webhookUrl: slackWebhookUrl,
        channelName: "alerts",
      });
    });
  });

  describe("Discord", () => {
    it("rejects a webhook URL that does not match the Discord pattern on create and update", async () => {
      const owner = await createWorkspaceMember({ role: "owner" });
      const { project } = await createProjectFixture({
        workspaceId: owner.workspace.id,
      });
      mockAuthenticatedSession(owner.user);
      const { app } = createApp();
      const request = integrationRequests(
        app,
        "discord-integration",
        project.id,
      );

      const rejected = await request("POST", {
        webhookUrl: "https://example.com/api/webhooks/000000000000000000/fake",
      });
      expect(rejected.status).toBe(400);
      expect(await rejected.text()).toBe("Enter a valid Discord webhook URL");
      expect(await findIntegrationRows(project.id, "discord")).toHaveLength(0);

      // Positive control: the same request with a matching URL is accepted.
      const created = await request("POST", { webhookUrl: discordWebhookUrl });
      expect(created.status).toBe(200);
      const [stored] = await findIntegrationRows(project.id, "discord");
      expect(JSON.parse(stored.config).webhookUrl).toBe(discordWebhookUrl);

      const rejectedUpdate = await request("PATCH", {
        webhookUrl: "http://discord.com/api/webhooks/000000000000000000/fake",
      });
      expect(rejectedUpdate.status).toBe(400);
      expect(await rejectedUpdate.text()).toBe(
        "Enter a valid Discord webhook URL",
      );
      const [afterRejected] = await findIntegrationRows(project.id, "discord");
      expect(afterRejected.config).toBe(stored.config);
      expect(afterRejected.updatedAt).toEqual(stored.updatedAt);

      const updated = await request("PATCH", { channelName: "alerts" });
      expect(updated.status).toBe(200);
      const [afterUpdate] = await findIntegrationRows(project.id, "discord");
      expect(JSON.parse(afterUpdate.config)).toMatchObject({
        webhookUrl: discordWebhookUrl,
        channelName: "alerts",
      });
    });
  });

  describe("Telegram", () => {
    it("rejects a malformed bot token on create and update", async () => {
      const owner = await createWorkspaceMember({ role: "owner" });
      const { project } = await createProjectFixture({
        workspaceId: owner.workspace.id,
      });
      mockAuthenticatedSession(owner.user);
      const { app } = createApp();
      const request = integrationRequests(
        app,
        "telegram-integration",
        project.id,
      );

      const rejected = await request("POST", {
        botToken: "123456789:too-short",
        chatId: telegramChatId,
      });
      expect(rejected.status).toBe(400);
      expect(await rejected.text()).toBe("Enter a valid Telegram bot token");
      expect(await findIntegrationRows(project.id, "telegram")).toHaveLength(0);

      // Positive control: the same request with a well-formed token is accepted.
      const created = await request("POST", {
        botToken: telegramBotToken,
        chatId: telegramChatId,
      });
      expect(created.status).toBe(200);
      const [stored] = await findIntegrationRows(project.id, "telegram");
      expect(JSON.parse(stored.config)).toMatchObject({
        botToken: telegramBotToken,
        chatId: telegramChatId,
      });

      const rejectedUpdate = await request("PATCH", {
        botToken: "not-a-bot-token",
      });
      expect(rejectedUpdate.status).toBe(400);
      expect(await rejectedUpdate.text()).toBe(
        "Enter a valid Telegram bot token",
      );
      const [afterRejected] = await findIntegrationRows(project.id, "telegram");
      expect(afterRejected.config).toBe(stored.config);
      expect(afterRejected.updatedAt).toEqual(stored.updatedAt);

      const updated = await request("PATCH", { chatLabel: "Team chat" });
      expect(updated.status).toBe(200);
      const [afterUpdate] = await findIntegrationRows(project.id, "telegram");
      expect(JSON.parse(afterUpdate.config)).toMatchObject({
        botToken: telegramBotToken,
        chatLabel: "Team chat",
      });
    });
  });

  describe("Generic webhook", () => {
    it("rejects private, loopback and non-http destinations on create and update", async () => {
      const owner = await createWorkspaceMember({ role: "owner" });
      const { project } = await createProjectFixture({
        workspaceId: owner.workspace.id,
      });
      mockAuthenticatedSession(owner.user);
      const { app } = createApp();
      const request = integrationRequests(
        app,
        "generic-webhook-integration",
        project.id,
      );

      const nonRoutable =
        "Generic webhook destination resolves to a non-routable address";
      for (const webhookUrl of [
        "http://127.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://localhost/hook",
        "http://[::1]/hook",
      ]) {
        const rejected = await request("POST", { webhookUrl });
        expect(rejected.status).toBe(400);
        expect(await rejected.text()).toBe(nonRoutable);
      }
      const nonHttp = await request("POST", {
        webhookUrl: "ftp://203.0.113.10/hook",
      });
      expect(nonHttp.status).toBe(400);
      expect(await nonHttp.text()).toBe("Webhook URL must use http or https");
      expect(
        await findIntegrationRows(project.id, "generic-webhook"),
      ).toHaveLength(0);

      // Positive control: a public destination is accepted.
      const created = await request("POST", { webhookUrl: genericWebhookUrl });
      expect(created.status).toBe(200);
      const [stored] = await findIntegrationRows(project.id, "generic-webhook");
      expect(JSON.parse(stored.config).webhookUrl).toBe(genericWebhookUrl);

      const rejectedUpdate = await request("PATCH", {
        webhookUrl: "http://169.254.169.254/latest/meta-data/",
      });
      expect(rejectedUpdate.status).toBe(400);
      expect(await rejectedUpdate.text()).toBe(nonRoutable);
      const [afterRejected] = await findIntegrationRows(
        project.id,
        "generic-webhook",
      );
      expect(afterRejected.config).toBe(stored.config);
      expect(afterRejected.updatedAt).toEqual(stored.updatedAt);
    });
  });

  // Discord and Telegram have no other coverage of the manage_settings gate.
  describe.each([
    {
      name: "Discord",
      route: "discord-integration",
      type: "discord" as const,
      body: { webhookUrl: discordWebhookUrl },
      config: { webhookUrl: discordWebhookUrl },
    },
    {
      name: "Telegram",
      route: "telegram-integration",
      type: "telegram" as const,
      body: { botToken: telegramBotToken, chatId: telegramChatId },
      config: { botToken: telegramBotToken, chatId: telegramChatId },
    },
  ])("$name access", ({ route, type, body, config }) => {
    it("refuses a caller from another workspace and persists nothing", async () => {
      const owner = await createWorkspaceMember({ role: "owner" });
      const { project } = await createProjectFixture({
        workspaceId: owner.workspace.id,
      });
      // Owner of a different workspace: full rights there, none here.
      const outsider = await createWorkspaceMember({ role: "owner" });
      mockAuthenticatedSession(outsider.user);
      const { app } = createApp();
      const request = integrationRequests(app, route, project.id);

      for (const method of ["GET", "POST"]) {
        const response = await request(
          method,
          method === "POST" ? body : undefined,
        );
        expect(response.status).toBe(403);
        expect(await response.text()).toBe(
          "You don't have access to this workspace",
        );
      }
      expect(await findIntegrationRows(project.id, type)).toHaveLength(0);

      const [seeded] = await db
        .insert(schema.integrationTable)
        .values({ projectId: project.id, type, config: JSON.stringify(config) })
        .returning();
      for (const method of ["PATCH", "DELETE"]) {
        const response = await request(
          method,
          method === "PATCH" ? { isActive: false } : undefined,
        );
        expect(response.status).toBe(403);
        expect(await response.text()).toBe(
          "You don't have access to this workspace",
        );
      }
      expect(await findIntegrationRows(project.id, type)).toEqual([seeded]);
    });

    it("refuses a viewer in the same workspace and persists nothing", async () => {
      const viewer = await createWorkspaceMember({ role: "viewer" });
      const { project } = await createProjectFixture({
        workspaceId: viewer.workspace.id,
      });
      mockAuthenticatedSession(viewer.user);
      const { app } = createApp();
      const request = integrationRequests(app, route, project.id);

      // Reading is open to the viewer; only mutations need manage_settings.
      expect((await request("GET")).status).toBe(200);
      const created = await request("POST", body);
      expect(created.status).toBe(403);
      expect(await created.text()).toBe("Insufficient permissions");
      expect(await findIntegrationRows(project.id, type)).toHaveLength(0);

      const [seeded] = await db
        .insert(schema.integrationTable)
        .values({ projectId: project.id, type, config: JSON.stringify(config) })
        .returning();
      for (const method of ["PATCH", "DELETE"]) {
        const response = await request(
          method,
          method === "PATCH" ? { isActive: false } : undefined,
        );
        expect(response.status).toBe(403);
        expect(await response.text()).toBe("Insufficient permissions");
      }
      expect(await findIntegrationRows(project.id, type)).toEqual([seeded]);
    });
  });
});
