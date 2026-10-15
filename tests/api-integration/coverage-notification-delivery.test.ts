import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { deliverNotification } from "../../apps/api/src/notification-preferences/delivery";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (..._args: unknown[]) => ({ success: true })),
}));
vi.mock("@kaneo/email", async (original) => ({
  ...(await original<object>()),
  sendNotificationEmail: sendEmail,
}));

const clientUrl = "https://kaneo.test";
const fetchMock = vi.fn();

type World = Awaited<ReturnType<typeof world>>;

async function put(
  app: ReturnType<typeof createApp>["app"],
  path: string,
  body: unknown,
) {
  const response = await app.request(`/api/notification-preferences${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status, await response.clone().text()).toBe(200);
}

// A user with every channel configured through the public API, plus one
// workspace rule that uses every channel for all projects.
async function world(
  options: { channels?: string[]; rule?: Record<string, unknown> | false } = {},
) {
  const channels = options.channels ?? ["email", "ntfy", "gotify", "webhook"];
  const owner = await createWorkspaceMember({
    role: "owner",
    userName: "Ann",
    workspaceName: "Acme",
  });
  const { project, columns } = await createProjectFixture({
    workspaceId: owner.workspace.id,
    name: "Apollo",
  });
  const { project: otherProject } = await createProjectFixture({
    workspaceId: owner.workspace.id,
    name: "Gemini",
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      columnId: columns.todo.id,
      title: "Ship it",
      userId: owner.user.id,
    })
    .returning();
  if (!task) throw new Error("task not created");

  const { app } = createApp();
  mockAuthenticatedSession(owner.user);
  const prefs: Record<string, unknown> = {};
  if (channels.includes("email")) prefs.emailEnabled = true;
  if (channels.includes("ntfy")) {
    Object.assign(prefs, {
      ntfyEnabled: true,
      ntfyServerUrl: "https://127.0.0.1:8443/",
      ntfyTopic: "kaneo alerts",
      ntfyToken: "ntfy-secret-token",
    });
  }
  if (channels.includes("gotify")) {
    Object.assign(prefs, {
      gotifyEnabled: true,
      gotifyServerUrl: "https://127.0.0.1/gotify/",
      gotifyToken: "gotify-secret-token",
    });
  }
  if (channels.includes("webhook")) {
    Object.assign(prefs, {
      webhookEnabled: true,
      webhookUrl: "https://127.0.0.1/hook",
      webhookSecret: "whsec-secret",
    });
  }
  if (Object.keys(prefs).length > 0) await put(app, "", prefs);
  if (options.rule !== false) {
    await put(app, `/workspaces/${owner.workspace.id}`, {
      isActive: true,
      emailEnabled: channels.includes("email"),
      ntfyEnabled: channels.includes("ntfy"),
      gotifyEnabled: channels.includes("gotify"),
      webhookEnabled: channels.includes("webhook"),
      projectMode: "all",
      ...options.rule,
    });
  }
  const link = `${clientUrl}/dashboard/workspace/${owner.workspace.id}/project/${project.id}/task/${task.id}`;
  return { owner, project, otherProject, task, app, link };
}

async function notify(
  w: World,
  values: Partial<typeof schema.notificationTable.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.notificationTable)
    .values({
      userId: w.owner.user.id,
      type: "task_status_changed",
      eventData: {
        taskTitle: "Ship it",
        oldStatus: "to-do",
        newStatus: "done",
      },
      resourceType: "task",
      resourceId: w.task.id,
      ...values,
    })
    .returning();
  if (!row) throw new Error("notification not created");
  return row;
}

function request(url: string) {
  return fetchMock.mock.calls.find(([called]) => String(called) === url) as
    | [string, RequestInit]
    | undefined;
}

beforeEach(async () => {
  await resetTestDatabase();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response("ok"));
  sendEmail.mockReset();
  sendEmail.mockImplementation(async () => ({ success: true }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "delivery-test-key");
  vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
  vi.stubEnv("KANEO_CLIENT_URL", clientUrl);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("API integration: notification delivery to external channels", () => {
  it("delivers one notification to every enabled channel with the decrypted secrets", async () => {
    const w = await world();
    const n = await notify(w);
    await deliverNotification(n.id);

    // ntfy: trailing slash trimmed, topic encoded, bearer token decrypted.
    const ntfyCall = request("https://127.0.0.1:8443/kaneo%20alerts");
    expect(ntfyCall).toBeDefined();
    expect(ntfyCall?.[1]).toMatchObject({
      method: "POST",
      redirect: "error",
      body: "Ship it moved from to-do to done.",
      headers: {
        Authorization: "Bearer ntfy-secret-token",
        Click: w.link,
        Title: "Task status changed",
      },
    });

    // Gotify: app token in the query string, JSON message with a click action.
    const gotifyCall = request(
      "https://127.0.0.1/gotify/message?token=gotify-secret-token",
    );
    expect(gotifyCall).toBeDefined();
    expect(gotifyCall?.[1].headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(JSON.parse(gotifyCall?.[1].body as string)).toEqual({
      title: "Task status changed",
      message: "Ship it moved from to-do to done.",
      priority: 5,
      extras: {
        "client::notification": { click: { url: w.link } },
        "client::display": { contentType: "text/plain" },
      },
    });

    // Webhook: full payload, HMAC over the exact body.
    const hook = request("https://127.0.0.1/hook");
    expect(hook).toBeDefined();
    const [, hookInit] = hook as [string, RequestInit];
    const raw = hookInit.body as string;
    const signature = (hookInit.headers as Record<string, string>)[
      "X-Kaneo-Signature"
    ];
    expect(signature).toBe(
      createHmac("sha256", "whsec-secret").update(raw).digest("hex"),
    );
    expect(JSON.parse(raw)).toEqual({
      notification: {
        id: n.id,
        type: "task_status_changed",
        title: "Task status changed",
        content: "Ship it moved from to-do to done.",
        createdAt: n.createdAt.toISOString(),
        eventData: {
          taskTitle: "Ship it",
          oldStatus: "to-do",
          newStatus: "done",
        },
        resourceId: w.task.id,
        resourceType: "task",
      },
      workspace: { id: w.owner.workspace.id, name: "Acme" },
      project: { id: w.project.id, name: "Apollo" },
      task: { id: w.task.id, title: "Ship it", url: w.link },
      user: { id: w.owner.user.id, email: w.owner.user.email, name: "Ann" },
    });

    // Email.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      w.owner.user.email,
      "Task status changed",
      {
        title: "Task status changed",
        message: "Ship it moved from to-do to done.",
        actionUrl: w.link,
        actionLabel: "Open in Kaneo",
        locale: w.owner.user.locale ?? null,
      },
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("omits optional headers: no ntfy token, no click action, no signature, no extras", async () => {
    const w = await world({ channels: ["ntfy", "gotify", "webhook"] });
    // Remove the secrets the API set, then deliver a workspace notification
    // (it has no task, hence no click URL).
    const { app } = w;
    await put(app, "", { ntfyToken: null, webhookSecret: null });
    const n = await notify(w, {
      type: "workspace_created",
      eventData: { workspaceName: "Acme" },
      resourceType: "workspace",
      resourceId: w.owner.workspace.id,
    });
    await deliverNotification(n.id);
    const ntfyCall = request("https://127.0.0.1:8443/kaneo%20alerts");
    expect(ntfyCall?.[1].headers).toEqual({ Title: "Workspace created" });
    const gotify = request(
      "https://127.0.0.1/gotify/message?token=gotify-secret-token",
    );
    expect(JSON.parse(gotify?.[1].body as string)).toEqual({
      title: "Workspace created",
      message: "Workspace created: Acme",
      priority: 5,
    });
    const hook = request("https://127.0.0.1/hook");
    expect(hook?.[1].headers).toEqual({ "Content-Type": "application/json" });
    const payload = JSON.parse(hook?.[1].body as string);
    expect(payload.project).toBeNull();
    expect(payload.task).toBeNull();
    expect(payload.workspace).toEqual({
      id: w.owner.workspace.id,
      name: "Acme",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("email has no action link for a workspace notification", async () => {
    const w = await world({ channels: ["email"] });
    const n = await notify(w, {
      type: "workspace_member_added",
      eventData: { workspaceName: "Acme", inviterName: "Bob", role: "admin" },
      resourceType: "workspace",
      resourceId: w.owner.workspace.id,
    });
    await deliverNotification(n.id);
    expect(sendEmail).toHaveBeenCalledWith(
      w.owner.user.email,
      "Added to a workspace",
      expect.objectContaining({
        message: "Bob added you to Acme as admin.",
        actionUrl: null,
        actionLabel: undefined,
      }),
    );
  });

  const leadTime = (minutes?: number) => ({
    taskTitle: "Ship it",
    ...(minutes === undefined ? {} : { leadTimeMinutes: minutes }),
  });
  const contentCases: Array<{
    type: string;
    workspace?: boolean;
    eventData: Record<string, unknown>;
    title: string;
    body: string;
  }> = [
    {
      type: "task_created",
      eventData: { taskTitle: "X" },
      title: "New task created",
      body: "A new task was created: X",
    },
    {
      type: "task_created",
      eventData: {},
      title: "New task created",
      body: "A new task was created in Kaneo.",
    },
    {
      type: "workspace_created",
      workspace: true,
      eventData: { workspaceName: "WS" },
      title: "Workspace created",
      body: "Workspace created: WS",
    },
    {
      type: "workspace_created",
      workspace: true,
      eventData: {},
      title: "Workspace created",
      body: "A new workspace was created in Kaneo.",
    },
    {
      type: "workspace_member_added",
      workspace: true,
      eventData: { workspaceName: "WS", inviterName: "Bob", role: "admin" },
      title: "Added to a workspace",
      body: "Bob added you to WS as admin.",
    },
    {
      type: "workspace_member_added",
      workspace: true,
      eventData: { workspaceName: "WS", inviterName: "Bob" },
      title: "Added to a workspace",
      body: "Bob added you to WS.",
    },
    {
      type: "workspace_member_added",
      workspace: true,
      eventData: { workspaceName: "WS" },
      title: "Added to a workspace",
      body: "You were added to a workspace in Kaneo.",
    },
    {
      type: "task_status_changed",
      eventData: { taskTitle: "X", oldStatus: "a", newStatus: "b" },
      title: "Task status changed",
      body: "X moved from a to b.",
    },
    {
      type: "task_status_changed",
      eventData: { taskTitle: "X", oldStatus: "a" },
      title: "Task status changed",
      body: "A task status changed in Kaneo.",
    },
    {
      type: "jira_status_proposal",
      eventData: { issueKey: "K-1", toStatus: "Done", taskTitle: "X" },
      title: "Jira status changed",
      body: 'K-1 is now "Done" (X). Review the proposed status in Kaneo.',
    },
    {
      type: "jira_status_proposal",
      eventData: { issueKey: "K-1", toStatus: "Done" },
      title: "Jira status changed",
      body: 'K-1 is now "Done". Review the proposed status in Kaneo.',
    },
    {
      type: "jira_status_proposal",
      eventData: { issueKey: "K-1" },
      title: "Jira status changed",
      body: "The status of a linked Jira issue changed. Review it in Kaneo.",
    },
    {
      type: "task_assignee_changed",
      eventData: { taskTitle: "X" },
      title: "Task assigned to you",
      body: "You were assigned to X.",
    },
    {
      type: "task_assignee_changed",
      eventData: {},
      title: "Task assigned to you",
      body: "A task was assigned to you in Kaneo.",
    },
    {
      type: "time_entry_created",
      eventData: { taskTitle: "X" },
      title: "Time entry created",
      body: "A time entry was created for X.",
    },
    {
      type: "time_entry_created",
      eventData: {},
      title: "Time entry created",
      body: "A time entry was created in Kaneo.",
    },
    {
      type: "due_date_reminder",
      eventData: leadTime(1440),
      title: "Task due soon",
      body: '"Ship it" is due in 1 day.',
    },
    {
      type: "due_date_reminder",
      eventData: leadTime(2880),
      title: "Task due soon",
      body: '"Ship it" is due in 2 days.',
    },
    {
      type: "due_date_reminder",
      eventData: leadTime(60),
      title: "Task due soon",
      body: '"Ship it" is due in 1 hour.',
    },
    {
      type: "due_date_reminder",
      eventData: leadTime(180),
      title: "Task due soon",
      body: '"Ship it" is due in 3 hours.',
    },
    {
      type: "due_date_reminder",
      eventData: leadTime(90),
      title: "Task due soon",
      body: '"Ship it" is due in 90 minutes.',
    },
    {
      type: "due_date_reminder",
      eventData: leadTime(),
      title: "Task due soon",
      body: '"Ship it" is due soon.',
    },
    {
      type: "due_date_reminder",
      eventData: { leadTimeMinutes: 0 },
      title: "Task due soon",
      body: "A task is due soon.",
    },
    {
      type: "due_date_reminder",
      eventData: { leadTimeMinutes: 1440 },
      title: "Task due soon",
      body: "A task is due in 1 day.",
    },
    {
      type: "task_overdue",
      eventData: { taskTitle: "X" },
      title: "Task overdue",
      body: '"X" is past its due date.',
    },
    {
      type: "task_overdue",
      eventData: {},
      title: "Task overdue",
      body: "A task is past its due date.",
    },
    {
      type: "task_mention",
      eventData: { taskTitle: "X", mentionerName: "Cy" },
      title: "Cy mentioned you",
      body: "You were mentioned in X.",
    },
    {
      type: "task_mention",
      eventData: {},
      title: "You were mentioned",
      body: "You were mentioned in a Kaneo task.",
    },
    {
      type: "task_comment",
      eventData: { taskTitle: "X", commenterName: "Di" },
      title: "Di commented on your task",
      body: "A new comment was added to X.",
    },
    {
      type: "task_comment",
      eventData: {},
      title: "New task comment",
      body: "A new comment was added to a Kaneo task.",
    },
    {
      type: "info",
      eventData: {},
      title: "New Kaneo notification",
      body: "You have a new notification in Kaneo.",
    },
  ];

  it("renders the title and body of every notification type, with and without its data", async () => {
    const w = await world({ channels: ["webhook"] });
    for (const entry of contentCases) {
      fetchMock.mockClear();
      const n = await notify(w, {
        type: entry.type,
        eventData: entry.eventData,
        ...(entry.workspace
          ? { resourceType: "workspace", resourceId: w.owner.workspace.id }
          : {}),
      });
      await deliverNotification(n.id);
      const hook = request("https://127.0.0.1/hook");
      const sent = JSON.parse(hook?.[1].body as string).notification;
      expect(
        { title: sent.title, content: sent.content },
        `${entry.type} ${JSON.stringify(entry.eventData)}`,
      ).toEqual({ title: entry.title, content: entry.body });
    }
  });

  it("prefers a stored title and content and falls back per field for unknown types", async () => {
    const w = await world({ channels: ["webhook"] });
    const sentFor = async (values: Parameters<typeof notify>[1]) => {
      fetchMock.mockClear();
      await deliverNotification((await notify(w, values)).id);
      return JSON.parse(request("https://127.0.0.1/hook")?.[1].body as string)
        .notification;
    };
    const both = await sentFor({ title: "Custom", content: "Body text" });
    expect([both.title, both.content]).toEqual(["Custom", "Body text"]);
    const titleOnly = await sentFor({ type: "info", title: "Only title" });
    expect([titleOnly.title, titleOnly.content]).toEqual([
      "Only title",
      "You have a new notification in Kaneo.",
    ]);
    const contentOnly = await sentFor({ type: "info", content: "Only body" });
    expect([contentOnly.title, contentOnly.content]).toEqual([
      "New Kaneo notification",
      "Only body",
    ]);
    // eventData that is not an object is tolerated.
    const arrayData = await sentFor({
      type: "task_created",
      eventData: ["x"] as unknown as Record<string, unknown>,
    });
    expect(arrayData.title).toBe("New task created");
  });

  describe("gating", () => {
    async function expectSilent(id: string) {
      await deliverNotification(id);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    }

    it("sends nothing for an unknown notification id", async () => {
      await world();
      await expectSilent("no-such-notification");
    });

    it("sends nothing without stored preferences", async () => {
      const w = await world({ channels: [], rule: false });
      await expectSilent((await notify(w)).id);
    });

    it("sends nothing without a workspace rule or with an inactive one", async () => {
      const without = await world({ rule: false });
      await expectSilent((await notify(without)).id);

      await resetTestDatabase();
      const inactive = await world({ rule: { isActive: false } });
      await expectSilent((await notify(inactive)).id);
    });

    it("respects the per-workspace project selection", async () => {
      const other = await world({ rule: false });
      await put(other.app, `/workspaces/${other.owner.workspace.id}`, {
        isActive: true,
        emailEnabled: false,
        ntfyEnabled: false,
        gotifyEnabled: false,
        webhookEnabled: true,
        projectMode: "selected",
        selectedProjectIds: [other.otherProject.id],
      });
      // The task lives in a project that is not selected.
      await expectSilent((await notify(other)).id);

      await put(other.app, `/workspaces/${other.owner.workspace.id}`, {
        isActive: true,
        emailEnabled: false,
        ntfyEnabled: false,
        gotifyEnabled: false,
        webhookEnabled: true,
        projectMode: "selected",
        selectedProjectIds: [other.project.id],
      });
      await deliverNotification((await notify(other)).id);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(request("https://127.0.0.1/hook")).toBeDefined();
    });

    it("a selected-mode rule never matches a workspace notification (no project)", async () => {
      const w = await world({ rule: false });
      await put(w.app, `/workspaces/${w.owner.workspace.id}`, {
        isActive: true,
        emailEnabled: false,
        ntfyEnabled: false,
        gotifyEnabled: false,
        webhookEnabled: true,
        projectMode: "selected",
        selectedProjectIds: [w.project.id],
      });
      await expectSilent(
        (
          await notify(w, {
            type: "workspace_created",
            eventData: {},
            resourceType: "workspace",
            resourceId: w.owner.workspace.id,
          })
        ).id,
      );
    });

    it("skips a channel that the rule or the global setting has off", async () => {
      const w = await world();
      const [rule] = await db
        .select()
        .from(schema.userNotificationWorkspaceRuleTable);
      // Rule switches ntfy off; the global switch for gotify is turned off
      // directly in the database (the API would cascade it into the rule).
      await db
        .update(schema.userNotificationWorkspaceRuleTable)
        .set({ ntfyEnabled: false })
        .where(
          eq(schema.userNotificationWorkspaceRuleTable.id, rule?.id ?? ""),
        );
      await db
        .update(schema.userNotificationPreferenceTable)
        .set({ gotifyEnabled: false, emailEnabled: false });
      await deliverNotification((await notify(w)).id);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(request("https://127.0.0.1/hook")).toBeDefined();
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("sends nothing once the user lost access to the task's project", async () => {
      const w = await world();
      const n = await notify(w);
      await db
        .delete(schema.projectMemberTable)
        .where(
          and(
            eq(schema.projectMemberTable.projectId, w.project.id),
            eq(schema.projectMemberTable.userId, w.owner.user.id),
          ),
        );
      // The owner keeps full access through the workspace role, so demote.
      await db
        .update(schema.workspaceUserTable)
        .set({ role: "member" })
        .where(eq(schema.workspaceUserTable.userId, w.owner.user.id));
      await expectSilent(n.id);
    });

    it("sends nothing when the task was deleted or the user left the workspace", async () => {
      const w = await world();
      const n = await notify(w);
      await db
        .delete(schema.taskTable)
        .where(eq(schema.taskTable.id, w.task.id));
      await expectSilent(n.id);

      await resetTestDatabase();
      const w2 = await world();
      const workspaceNotification = await notify(w2, {
        type: "workspace_created",
        eventData: {},
        resourceType: "workspace",
        resourceId: w2.owner.workspace.id,
      });
      await db
        .delete(schema.workspaceUserTable)
        .where(eq(schema.workspaceUserTable.userId, w2.owner.user.id));
      await expectSilent(workspaceNotification.id);
    });

    it("sends nothing for an unsupported resource type and logs an unresolved context", async () => {
      const w = await world();
      await expectSilent(
        (await notify(w, { resourceType: "comment", resourceId: "c1" })).id,
      );
      // A task notification without a resource id is not receivable either.
      await expectSilent((await notify(w, { resourceId: null })).id);

      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const noResource = await notify(w, {
        type: "info",
        resourceType: null,
        resourceId: null,
      });
      await expectSilent(noResource.id);
      expect(info).toHaveBeenCalledWith(
        "Notification delivery skipped: unresolved context",
        expect.objectContaining({
          notificationId: noResource.id,
          resourceType: null,
          resourceId: null,
        }),
      );
    });
  });

  describe("failures of the outbound services", () => {
    it("one failing channel never blocks the others and no secret is logged", async () => {
      const w = await world();
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      fetchMock.mockImplementation(async (url: string) => {
        if (String(url).startsWith("https://127.0.0.1:8443/")) {
          return new Response("denied", { status: 500 });
        }
        if (String(url).startsWith("https://127.0.0.1/gotify/")) {
          throw new TypeError(`connect ECONNREFUSED ${url}`);
        }
        return new Response("ok");
      });
      sendEmail.mockRejectedValue(new Error("SMTP password=hunter2 rejected"));
      const n = await notify(w);
      await expect(deliverNotification(n.id)).resolves.toBeUndefined();

      expect(request("https://127.0.0.1/hook")).toBeDefined();
      const logged = errors.mock.calls.filter(
        ([message]) => message === "Notification delivery failed",
      );
      expect(
        logged
          .map(([, details]) => (details as { error: string }).error)
          .sort(),
      ).toEqual([
        "Outbound request failed",
        "Outbound request failed: http (HTTP 500)",
        "Outbound request failed: network",
      ]);
      for (const [, details] of logged) {
        expect((details as { notificationId: string }).notificationId).toBe(
          n.id,
        );
      }
      const serialized = JSON.stringify(errors.mock.calls);
      for (const secret of [
        "ntfy-secret-token",
        "gotify-secret-token",
        "whsec-secret",
        "hunter2",
      ]) {
        expect(serialized).not.toContain(secret);
      }
    });

    it("revalidates the destination at delivery time and refuses a private one", async () => {
      const w = await world({ channels: ["webhook", "ntfy"] });
      vi.spyOn(console, "error").mockImplementation(() => {});
      // The address was acceptable when saved; private ones are now refused.
      vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      await deliverNotification((await notify(w)).id);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        errors.mock.calls.map(([, d]) => (d as { error: string }).error),
      ).toEqual([
        "Outbound request failed: destination",
        "Outbound request failed: destination",
      ]);
    });

    it("fails closed when a stored secret cannot be decrypted", async () => {
      const w = await world();
      vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "rotated-key");
      await expect(deliverNotification((await notify(w)).id)).rejects.toThrow(
        "Failed to decrypt notification secret",
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("characterization: a non-Latin-1 title cannot be sent as an ntfy header", async () => {
      const w = await world({ channels: ["ntfy", "webhook"] });
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      // Like undici, reject header values that are not ByteStrings.
      fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
        new Headers(init.headers);
        return new Response("ok");
      });
      await deliverNotification(
        (
          await notify(w, {
            title: "Zażółć gęślą jaźń",
            content: "Polish title",
            type: "info",
          })
        ).id,
      );
      // The webhook channel still delivers; the ntfy one reports a network
      // failure. Whether ntfy titles should be encoded is an open question.
      expect(request("https://127.0.0.1/hook")).toBeDefined();
      expect(
        errors.mock.calls.map(([, d]) => (d as { error: string }).error),
      ).toEqual(["Outbound request failed: network"]);
    });
  });
});
