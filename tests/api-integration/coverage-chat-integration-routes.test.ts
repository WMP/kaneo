import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const { publish, bus } = vi.hoisted(() => ({
  publish: vi.fn(),
  bus: { reject: false },
}));
vi.mock("../../apps/api/src/events", async (original) => {
  const actual = await original<typeof import("../../apps/api/src/events")>();
  return {
    ...actual,
    publishEvent: (...args: Parameters<typeof actual.publishEvent>) => {
      publish(...args);
      if (bus.reject) return Promise.reject(new Error("bus down"));
      return actual.publishEvent(...args);
    },
  };
});

type Spec = {
  name: string;
  type: string;
  prefix: string;
  create: Record<string, unknown>;
  invalidCreate: Record<string, unknown>;
  // Every fragment here is a credential: it must never appear in a response.
  secrets: string[];
  storedSecret: (config: Record<string, unknown>) => unknown;
  expectedCreate: Record<string, unknown>;
  defaultEvents: Record<string, boolean>;
};

const chatEvents = {
  taskCreated: true,
  taskStatusChanged: true,
  taskPriorityChanged: false,
  taskTitleChanged: false,
  taskDescriptionChanged: false,
  taskCommentCreated: true,
};

const slackUrl =
  "https://hooks.slack.com/services/T00000000/B00000000/abcd1234SECRETTAILwxyz9876";
const discordUrl =
  "https://discord.com/api/webhooks/123456789/tokenABCDEFGHIJKLMNOP";
const mattermostUrl = "https://127.0.0.1/hooks/mattermost-secret-token";
const genericUrl = "https://127.0.0.1/hooks/abcdefghij";
const botToken = "123456789:ABCD0123456789abcdefghijklmnopqWXYZ";

const specs: Spec[] = [
  {
    name: "Slack",
    type: "slack",
    prefix: "/api/slack-integration/project",
    create: { webhookUrl: slackUrl, channelName: "  #dev  " },
    invalidCreate: { webhookUrl: "https://example.com/not-slack" },
    secrets: ["abcd1234SECRETTAILwxyz9876", "SECRETTAIL"],
    storedSecret: (config) => config.webhookUrl,
    expectedCreate: {
      channelName: "#dev",
      webhookConfigured: true,
      maskedWebhookUrl:
        "https://hooks.slack.com/services/T00000000/B00000000/abcd…9876",
    },
    defaultEvents: chatEvents,
  },
  {
    name: "Discord",
    type: "discord",
    prefix: "/api/discord-integration/project",
    create: { webhookUrl: discordUrl, channelName: "general" },
    invalidCreate: { webhookUrl: "https://example.com/api/webhooks/1/2" },
    secrets: ["tokenABCDEFGHIJKLMNOP", "ABCDEFGHIJ"],
    storedSecret: (config) => config.webhookUrl,
    expectedCreate: {
      channelName: "general",
      webhookConfigured: true,
      maskedWebhookUrl: "https://discord.com/api/webhooks/123456789/toke…MNOP",
    },
    defaultEvents: chatEvents,
  },
  {
    name: "Mattermost",
    type: "mattermost",
    prefix: "/api/mattermost-integration/project",
    create: { webhookUrl: mattermostUrl },
    invalidCreate: { webhookUrl: "http://127.0.0.1/hooks/plain-http" },
    secrets: ["mattermost-secret-token", "secret-token"],
    storedSecret: (config) => config.webhookUrl,
    expectedCreate: {
      channelName: null,
      webhookConfigured: true,
      maskedWebhookUrl: "https://127.0.0.1/hooks/matt…oken",
    },
    defaultEvents: chatEvents,
  },
  {
    name: "Telegram",
    type: "telegram",
    prefix: "/api/telegram-integration/project",
    create: { botToken, chatId: " -100123 ", threadId: 7, chatLabel: " Ops " },
    invalidCreate: { botToken: "not-a-token", chatId: "-100123" },
    secrets: [botToken, "0123456789abcdefghijklmnopq", "ABCD0123456789"],
    storedSecret: (config) => config.botToken,
    expectedCreate: {
      chatId: "-100123",
      threadId: 7,
      chatLabel: "Ops",
      botTokenConfigured: true,
      maskedBotToken: "123456789:ABCD…WXYZ",
    },
    defaultEvents: chatEvents,
  },
  {
    name: "Generic webhook",
    type: "generic-webhook",
    prefix: "/api/generic-webhook-integration/project",
    create: { webhookUrl: genericUrl, secret: "s3cr3t-signing-key" },
    invalidCreate: { webhookUrl: "ftp://127.0.0.1/hook" },
    secrets: ["abcdefghij", "s3cr3t-signing-key", "signing"],
    storedSecret: (config) => config.secret,
    expectedCreate: {
      webhookConfigured: true,
      maskedWebhookUrl: "http…ghij",
      secretConfigured: true,
      maskedSecret: "s3cr…-key",
      dueDateReminderLeadTimeMinutes: 1440,
    },
    defaultEvents: {
      ...chatEvents,
      taskDeleted: false,
      taskMoved: false,
      taskDueDateChanged: false,
      taskAssigneeChanged: false,
      taskUnassigned: false,
      dueDateReminder: false,
    },
  },
];

async function storedRows(projectId: string, type: string) {
  return db
    .select()
    .from(schema.integrationTable)
    .where(eq(schema.integrationTable.projectId, projectId))
    .then((rows) => rows.filter((row) => row.type === type));
}

async function setup() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const viewer = await addWorkspaceMember(owner.workspace.id, "viewer");
  await addProjectMember(project.id, viewer.id, "viewer");
  // Workspace member with the "member" role but no row in this project.
  const projectless = await addWorkspaceMember(owner.workspace.id, "member");
  const foreign = await createWorkspaceMember({ role: "owner" });
  const { app } = createApp();
  return { owner, project, viewer, projectless, foreign, app };
}

function send(
  app: ReturnType<typeof createApp>["app"],
  url: string,
  method: string,
  body?: unknown,
) {
  return app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe.each(specs)("API integration: $name integration routes", (spec) => {
  beforeEach(async () => {
    await resetTestDatabase();
    publish.mockClear();
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("creates, masks, patches, replaces and deletes without ever returning the credential", async () => {
    const { owner, project, app } = await setup();
    mockAuthenticatedSession(owner.user);
    const path = `${spec.prefix}/${project.id}`;

    expect(await (await send(app, path, "GET")).json()).toBeNull();

    const invalid = await send(app, path, "POST", spec.invalidCreate);
    expect(invalid.status).toBe(400);
    expect(await storedRows(project.id, spec.type)).toHaveLength(0);

    const created = await send(app, path, "POST", spec.create);
    expect(created.status).toBe(200);
    const createdText = await created.text();
    const createdBody = JSON.parse(createdText);
    expect(createdBody).toMatchObject({
      projectId: project.id,
      isActive: true,
      ...spec.expectedCreate,
    });
    expect(createdBody.events).toEqual(spec.defaultEvents);
    for (const secret of spec.secrets) {
      expect(createdText).not.toContain(secret);
    }

    const [row] = await storedRows(project.id, spec.type);
    expect(row?.id).toBe(createdBody.id);
    expect(spec.storedSecret(JSON.parse(row?.config ?? "{}"))).toBeTruthy();

    // GET returns the same masked document, never the secret.
    const fetched = await send(app, path, "GET");
    const fetchedText = await fetched.text();
    expect(JSON.parse(fetchedText)).toMatchObject(spec.expectedCreate);
    for (const secret of spec.secrets) {
      expect(fetchedText).not.toContain(secret);
    }

    // PATCH merges toggles into the existing set and keeps the stored secret.
    const storedBefore = spec.storedSecret(JSON.parse(row?.config ?? "{}"));
    const patched = await send(app, path, "PATCH", {
      isActive: false,
      events: { taskPriorityChanged: true, taskCreated: false },
    });
    expect(patched.status).toBe(200);
    const patchedBody = await patched.json();
    expect(patchedBody).toMatchObject({ isActive: false });
    expect(patchedBody.events).toEqual({
      ...spec.defaultEvents,
      taskPriorityChanged: true,
      taskCreated: false,
    });
    const [afterPatch] = await storedRows(project.id, spec.type);
    expect(afterPatch?.isActive).toBe(false);
    expect(spec.storedSecret(JSON.parse(afterPatch?.config ?? "{}"))).toBe(
      storedBefore,
    );

    // A failed PATCH leaves the stored row untouched.
    const failing = await send(app, path, "PATCH", {
      ...(spec.type === "telegram"
        ? { botToken: "broken" }
        : { webhookUrl: "ftp://127.0.0.1/x" }),
    });
    expect(failing.status).toBe(400);
    const [afterFailure] = await storedRows(project.id, spec.type);
    expect(afterFailure?.config).toBe(afterPatch?.config);

    // POST replaces the existing row in place (same id, one row) and, except
    // for Telegram (see the characterization test below), re-activates it.
    const replaced = await send(app, path, "POST", spec.create);
    expect(replaced.status).toBe(200);
    const replacedBody = await replaced.json();
    expect(replacedBody.id).toBe(createdBody.id);
    expect(replacedBody.events).toEqual(spec.defaultEvents);
    if (spec.type !== "telegram") expect(replacedBody.isActive).toBe(true);
    expect(await storedRows(project.id, spec.type)).toHaveLength(1);

    // Deleting removes only this project's row.
    const deleted = await send(app, path, "DELETE");
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ success: true });
    expect(await storedRows(project.id, spec.type)).toHaveLength(0);
    expect(await (await send(app, path, "GET")).json()).toBeNull();
    expect((await send(app, path, "PATCH", { isActive: true })).status).toBe(
      404,
    );
    expect((await send(app, path, "DELETE")).status).toBe(404);
  });

  it("refuses viewers, project-less members, foreign workspaces and anonymous callers without writing", async () => {
    const { owner, project, viewer, projectless, foreign, app } = await setup();
    const path = `${spec.prefix}/${project.id}`;
    mockAuthenticatedSession(owner.user);
    expect((await send(app, path, "POST", spec.create)).status).toBe(200);
    const [seeded] = await storedRows(project.id, spec.type);

    // Viewer: may read the masked document, must not change anything.
    mockAuthenticatedSession(viewer);
    expect((await send(app, path, "GET")).status).toBe(200);
    for (const [method, body] of [
      ["POST", spec.create],
      ["PATCH", { isActive: false }],
      ["DELETE", undefined],
    ] as const) {
      expect((await send(app, path, method, body)).status).toBe(403);
    }

    // Workspace member who is not a member of the project: no access at all.
    mockAuthenticatedSession(projectless);
    for (const [method, body] of [
      ["GET", undefined],
      ["PATCH", { isActive: false }],
      ["DELETE", undefined],
    ] as const) {
      expect((await send(app, path, method, body)).status).toBe(403);
    }

    // Owner of another workspace.
    mockAuthenticatedSession(foreign.user);
    for (const [method, body] of [
      ["GET", undefined],
      ["POST", spec.create],
      ["PATCH", { isActive: false }],
      ["DELETE", undefined],
    ] as const) {
      const response = await send(app, path, method, body);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(spec.secrets[0] as string);
    }

    // Unknown project and missing session.
    mockAuthenticatedSession(owner.user);
    expect(
      (await send(app, `${spec.prefix}/missing-project`, "GET")).status,
    ).toBe(400);
    mockAnonymousSession();
    expect((await send(app, path, "GET")).status).toBe(401);
    expect((await send(app, path, "DELETE")).status).toBe(401);

    const [after] = await storedRows(project.id, spec.type);
    expect(after).toEqual(seeded);
  });

  it("publishes nothing secret and keeps other projects isolated", async () => {
    const { owner, project, app } = await setup();
    const { project: other } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    mockAuthenticatedSession(owner.user);
    await send(app, `${spec.prefix}/${project.id}`, "POST", spec.create);
    expect(
      await (await send(app, `${spec.prefix}/${other.id}`, "GET")).json(),
    ).toBeNull();
    expect(
      (await send(app, `${spec.prefix}/${other.id}`, "DELETE")).status,
    ).toBe(404);
    expect(await storedRows(project.id, spec.type)).toHaveLength(1);
    const serialized = JSON.stringify(publish.mock.calls);
    for (const secret of spec.secrets) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe("API integration: chat integration specifics", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    publish.mockClear();
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("slack and discord masks fall back for short or malformed URLs", async () => {
    const { owner, project, app } = await setup();
    mockAuthenticatedSession(owner.user);
    // Insert directly: validation would refuse these shapes.
    await db.insert(schema.integrationTable).values([
      {
        projectId: project.id,
        type: "slack",
        config: JSON.stringify({ webhookUrl: "https://hooks.slack.com/a/b" }),
        isActive: true,
      },
      {
        projectId: project.id,
        type: "discord",
        config: JSON.stringify({ webhookUrl: "not a url" }),
        isActive: true,
      },
    ]);
    const slack = await (
      await send(app, `/api/slack-integration/project/${project.id}`, "GET")
    ).json();
    expect(slack.maskedWebhookUrl).toBe("https://hooks.slack.com/a/••••");
    const discord = await (
      await send(app, `/api/discord-integration/project/${project.id}`, "GET")
    ).json();
    expect(discord.maskedWebhookUrl).toBe("Configured");
    expect(discord.webhookConfigured).toBe(true);
    await db.insert(schema.integrationTable).values([
      {
        projectId: project.id,
        type: "mattermost",
        config: JSON.stringify({ webhookUrl: "not a url" }),
        isActive: true,
      },
    ]);
    await db
      .update(schema.integrationTable)
      .set({ config: JSON.stringify({ webhookUrl: "not a url" }) })
      .where(eq(schema.integrationTable.type, "slack"));
    for (const type of ["slack", "mattermost"]) {
      const body = await (
        await send(app, `/api/${type}-integration/project/${project.id}`, "GET")
      ).json();
      expect(body.maskedWebhookUrl, type).toBe("Configured");
    }
  });

  it("slack keeps the stored webhook for a blank PATCH value and clears the channel with null", async () => {
    const { owner, project, app } = await setup();
    mockAuthenticatedSession(owner.user);
    const path = `/api/slack-integration/project/${project.id}`;
    await send(app, path, "POST", { webhookUrl: slackUrl, channelName: "dev" });
    const response = await send(app, path, "PATCH", {
      webhookUrl: "   ",
      channelName: null,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      channelName: null,
      maskedWebhookUrl:
        "https://hooks.slack.com/services/T00000000/B00000000/abcd…9876",
    });
    const [row] = await storedRows(project.id, "slack");
    expect(JSON.parse(row?.config ?? "{}").webhookUrl).toBe(slackUrl);

    // A new URL replaces the old one.
    const nextUrl = "https://hooks.slack.com/services/T11111111/B22222222/zzzz";
    const replaced = await send(app, path, "PATCH", { webhookUrl: nextUrl });
    expect(replaced.status).toBe(200);
    const [after] = await storedRows(project.id, "slack");
    expect(JSON.parse(after?.config ?? "{}").webhookUrl).toBe(nextUrl);
  });

  it("discord keeps the channel name when a PATCH omits it and rejects a non-Discord URL", async () => {
    const { owner, project, app } = await setup();
    mockAuthenticatedSession(owner.user);
    const path = `/api/discord-integration/project/${project.id}`;
    await send(app, path, "POST", { webhookUrl: discordUrl, channelName: "x" });
    const kept = await send(app, path, "PATCH", { isActive: true });
    expect((await kept.json()).channelName).toBe("x");
    const bad = await send(app, path, "PATCH", {
      webhookUrl: "https://evil.example/api/webhooks/1/2",
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Enter a valid Discord webhook URL");
    // Replacing keeps a single row and re-activates it.
    await send(app, path, "PATCH", { isActive: false });
    const replaced = await send(app, path, "POST", { webhookUrl: discordUrl });
    expect((await replaced.json()).isActive).toBe(true);
    expect(await storedRows(project.id, "discord")).toHaveLength(1);
  });

  it("mattermost refuses a private destination when private destinations are not allowed", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
    const { owner, project, app } = await setup();
    mockAuthenticatedSession(owner.user);
    const response = await send(
      app,
      `/api/mattermost-integration/project/${project.id}`,
      "POST",
      { webhookUrl: "https://127.0.0.1/hooks/token" },
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("non-routable");
    expect(await storedRows(project.id, "mattermost")).toHaveLength(0);
  });

  it("generic webhook: removes the secret with null, validates lead time and refuses localhost", async () => {
    const { owner, project, app } = await setup();
    mockAuthenticatedSession(owner.user);
    const path = `/api/generic-webhook-integration/project/${project.id}`;
    for (const minutes of [4, 43_201, 5.5]) {
      const response = await send(app, path, "POST", {
        webhookUrl: genericUrl,
        dueDateReminderLeadTimeMinutes: minutes,
      });
      expect(response.status).toBe(400);
    }
    expect(await storedRows(project.id, "generic-webhook")).toHaveLength(0);

    const created = await send(app, path, "POST", {
      webhookUrl: genericUrl,
      secret: "short",
      dueDateReminderLeadTimeMinutes: 5,
      events: { taskDeleted: true },
    });
    expect(await created.json()).toMatchObject({
      secretConfigured: true,
      maskedSecret: "••••",
      dueDateReminderLeadTimeMinutes: 5,
      events: { taskDeleted: true, taskMoved: false },
    });

    const cleared = await send(app, path, "PATCH", {
      secret: null,
      dueDateReminderLeadTimeMinutes: 43_200,
    });
    expect(await cleared.json()).toMatchObject({
      secretConfigured: false,
      maskedSecret: null,
      dueDateReminderLeadTimeMinutes: 43_200,
      events: { taskDeleted: true },
    });
    const [row] = await storedRows(project.id, "generic-webhook");
    expect(JSON.parse(row?.config ?? "{}").secret).toBeUndefined();

    // Blank URL keeps the stored one; a loopback URL is refused once private
    // destinations are not allowed.
    const blank = await send(app, path, "PATCH", { webhookUrl: " " });
    expect(blank.status).toBe(200);
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
    const refused = await send(app, path, "PATCH", {
      webhookUrl: "http://localhost/hook",
    });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("non-routable");
  });

  it("telegram: patch semantics, no-op detection, null clearing and event publication", async () => {
    const { owner, project, app } = await setup();
    mockAuthenticatedSession(owner.user);
    const path = `/api/telegram-integration/project/${project.id}`;
    const created = await send(app, path, "POST", {
      botToken,
      chatId: "-100123",
      threadId: 7,
      chatLabel: "Ops",
    });
    expect(created.status).toBe(200);
    expect(publish).toHaveBeenCalledWith(
      "integration.created",
      expect.objectContaining({
        projectId: project.id,
        userId: owner.user.id,
        integrationType: "telegram",
      }),
    );
    expect(publish.mock.calls[0]?.[1]).not.toHaveProperty("apiKeyId");

    // POST again replaces and is reported as an update.
    await send(app, path, "POST", { botToken, chatId: "-100123" });
    expect(publish.mock.calls[1]?.[0]).toBe("integration.updated");
    expect(await storedRows(project.id, "telegram")).toHaveLength(1);

    // A no-op patch changes nothing and publishes nothing.
    const [before] = await storedRows(project.id, "telegram");
    publish.mockClear();
    const noop = await send(app, path, "PATCH", {});
    expect(noop.status).toBe(200);
    const [afterNoop] = await storedRows(project.id, "telegram");
    expect(afterNoop?.updatedAt).toEqual(before?.updatedAt);
    expect(publish).not.toHaveBeenCalled();

    // Set thread and label, then clear them with null.
    const set = await send(app, path, "PATCH", {
      threadId: 9,
      chatLabel: "Alerts",
    });
    expect(await set.json()).toMatchObject({
      threadId: 9,
      chatLabel: "Alerts",
    });
    expect(publish).toHaveBeenCalledWith(
      "integration.updated",
      expect.objectContaining({ integrationType: "telegram" }),
    );
    const cleared = await send(app, path, "PATCH", {
      threadId: null,
      chatLabel: null,
    });
    expect(await cleared.json()).toMatchObject({
      threadId: null,
      chatLabel: null,
    });

    // Rotating the token stores the new one and masks it.
    const rotated = "987654321:ZYXW0123456789abcdefghijklmnopqQRST";
    const response = await send(app, path, "PATCH", {
      botToken: ` ${rotated} `,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).maskedBotToken).toBe("987654321:ZYXW…QRST");
    const [stored] = await storedRows(project.id, "telegram");
    expect(JSON.parse(stored?.config ?? "{}").botToken).toBe(rotated);

    // An empty chat id is invalid and leaves the row untouched.
    const empty = await send(app, path, "PATCH", { chatId: "  " });
    expect(empty.status).toBe(400);
    const [afterEmpty] = await storedRows(project.id, "telegram");
    expect(afterEmpty?.config).toBe(stored?.config);

    publish.mockClear();
    expect((await send(app, path, "DELETE")).status).toBe(200);
    expect(publish).toHaveBeenCalledWith(
      "integration.deleted",
      expect.objectContaining({
        integrationId: stored?.id,
        integrationType: "telegram",
      }),
    );
  });

  it("telegram: a failing event publication never fails the request", async () => {
    const { owner, project, app } = await setup();
    mockAuthenticatedSession(owner.user);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    bus.reject = true;
    try {
      const response = await send(
        app,
        `/api/telegram-integration/project/${project.id}`,
        "POST",
        { botToken, chatId: "1" },
      );
      expect(response.status).toBe(200);
      expect(await storedRows(project.id, "telegram")).toHaveLength(1);
      await vi.waitFor(() =>
        expect(errors).toHaveBeenCalledWith(
          "Failed to publish integration.created:",
          expect.any(Error),
        ),
      );
    } finally {
      bus.reject = false;
    }
  });

  it("telegram: a corrupt stored config answers 500 and logs it without the token", async () => {
    const { owner, project, app } = await setup();
    mockAuthenticatedSession(owner.user);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await db.insert(schema.integrationTable).values({
      projectId: project.id,
      type: "telegram",
      config: JSON.stringify({
        botToken: "leaky-token-value",
        chatId: "-1",
        threadId: 0,
      }),
      isActive: true,
    });
    const path = `/api/telegram-integration/project/${project.id}`;
    for (const method of ["GET", "PATCH"] as const) {
      const response = await send(
        app,
        path,
        method,
        method === "PATCH" ? { isActive: false } : undefined,
      );
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("leaky-token-value");
    }
    expect(JSON.stringify(errors.mock.calls)).toContain("[REDACTED]");

    // Unparseable JSON is reported as such, again without a leak.
    await db
      .update(schema.integrationTable)
      .set({ config: "{leaky-token-value" })
      .where(eq(schema.integrationTable.projectId, project.id));
    errors.mockClear();
    expect((await send(app, path, "GET")).status).toBe(500);
    expect(JSON.stringify(errors.mock.calls)).toContain("[UNPARSEABLE]");
  });

  // PROBABLE DEFECT (reported): parseTelegramIntegrationConfig logs the raw
  // ValiError next to the sanitized config. The error's issues carry the
  // rejected `input` (the bot token), so the credential reaches the log.
  it("telegram: a corrupt stored config is logged without the bot token", async () => {
    const { owner, project, app } = await setup();
    mockAuthenticatedSession(owner.user);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await db.insert(schema.integrationTable).values({
      projectId: project.id,
      type: "telegram",
      config: JSON.stringify({ botToken: "leaky-token-value", chatId: "-1" }),
      isActive: true,
    });
    await send(app, `/api/telegram-integration/project/${project.id}`, "GET");
    expect(errors).toHaveBeenCalled();
    expect(JSON.stringify(errors.mock.calls)).not.toContain(
      "leaky-token-value",
    );
  });

  it("characterization: telegram POST over a deactivated integration keeps it inactive, unlike the other chat integrations", async () => {
    const { owner, project, app } = await setup();
    mockAuthenticatedSession(owner.user);
    const path = `/api/telegram-integration/project/${project.id}`;
    await send(app, path, "POST", { botToken, chatId: "1" });
    await send(app, path, "PATCH", { isActive: false });
    const replaced = await send(app, path, "POST", { botToken, chatId: "1" });
    // Slack, Discord, Mattermost and the generic webhook answer isActive: true
    // here. Whether Telegram should is an open product question.
    expect((await replaced.json()).isActive).toBe(false);
  });
});
