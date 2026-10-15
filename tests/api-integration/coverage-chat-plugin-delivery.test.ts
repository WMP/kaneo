import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import * as discordEvents from "../../apps/api/src/plugins/discord/events";
import * as genericEvents from "../../apps/api/src/plugins/generic-webhook/events";
import * as mattermostEvents from "../../apps/api/src/plugins/mattermost/events";
import * as slackEvents from "../../apps/api/src/plugins/slack/events";
import * as telegramEvents from "../../apps/api/src/plugins/telegram/events";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const slackUrl =
  "https://hooks.slack.com/services/T00000000/B00000000/abcd1234SECRETTAILwxyz9876";
const discordUrl =
  "https://discord.com/api/webhooks/123456789/tokenABCDEFGHIJKLMNOP";
const mattermostUrl = "https://127.0.0.1/hooks/mattermost-secret-token";
const botToken = "123456789:ABCD0123456789abcdefghijklmnopqWXYZ";
const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
const clientUrl = "https://kaneo.test";

type Handlers = {
  handleTaskCreated: (e: never, c: never) => Promise<void>;
  handleTaskStatusChanged: (e: never, c: never) => Promise<void>;
  handleTaskPriorityChanged: (e: never, c: never) => Promise<void>;
  handleTaskTitleChanged: (e: never, c: never) => Promise<void>;
  handleTaskDescriptionChanged: (e: never, c: never) => Promise<void>;
  handleTaskCommentCreated: (e: never, c: never) => Promise<void>;
};

type ChatSpec = {
  name: string;
  handlers: Handlers;
  config: Record<string, unknown>;
  url: string;
  bold: (text: string) => string;
  parse: (body: Record<string, never>) => { headline: string; body: string };
};

const specs: ChatSpec[] = [
  {
    name: "Slack",
    handlers: slackEvents as unknown as Handlers,
    config: { webhookUrl: slackUrl },
    url: slackUrl,
    bold: (text) => `*${text}*`,
    parse: (body) => {
      const text: string = body.blocks[0].text.text;
      const newline = text.indexOf("\n");
      return {
        headline: text.slice(1, newline - 1),
        body: text.slice(newline + 1),
      };
    },
  },
  {
    name: "Discord",
    handlers: discordEvents as unknown as Handlers,
    config: { webhookUrl: discordUrl },
    url: discordUrl,
    bold: (text) => `**${text}**`,
    parse: (body) => ({
      headline: body.embeds[0].title,
      body: body.embeds[0].description,
    }),
  },
  {
    name: "Mattermost",
    handlers: mattermostEvents as unknown as Handlers,
    config: { webhookUrl: mattermostUrl },
    url: mattermostUrl,
    bold: (text) => text,
    parse: (body) => ({
      headline: String(body.text).split(": ")[0] as string,
      body: body.attachments[0].text,
    }),
  },
  {
    name: "Telegram",
    handlers: telegramEvents as unknown as Handlers,
    config: { botToken, chatId: "-100123", threadId: 7 },
    url: telegramUrl,
    bold: (text) => text,
    parse: (body) => {
      const lines = String(body.text).split("\n");
      return {
        headline: (lines[0] as string).replace(/^<b>|<\/b>$/g, ""),
        body: lines[1] as string,
      };
    },
  },
];

const allEvents = {
  taskCreated: true,
  taskStatusChanged: true,
  taskPriorityChanged: true,
  taskTitleChanged: true,
  taskDescriptionChanged: true,
  taskCommentCreated: true,
};

const fetchMock = vi.fn();

function sentBodies() {
  return fetchMock.mock.calls.map(([, init]) =>
    JSON.parse((init as { body: string }).body),
  );
}

async function fixture(title = "Ship it") {
  const owner = await createWorkspaceMember({
    role: "owner",
    userName: "Ann <Admin>",
    workspaceName: "Acme",
  });
  const { project, columns } = await createProjectFixture({
    workspaceId: owner.workspace.id,
    name: "Apollo & Co",
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      columnId: columns.inProgress.id,
      title,
      number: 7,
      status: "in-progress",
      priority: "high",
      userId: owner.user.id,
    })
    .returning();
  if (!task) throw new Error("task not created");
  const base = {
    taskId: task.id,
    projectId: project.id,
    userId: owner.user.id,
  };
  const context = (config: Record<string, unknown>) => ({
    integrationId: "integration-1",
    projectId: project.id,
    config,
  });
  return { owner, project, columns, task, base, context };
}

beforeEach(async () => {
  await resetTestDatabase();
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async (url: string) =>
      new Response(
        String(url).startsWith("https://api.telegram.org/")
          ? JSON.stringify({ ok: true })
          : "ok",
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
  vi.stubEnv("KANEO_CLIENT_URL", clientUrl);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each(specs)("API integration: $name plugin delivery", (spec) => {
  const h = spec.handlers;
  const bold = spec.bold;

  it("posts every enabled event to its own destination with the documented message", async () => {
    const { base, context } = await fixture();
    const ctx = context({ ...spec.config, events: allEvents }) as never;
    const description200 = "d".repeat(200);
    const cases: Array<{
      run: () => Promise<void>;
      headline: string;
      body: string;
    }> = [
      {
        run: () =>
          h.handleTaskCreated(
            {
              ...base,
              title: "Ship it",
              description: null,
              priority: "low",
              status: "to-do",
              number: 7,
            } as never,
            ctx,
          ),
        headline: "New task created",
        body: `A new task was added: ${bold("Ship it")}`,
      },
      {
        run: () =>
          h.handleTaskStatusChanged(
            {
              ...base,
              title: "Ship it",
              oldStatus: "to-do",
              newStatus: "in-progress",
            } as never,
            ctx,
          ),
        headline: "Task status changed",
        body: `${bold("Ship it")} moved from ${bold("To Do")} to ${bold("In Progress")}.`,
      },
      {
        run: () =>
          h.handleTaskPriorityChanged(
            {
              ...base,
              title: "Ship it",
              oldPriority: "low",
              newPriority: "urgent",
            } as never,
            ctx,
          ),
        headline: "Task priority changed",
        body: `${bold("Ship it")} changed from ${bold("Low")} to ${bold("Urgent")}.`,
      },
      {
        run: () =>
          h.handleTaskTitleChanged(
            {
              ...base,
              oldTitle: "a".repeat(130),
              newTitle: "New name",
            } as never,
            ctx,
          ),
        headline: "Task title changed",
        body: `Task renamed from ${bold(`${"a".repeat(119)}…`)} to ${bold("New name")}.`,
      },
      {
        run: () =>
          h.handleTaskDescriptionChanged(
            {
              ...base,
              oldDescription: null,
              newDescription: "line one\n\n  line   two",
            } as never,
            ctx,
          ),
        headline: "Task description changed",
        body: "The task description was updated: line one line two",
      },
      {
        run: () =>
          h.handleTaskDescriptionChanged(
            {
              ...base,
              oldDescription: "x",
              newDescription: description200,
            } as never,
            ctx,
          ),
        headline: "Task description changed",
        body: `The task description was updated: ${"d".repeat(159)}…`,
      },
      {
        run: () =>
          h.handleTaskDescriptionChanged(
            { ...base, oldDescription: "x", newDescription: null } as never,
            ctx,
          ),
        headline: "Task description changed",
        body: "The task description was updated.",
      },
      {
        run: () =>
          h.handleTaskCommentCreated(
            { ...base, comment: "first\nsecond   third" } as never,
            ctx,
          ),
        headline: "New task comment",
        body: "first second third",
      },
      {
        run: () =>
          h.handleTaskCommentCreated(
            { ...base, comment: "c".repeat(250) } as never,
            ctx,
          ),
        headline: "New task comment",
        body: `${"c".repeat(199)}…`,
      },
    ];

    for (const [index, entry] of cases.entries()) {
      await entry.run();
      expect(fetchMock).toHaveBeenCalledTimes(index + 1);
      const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
      expect(url).toBe(spec.url);
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );
      const parsed = spec.parse(sentBodies()[index]);
      expect(parsed).toEqual({ headline: entry.headline, body: entry.body });
    }
  });

  it("stays silent for events that are off by default or switched off", async () => {
    const { base, context } = await fixture();
    const defaults = context(spec.config) as never;
    // Off by default.
    await h.handleTaskPriorityChanged(
      { ...base, title: "t", oldPriority: "low", newPriority: "high" } as never,
      defaults,
    );
    await h.handleTaskTitleChanged(
      { ...base, oldTitle: "a", newTitle: "b" } as never,
      defaults,
    );
    await h.handleTaskDescriptionChanged(
      { ...base, oldDescription: null, newDescription: "x" } as never,
      defaults,
    );
    // Switched off although normally on.
    const off = context({
      ...spec.config,
      events: {
        taskCreated: false,
        taskStatusChanged: false,
        taskCommentCreated: false,
      },
    }) as never;
    await h.handleTaskCreated(
      {
        ...base,
        title: "t",
        description: null,
        priority: "low",
        status: "to-do",
        number: 1,
      } as never,
      off,
    );
    await h.handleTaskStatusChanged(
      { ...base, title: "t", oldStatus: "a", newStatus: "b" } as never,
      off,
    );
    await h.handleTaskCommentCreated(
      { ...base, comment: "hello" } as never,
      off,
    );
    expect(fetchMock).not.toHaveBeenCalled();

    // The defaults that are on do deliver.
    await h.handleTaskStatusChanged(
      { ...base, title: "t", oldStatus: "a", newStatus: "b" } as never,
      defaults,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("delivers nothing for a deleted task or a task of another project", async () => {
    const { base, context, task, owner } = await fixture();
    const { project: other } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const ctx = context({ ...spec.config, events: allEvents }) as never;
    const status = (event: Record<string, unknown>) =>
      h.handleTaskStatusChanged(
        { title: "t", oldStatus: "a", newStatus: "b", ...event } as never,
        ctx,
      );

    await status({ ...base, projectId: other.id });
    await status({ ...base, taskId: "no-such-task" });
    await db.delete(schema.taskTable).where(eq(schema.taskTable.id, task.id));
    await status(base);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to Kaneo when there is no actor or the actor is unknown", async () => {
    const { base, context } = await fixture();
    const ctx = context({ ...spec.config, events: allEvents }) as never;
    const event = { title: "t", oldStatus: "a", newStatus: "b" };
    await h.handleTaskStatusChanged(
      { ...base, ...event, userId: null } as never,
      ctx,
    );
    await h.handleTaskStatusChanged(
      { ...base, ...event, userId: "ghost-user" } as never,
      ctx,
    );
    const [withoutActor, unknownActor] = sentBodies().map((body) =>
      JSON.stringify(body),
    );
    for (const serialized of [withoutActor, unknownActor]) {
      expect(serialized).toContain("Kaneo");
      expect(serialized).not.toContain("Ann");
    }
  });
});

describe("API integration: Slack payload", () => {
  it("builds escaped blocks with a task link, status, priority and actor", async () => {
    const { base, context, task, project, owner } =
      await fixture(`Fix <login> & "ship"`);
    await slackEvents.handleTaskStatusChanged(
      {
        ...base,
        title: `Fix <login> & "ship"`,
        oldStatus: "to-do",
        newStatus: "in-progress",
      },
      context({ webhookUrl: slackUrl }),
    );
    const link = `${clientUrl}/dashboard/workspace/${owner.workspace.id}/project/${project.id}/task/${task.id}`;
    expect(sentBodies()).toEqual([
      {
        text: `Task status changed: Fix <login> & "ship"`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Task status changed*\n*Fix &lt;login&gt; &amp; "ship"* moved from *To Do* to *In Progress*.`,
            },
            fields: [
              {
                type: "mrkdwn",
                text: `*Task*\n<${link}|#7 Fix &lt;login&gt; &amp; "ship">`,
              },
              { type: "mrkdwn", text: "*Project*\nApollo &amp; Co" },
              { type: "mrkdwn", text: "*Status*\nIn Progress" },
              { type: "mrkdwn", text: "*Priority*\nHigh" },
            ],
          },
          {
            type: "context",
            elements: [
              { type: "mrkdwn", text: "Triggered by Ann &lt;Admin&gt;" },
            ],
          },
        ],
      },
    ]);
  });
});

describe("API integration: Discord payload", () => {
  it("builds an embed with the column name, neutralised mentions and a redacted failure log", async () => {
    const { base, context, task, project, owner } = await fixture("Ship it");
    await discordEvents.handleTaskCommentCreated(
      {
        ...base,
        comment:
          "ping @everyone and @here and <@123456> and <#99> <:smile:42> <a:wave:43> <@&77>",
      },
      context({ webhookUrl: discordUrl }),
    );
    const link = `${clientUrl}/dashboard/workspace/${owner.workspace.id}/project/${project.id}/task/${task.id}`;
    const z = "​";
    expect(sentBodies()).toEqual([
      {
        content: "New task comment: #7 Ship it",
        embeds: [
          {
            title: "New task comment",
            description: `ping @${z}everyone and @${z}here and <@${z}123456> and <#${z}99> <:${z}smile:42> <a:${z}wave:43> <@${z}&77>`,
            url: link,
            color: 0x5865f2,
            fields: [
              { name: "Task", value: `[#7 Ship it](${link})`, inline: true },
              { name: "Project", value: "Apollo & Co", inline: true },
              { name: "Status", value: "In Progress", inline: true },
              { name: "Priority", value: "High", inline: true },
            ],
            footer: { text: "Triggered by Ann <Admin>" },
          },
        ],
      },
    ]);
  });

  it("uses the status slug when the task has no column", async () => {
    const { base, context, task } = await fixture("Ship it");
    await db
      .update(schema.taskTable)
      .set({ columnId: null, status: "in-review" })
      .where(eq(schema.taskTable.id, task.id));
    await discordEvents.handleTaskCreated(
      {
        ...base,
        title: "Ship it",
        description: null,
        priority: "low",
        status: "in-review",
        number: 7,
      },
      context({ webhookUrl: discordUrl }),
    );
    expect(sentBodies()[0].embeds[0].fields[2]).toEqual({
      name: "Status",
      value: "In Review",
      inline: true,
    });
  });

  it("swallows an upstream failure and logs only a redacted webhook URL", async () => {
    const { base, context } = await fixture();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(
      discordEvents.handleTaskCreated(
        {
          ...base,
          title: "t",
          description: null,
          priority: "low",
          status: "to-do",
          number: 1,
        },
        context({ webhookUrl: discordUrl, channelName: "general" }),
      ),
    ).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).toContain(
      "https://discord.com/api/webhooks/123456789/to…MNOP",
    );
    const [, details] = errors.mock.calls[0] as [string, { error: Error }];
    expect(details.error.message).toBe(
      "Discord webhook request failed (500): nope",
    );
    expect(logged).not.toContain("tokenABCDEFGHIJKLMNOP");
  });

  it("redacts short tokens and unparseable URLs completely", async () => {
    const { base, context } = await fixture();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    for (const webhookUrl of [
      "https://discord.com/api/webhooks/1/short",
      "not a url",
    ]) {
      await discordEvents.handleTaskCreated(
        {
          ...base,
          title: "t",
          description: null,
          priority: "low",
          status: "to-do",
          number: 1,
        },
        context({ webhookUrl }),
      );
    }
    const logs = errors.mock.calls.map((call) => JSON.stringify(call));
    expect(logs[0]).toContain("https://discord.com/api/webhooks/1/redacted");
    expect(logs[0]).not.toContain("/short");
    expect(logs[1]).toContain('"webhookUrl":"redacted"');
  });
});

describe("API integration: Mattermost and Slack failures", () => {
  it("Mattermost builds an attachment and rejects on an upstream error", async () => {
    const { base, context, task, project, owner } = await fixture("A <b> & c");
    await mattermostEvents.handleTaskStatusChanged(
      { ...base, title: "A <b> & c", oldStatus: "to-do", newStatus: "done" },
      context({ webhookUrl: mattermostUrl }),
    );
    const link = `${clientUrl}/dashboard/workspace/${owner.workspace.id}/project/${project.id}/task/${task.id}`;
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("error");
    expect(sentBodies()).toEqual([
      {
        text: "Task status changed: A <b> & c",
        attachments: [
          {
            color: "#4f46e5",
            title: "#7 A &lt;b&gt; &amp; c",
            title_link: link,
            text: "A &lt;b&gt; &amp; c moved from To Do to Done.",
            fields: [
              { title: "Project", value: "Apollo &amp; Co", short: true },
              { title: "Status", value: "In Progress", short: true },
              { title: "Priority", value: "High", short: true },
              {
                title: "Triggered by",
                value: "Ann &lt;Admin&gt;",
                short: true,
              },
            ],
          },
        ],
      },
    ]);

    fetchMock.mockResolvedValue(new Response("denied", { status: 403 }));
    await expect(
      mattermostEvents.handleTaskStatusChanged(
        { ...base, title: "t", oldStatus: "a", newStatus: "b" },
        context({ webhookUrl: mattermostUrl }),
      ),
    ).rejects.toThrow("Mattermost webhook request failed (403): denied");
  });

  it("Mattermost refuses to post to a private destination before any request", async () => {
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
    const { base, context } = await fixture();
    await expect(
      mattermostEvents.handleTaskStatusChanged(
        { ...base, title: "t", oldStatus: "a", newStatus: "b" },
        context({ webhookUrl: "https://127.0.0.1/hooks/x" }),
      ),
    ).rejects.toThrow("non-routable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Slack rejects with the upstream status and body", async () => {
    const { base, context } = await fixture();
    fetchMock.mockResolvedValue(new Response("invalid_token", { status: 404 }));
    await expect(
      slackEvents.handleTaskStatusChanged(
        { ...base, title: "t", oldStatus: "a", newStatus: "b" },
        context({ webhookUrl: slackUrl }),
      ),
    ).rejects.toThrow("Slack webhook request failed (404): invalid_token");
  });
});

describe("API integration: Telegram payload", () => {
  it("builds an HTML message with a thread id, escaped text and a task link", async () => {
    const { base, context, task, project, owner } = await fixture("A <b> & c");
    await telegramEvents.handleTaskStatusChanged(
      { ...base, title: "A <b> & c", oldStatus: "to-do", newStatus: "done" },
      context({ botToken, chatId: "-100123", threadId: 7 }),
    );
    const link = `${clientUrl}/dashboard/workspace/${owner.workspace.id}/project/${project.id}/task/${task.id}`;
    expect(fetchMock.mock.calls[0]?.[0]).toBe(telegramUrl);
    expect(sentBodies()).toEqual([
      {
        chat_id: "-100123",
        parse_mode: "HTML",
        disable_web_page_preview: false,
        message_thread_id: 7,
        text: [
          "<b>Task status changed</b>",
          "A &lt;b&gt; &amp; c moved from To Do to Done.",
          "",
          `<b>Task:</b> <a href="${link}">#7 A &lt;b&gt; &amp; c</a>`,
          "<b>Project:</b> Apollo &amp; Co",
          "<b>Status:</b> In Progress",
          "<b>Priority:</b> High",
          "<b>Triggered by:</b> Ann &lt;Admin&gt;",
        ].join("\n"),
      },
    ]);
  });

  it("omits the link without a usable client URL and the thread id when none is set", async () => {
    const { base, context } = await fixture("Ship it");
    for (const value of ["", "not a url"]) {
      vi.stubEnv("KANEO_CLIENT_URL", value);
      await telegramEvents.handleTaskCreated(
        {
          ...base,
          title: "Ship it",
          description: null,
          priority: "low",
          status: "to-do",
          number: 7,
        },
        context({ botToken, chatId: "5" }),
      );
    }
    for (const body of sentBodies()) {
      expect(body.text).toContain("<b>Task:</b> #7 Ship it\n");
      expect(body.text).not.toContain("<a href");
      expect(body).not.toHaveProperty("message_thread_id");
      expect(body.chat_id).toBe("5");
    }
  });

  it("skips dispatch for an invalid config and logs no credential", async () => {
    const { base, context } = await fixture();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await telegramEvents.handleTaskCreated(
      {
        ...base,
        title: "t",
        description: null,
        priority: "low",
        status: "to-do",
        number: 1,
      },
      context({ botToken: "not-a-token", chatId: "5" }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      "Invalid Telegram plugin config; skipping event dispatch",
      expect.objectContaining({
        reason: "Invalid configuration",
        featureKey: "taskCreated",
        projectId: base.projectId,
        taskId: base.taskId,
      }),
    );
    expect(JSON.stringify(errors.mock.calls)).not.toContain("not-a-token");
  });

  it.each([
    ["an HTTP error", () => new Response("x", { status: 502 }), "http"],
    [
      "a response that is not ok:true",
      () => new Response(JSON.stringify({ ok: false })),
      "response",
    ],
    ["a body that is not JSON", () => new Response("<html>"), "response"],
    [
      "an oversized body",
      () => new Response(JSON.stringify({ ok: true, pad: "x".repeat(20_000) })),
      "response",
    ],
  ])(
    "swallows %s and logs a hashed target, never the token or chat id",
    async (_name, response, reason) => {
      const { base, context } = await fixture();
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      fetchMock.mockImplementation(async () => response());
      await expect(
        telegramEvents.handleTaskCreated(
          {
            ...base,
            title: "t",
            description: null,
            priority: "low",
            status: "to-do",
            number: 1,
          },
          context({ botToken, chatId: "-100123456", threadId: 7 }),
        ),
      ).resolves.toBeUndefined();
      expect(errors).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(errors.mock.calls);
      expect(logged).toContain(`Outbound request failed: ${reason}`);
      expect(logged).toMatch(/tg:[0-9a-f]{12}/);
      expect(logged).not.toContain(botToken);
      expect(logged).not.toContain("-100123456");
    },
  );

  it("swallows a network error without leaking the token", async () => {
    const { base, context } = await fixture();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(
      new TypeError(`connect ECONNREFUSED ${telegramUrl}`),
    );
    await telegramEvents.handleTaskCreated(
      {
        ...base,
        title: "t",
        description: null,
        priority: "low",
        status: "to-do",
        number: 1,
      },
      context({ botToken, chatId: "5" }),
    );
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).toContain("Outbound request failed: network");
    expect(logged).not.toContain(botToken);
  });
});

describe("API integration: generic webhook delivery", () => {
  const url = "https://127.0.0.1/hooks/receiver";

  async function withIntegration(
    overrides: Record<string, unknown> = {},
    secret?: string,
  ) {
    const f = await fixture("Ship it");
    const config = {
      webhookUrl: url,
      ...(secret ? { secret } : {}),
      events: { ...genericAll, ...overrides },
    };
    await db.insert(schema.integrationTable).values({
      projectId: f.project.id,
      type: "generic-webhook",
      config: JSON.stringify(config),
      isActive: true,
    });
    return { ...f, config };
  }

  const genericAll = {
    taskCreated: true,
    taskStatusChanged: true,
    taskPriorityChanged: true,
    taskTitleChanged: true,
    taskDescriptionChanged: true,
    taskCommentCreated: true,
    taskDeleted: true,
    taskMoved: true,
    taskDueDateChanged: true,
    taskAssigneeChanged: true,
    taskUnassigned: true,
    dueDateReminder: true,
  };

  async function storedHealth(projectId: string) {
    const [row] = await db
      .select()
      .from(schema.integrationTable)
      .where(eq(schema.integrationTable.projectId, projectId));
    return JSON.parse(row?.config ?? "{}").health as
      | Record<string, unknown>
      | undefined;
  }

  it("signs the exact body with HMAC-SHA256 and records success health without the URL", async () => {
    const { base, context, config, project, task, owner } =
      await withIntegration({}, "topsecret");
    await genericEvents.handleTaskStatusChanged(
      { ...base, title: "Ship it", oldStatus: "to-do", newStatus: "done" },
      context(config),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(url);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      event: "task.status_changed",
      integration: { type: "generic-webhook" },
      project: {
        id: project.id,
        name: "Apollo & Co",
        workspaceId: owner.workspace.id,
      },
      task: {
        id: task.id,
        number: 7,
        title: "Ship it",
        status: "in-progress",
        statusName: "In Progress",
        priority: "high",
        url: `${clientUrl}/dashboard/workspace/${owner.workspace.id}/project/${project.id}/task/${task.id}`,
      },
      actor: { id: owner.user.id, name: "Ann <Admin>" },
      data: { title: "Ship it", oldStatus: "to-do", newStatus: "done" },
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    const { createHmac } = await import("node:crypto");
    expect((init.headers as Record<string, string>)["X-Kaneo-Signature"]).toBe(
      createHmac("sha256", "topsecret")
        .update(init.body as string)
        .digest("hex"),
    );
    expect(init).toMatchObject({ method: "POST", redirect: "error" });

    await vi.waitFor(async () => {
      expect(await storedHealth(project.id)).toMatchObject({
        lastAttempt: {
          eventName: "task.status_changed",
          taskId: task.id,
          projectId: project.id,
          webhookUrl: "configured destination",
        },
        lastSuccessAt: expect.any(String),
      });
    });
  });

  it("sends no signature header without a secret", async () => {
    const { base, context, config } = await withIntegration();
    await genericEvents.handleTaskCreated(
      {
        ...base,
        title: "Ship it",
        description: "d",
        priority: "high",
        status: "to-do",
        number: 7,
      },
      context(config),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string).data).toEqual({
      title: "Ship it",
      description: "d",
      priority: "high",
      status: "to-do",
      number: 7,
    });
  });

  it("records failure health, counts repeated failures and clears the message on recovery", async () => {
    const { base, context, config, project } = await withIntegration();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockImplementation(
      async () => new Response("x", { status: 500 }),
    );
    const event = { ...base, title: "Ship it", oldStatus: "a", newStatus: "b" };
    await genericEvents.handleTaskStatusChanged(event, context(config));
    await vi.waitFor(async () =>
      expect((await storedHealth(project.id))?.failureCount).toBe(1),
    );
    await genericEvents.handleTaskStatusChanged(event, context(config));
    await vi.waitFor(async () =>
      expect((await storedHealth(project.id))?.failureCount).toBe(2),
    );
    expect(await storedHealth(project.id)).toMatchObject({
      lastFailureMessage: "Outbound request failed: http (HTTP 500)",
      lastFailureAt: expect.any(String),
    });
    expect(JSON.stringify(errors.mock.calls)).not.toContain(url);

    fetchMock.mockImplementation(async () => new Response("ok"));
    await genericEvents.handleTaskStatusChanged(event, context(config));
    await vi.waitFor(async () =>
      expect((await storedHealth(project.id))?.lastSuccessAt).toEqual(
        expect.any(String),
      ),
    );
    const health = await storedHealth(project.id);
    expect(health?.lastFailureMessage).toBeUndefined();
    expect(health?.failureCount).toBe(2);
  });

  it("reports a network error and a refused private destination as safe messages", async () => {
    const { base, context, config, project } = await withIntegration();
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError(`ECONNRESET ${url}`));
    const event = { ...base, title: "Ship it", oldStatus: "a", newStatus: "b" };
    await genericEvents.handleTaskStatusChanged(event, context(config));
    await vi.waitFor(async () =>
      expect((await storedHealth(project.id))?.lastFailureMessage).toBe(
        "Outbound request failed: network",
      ),
    );
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
    fetchMock.mockClear();
    await genericEvents.handleTaskStatusChanged(event, context(config));
    await vi.waitFor(async () =>
      expect((await storedHealth(project.id))?.lastFailureMessage).toBe(
        "Outbound request failed: destination",
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a corrupt stored config only logs the health update failure and still delivers", async () => {
    const { base, context, config, project } = await withIntegration();
    await db
      .update(schema.integrationTable)
      .set({ config: "{broken" })
      .where(eq(schema.integrationTable.projectId, project.id));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await genericEvents.handleTaskStatusChanged(
      { ...base, title: "Ship it", oldStatus: "a", newStatus: "b" },
      context(config),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith("persistWebhookHealth failed", {
        error: "Webhook health update failed",
        projectId: project.id,
      }),
    );
  });

  it("does not fail when the integration row is gone while recording health", async () => {
    const { base, context, config, project } = await withIntegration();
    await db
      .delete(schema.integrationTable)
      .where(eq(schema.integrationTable.projectId, project.id));
    await genericEvents.handleTaskStatusChanged(
      { ...base, title: "Ship it", oldStatus: "a", newStatus: "b" },
      context(config),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Nothing to update and nothing thrown; the table stays empty.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await db.select().from(schema.integrationTable)).toHaveLength(0);
  });

  it("delivers every remaining event type with its payload", async () => {
    const { base, context, config, project } = await withIntegration();
    const ctx = context(config);
    const due = new Date("2030-01-02T03:04:05.000Z");
    await genericEvents.handleTaskPriorityChanged(
      { ...base, title: "Ship it", oldPriority: "low", newPriority: "urgent" },
      ctx,
    );
    await genericEvents.handleTaskTitleChanged(
      { ...base, oldTitle: "Old", newTitle: "New" },
      ctx,
    );
    await genericEvents.handleTaskDescriptionChanged(
      { ...base, oldDescription: null, newDescription: "text" },
      ctx,
    );
    await genericEvents.handleTaskCommentCreated(
      { ...base, comment: "a comment" },
      ctx,
    );
    await genericEvents.handleTaskMoved(
      {
        ...base,
        fromProjectId: "p-from",
        fromProjectName: "From",
        toProjectId: project.id,
        toProjectName: "To",
        oldStatus: "to-do",
        newStatus: "done",
      },
      ctx,
    );
    await genericEvents.handleTaskDueDateChanged(
      { ...base, title: "Ship it", oldDueDate: null, newDueDate: due },
      ctx,
    );
    await genericEvents.handleTaskAssigneeChanged(
      {
        ...base,
        title: "Ship it",
        oldAssignee: "user-old",
        newAssignee: "New Person",
        newAssigneeId: "user-new",
      },
      ctx,
    );
    await genericEvents.handleTaskAssigneeChanged(
      {
        ...base,
        title: "Ship it",
        oldAssignee: null,
        newAssignee: undefined,
        newAssigneeId: "user-new",
      },
      ctx,
    );
    await genericEvents.handleTaskUnassigned(
      { ...base, title: "Ship it" },
      ctx,
    );
    const bodies = sentBodies();
    expect(bodies.map((b) => [b.event, b.data])).toEqual([
      [
        "task.priority_changed",
        { title: "Ship it", oldPriority: "low", newPriority: "urgent" },
      ],
      ["task.title_changed", { oldTitle: "Old", newTitle: "New" }],
      [
        "task.description_changed",
        { oldDescription: null, newDescription: "text" },
      ],
      ["task.comment_created", { comment: "a comment" }],
      [
        "task.moved",
        {
          fromProjectId: "p-from",
          fromProjectName: "From",
          toProjectId: project.id,
          toProjectName: "To",
          oldStatus: "to-do",
          newStatus: "done",
        },
      ],
      [
        "task.due_date_changed",
        {
          title: "Ship it",
          oldDueDate: null,
          newDueDate: "2030-01-02T03:04:05.000Z",
        },
      ],
      [
        "task.assignee_changed",
        {
          title: "Ship it",
          oldAssigneeId: "user-old",
          newAssigneeId: "user-new",
          newAssignee: "New Person",
        },
      ],
      [
        "task.assignee_changed",
        {
          title: "Ship it",
          oldAssigneeId: null,
          newAssigneeId: "user-new",
          newAssignee: null,
        },
      ],
      ["task.unassigned", { title: "Ship it" }],
    ]);
  });

  it("respects switched-off events and the default-off set", async () => {
    const { base, context, project } = await fixture();
    const ctx = context({ webhookUrl: url });
    await genericEvents.handleTaskMoved(
      {
        ...base,
        fromProjectId: "a",
        fromProjectName: "A",
        toProjectId: project.id,
        toProjectName: "B",
        oldStatus: "a",
        newStatus: "b",
      },
      ctx,
    );
    await genericEvents.handleTaskDueDateChanged(
      { ...base, title: "t", oldDueDate: null, newDueDate: null },
      ctx,
    );
    await genericEvents.handleTaskAssigneeChanged(
      {
        ...base,
        title: "t",
        oldAssignee: null,
        newAssignee: undefined,
        newAssigneeId: "x",
      },
      ctx,
    );
    await genericEvents.handleTaskUnassigned({ ...base, title: "t" }, ctx);
    await genericEvents.handleTaskDeleted({ ...base, title: "t" }, ctx);
    await genericEvents.handleTaskPriorityChanged(
      { ...base, title: "t", oldPriority: "a", newPriority: "b" },
      ctx,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await genericEvents.sendDueDateReminder(
        { webhookUrl: url },
        base.taskId,
        base.projectId,
        60,
        new Date(),
      ),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("delivers task.deleted without the task row and reports failures as false", async () => {
    const { base, context, config, project, task, owner } =
      await withIntegration();
    await db.delete(schema.taskTable).where(eq(schema.taskTable.id, task.id));
    await genericEvents.handleTaskDeleted(
      { ...base, title: "Ship it" },
      context(config),
    );
    expect(sentBodies()).toEqual([
      expect.objectContaining({
        event: "task.deleted",
        project: {
          id: project.id,
          name: "Apollo & Co",
          workspaceId: owner.workspace.id,
        },
        task: { id: task.id, title: "Ship it" },
        actor: { id: owner.user.id, name: "Ann <Admin>" },
        data: {},
      }),
    ]);

    // Unknown project: nothing is delivered.
    fetchMock.mockClear();
    await genericEvents.handleTaskDeleted(
      { ...base, projectId: "ghost", title: "Ship it" },
      context(config),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sendDueDateReminder delivers the reminder payload and returns the outcome", async () => {
    const { base, config, project } = await withIntegration();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const due = new Date("2030-05-06T07:08:09.000Z");
    expect(
      await genericEvents.sendDueDateReminder(
        config as never,
        base.taskId,
        project.id,
        90,
        due,
      ),
    ).toBe(true);
    expect(sentBodies()[0]).toMatchObject({
      event: "task.due_date_reminder",
      actor: { id: null, name: null },
      data: { dueDate: "2030-05-06T07:08:09.000Z", leadTimeMinutes: 90 },
    });
    fetchMock.mockImplementation(
      async () => new Response("x", { status: 500 }),
    );
    expect(
      await genericEvents.sendDueDateReminder(
        config as never,
        base.taskId,
        project.id,
        90,
        due,
      ),
    ).toBe(false);
    // A missing task is not delivered either.
    fetchMock.mockClear();
    expect(
      await genericEvents.sendDueDateReminder(
        config as never,
        "ghost-task",
        project.id,
        90,
        due,
      ),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
