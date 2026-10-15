import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  publishEvent,
  waitForPendingEventHandlers,
} from "../../apps/api/src/events";
import { initializePlugins } from "../../apps/api/src/plugins";
import {
  getPlugin,
  initializeEventSubscriptions,
  listPlugins,
  registerPlugin,
} from "../../apps/api/src/plugins/registry";
import type { IntegrationPlugin } from "../../apps/api/src/plugins/types";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Test-only plugin types: the registry's own behavior (dispatch scope, config
// parsing, error isolation) is checked without any outbound HTTP at all.
const calls: Array<{ handler: string; event: unknown; context: unknown }> = [];

const handlerNames = [
  "onTaskCreated",
  "onTaskStatusChanged",
  "onTaskPriorityChanged",
  "onTaskTitleChanged",
  "onTaskDescriptionChanged",
  "onTaskCommentCreated",
  "onTaskDeleted",
  "onTaskMoved",
  "onTaskDueDateChanged",
  "onTaskAssigneeChanged",
  "onTaskUnassigned",
] as const;

function recorder(): IntegrationPlugin {
  const plugin: IntegrationPlugin = {
    type: "test-recorder",
    name: "Recorder",
    validateConfig: async () => ({ valid: true }),
  };
  for (const name of handlerNames) {
    (plugin as Record<string, unknown>)[name] = async (
      event: unknown,
      context: unknown,
    ) => {
      calls.push({ handler: name, event, context });
    };
  }
  return plugin;
}

function thrower(): IntegrationPlugin {
  const plugin: IntegrationPlugin = {
    type: "test-thrower",
    name: "Thrower",
    validateConfig: async () => ({ valid: true }),
  };
  for (const name of handlerNames) {
    (plugin as Record<string, unknown>)[name] = async () => {
      throw new Error(`boom in ${name}`);
    };
  }
  return plugin;
}

registerPlugin(recorder());
registerPlugin(thrower());
// A plugin without any handler must simply be skipped.
registerPlugin({
  type: "test-silent",
  name: "Silent",
  validateConfig: async () => ({ valid: true }),
});

async function seed() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project: a } = await createProjectFixture({
    workspaceId: owner.workspace.id,
    name: "A",
  });
  const { project: b } = await createProjectFixture({
    workspaceId: owner.workspace.id,
    name: "B",
  });
  return { owner, a, b };
}

async function addIntegration(
  projectId: string,
  type: string,
  config: Record<string, unknown> = {},
  isActive = true,
) {
  const [row] = await db
    .insert(schema.integrationTable)
    .values({ projectId, type, config: JSON.stringify(config), isActive })
    .returning();
  if (!row) throw new Error("integration not created");
  return row;
}

describe("API integration: plugin registry", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    calls.length = 0;
  });

  afterEach(async () => {
    await waitForPendingEventHandlers();
    vi.restoreAllMocks();
  });

  it("refuses a duplicate registration and exposes plugins by type", () => {
    expect(() => registerPlugin(recorder())).toThrow(
      "Plugin test-recorder already registered",
    );
    expect(getPlugin("test-recorder")?.name).toBe("Recorder");
    expect(getPlugin("no-such-plugin")).toBeUndefined();
    expect(listPlugins().map((plugin) => plugin.type)).toEqual(
      expect.arrayContaining(["test-recorder", "test-thrower", "test-silent"]),
    );
  });

  it("maps every bus event to its plugin handler with the project the event concerns", async () => {
    initializeEventSubscriptions();
    // A second call must not subscribe again (handlers would run twice).
    initializeEventSubscriptions();
    const { a, b } = await seed();
    const rowA = await addIntegration(a.id, "test-recorder", { k: "a" });
    const rowB = await addIntegration(b.id, "test-recorder", { k: "b" });

    const due = new Date("2031-01-01T00:00:00.000Z");
    const publishes: Array<[string, Record<string, unknown>]> = [
      [
        "task.created",
        {
          taskId: "t1",
          projectId: a.id,
          userId: "u1",
          title: "T",
          description: "D",
          priority: "high",
          status: "to-do",
          number: 3,
        },
      ],
      [
        "task.status_changed",
        {
          taskId: "t1",
          projectId: a.id,
          userId: "u1",
          oldStatus: "to-do",
          newStatus: "done",
          title: "T",
          sourceIntegrationId: "src-1",
        },
      ],
      [
        "task.priority_changed",
        {
          taskId: "t1",
          projectId: a.id,
          userId: "u1",
          oldPriority: "low",
          newPriority: "high",
          title: "T",
        },
      ],
      [
        "task.title_changed",
        {
          taskId: "t1",
          projectId: a.id,
          userId: "u1",
          oldTitle: "Old",
          newTitle: "New",
        },
      ],
      [
        "task.description_changed",
        {
          taskId: "t1",
          projectId: a.id,
          userId: "u1",
          oldDescription: null,
          newDescription: "text",
        },
      ],
      [
        "comment.created",
        { taskId: "t1", projectId: a.id, userId: "u1", comment: "hi" },
      ],
      [
        "task.deleted",
        { taskId: "t1", projectId: a.id, userId: null, title: "T" },
      ],
      [
        "task.moved",
        {
          taskId: "t1",
          userId: "u1",
          fromProjectId: a.id,
          fromProjectName: "A",
          toProjectId: b.id,
          toProjectName: "B",
          oldStatus: "to-do",
          newStatus: "done",
        },
      ],
      [
        "task.due_date_changed",
        {
          taskId: "t1",
          projectId: a.id,
          userId: "u1",
          title: "T",
          oldDueDate: null,
          newDueDate: due,
        },
      ],
      [
        "task.assignee_changed",
        {
          taskId: "t1",
          projectId: a.id,
          userId: "u1",
          title: "T",
          oldAssignee: "old",
          newAssignee: "New",
          newAssigneeId: "u2",
        },
      ],
      [
        "task.unassigned",
        { taskId: "t1", projectId: a.id, userId: "u1", title: "T" },
      ],
    ];

    for (const [eventName, data] of publishes) {
      await publishEvent(eventName, data, { waitForHandlers: true });
    }

    const byHandler = new Map(calls.map((call) => [call.handler, call]));
    // One call per event: exactly eleven, none duplicated.
    expect(calls.map((call) => call.handler)).toEqual([...handlerNames]);

    const ctxA = {
      integrationId: rowA.id,
      projectId: a.id,
      config: { k: "a" },
    };
    expect(byHandler.get("onTaskCreated")).toMatchObject({
      event: {
        taskId: "t1",
        projectId: a.id,
        userId: "u1",
        title: "T",
        description: "D",
        priority: "high",
        status: "to-do",
        number: 3,
      },
      context: ctxA,
    });
    expect(byHandler.get("onTaskStatusChanged")?.event).toEqual({
      sourceIntegrationId: "src-1",
      taskId: "t1",
      projectId: a.id,
      userId: "u1",
      oldStatus: "to-do",
      newStatus: "done",
      title: "T",
    });
    expect(byHandler.get("onTaskPriorityChanged")?.event).toEqual({
      taskId: "t1",
      projectId: a.id,
      userId: "u1",
      oldPriority: "low",
      newPriority: "high",
      title: "T",
    });
    expect(byHandler.get("onTaskTitleChanged")?.event).toEqual({
      taskId: "t1",
      projectId: a.id,
      userId: "u1",
      oldTitle: "Old",
      newTitle: "New",
    });
    expect(byHandler.get("onTaskDescriptionChanged")?.event).toEqual({
      taskId: "t1",
      projectId: a.id,
      userId: "u1",
      oldDescription: null,
      newDescription: "text",
    });
    expect(byHandler.get("onTaskCommentCreated")?.event).toEqual({
      taskId: "t1",
      projectId: a.id,
      userId: "u1",
      comment: "hi",
    });
    expect(byHandler.get("onTaskDeleted")?.event).toEqual({
      taskId: "t1",
      projectId: a.id,
      userId: null,
      title: "T",
    });
    expect(byHandler.get("onTaskDueDateChanged")?.event).toEqual({
      taskId: "t1",
      projectId: a.id,
      userId: "u1",
      title: "T",
      oldDueDate: null,
      newDueDate: due,
    });
    expect(byHandler.get("onTaskAssigneeChanged")?.event).toEqual({
      taskId: "t1",
      projectId: a.id,
      userId: "u1",
      title: "T",
      oldAssignee: "old",
      newAssignee: "New",
      newAssigneeId: "u2",
    });
    expect(byHandler.get("onTaskUnassigned")?.event).toEqual({
      taskId: "t1",
      projectId: a.id,
      userId: "u1",
      title: "T",
    });

    // A move is delivered to the DESTINATION project's integrations only.
    const moved = byHandler.get("onTaskMoved");
    expect(moved?.event).toEqual({
      taskId: "t1",
      projectId: b.id,
      userId: "u1",
      fromProjectId: a.id,
      fromProjectName: "A",
      toProjectId: b.id,
      toProjectName: "B",
      oldStatus: "to-do",
      newStatus: "done",
    });
    expect(moved?.context).toEqual({
      integrationId: rowB.id,
      projectId: b.id,
      config: { k: "b" },
    });
    // Every other event reached project A's integration, never B's.
    for (const call of calls.filter((c) => c.handler !== "onTaskMoved")) {
      expect((call.context as { integrationId: string }).integrationId).toBe(
        rowA.id,
      );
    }
  });

  it("skips inactive integrations, other projects, unknown types and handler-less plugins", async () => {
    initializeEventSubscriptions();
    const { a, b } = await seed();
    await addIntegration(a.id, "test-recorder", {}, false);
    await addIntegration(a.id, "test-silent");
    await addIntegration(a.id, "not-registered");
    await addIntegration(b.id, "test-recorder");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await publishEvent(
      "task.unassigned",
      { taskId: "t", projectId: a.id, userId: "u", title: "T" },
      { waitForHandlers: true },
    );
    expect(calls).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("isolates a failing plugin from the others for every event type", async () => {
    initializeEventSubscriptions();
    const { a } = await seed();
    await addIntegration(a.id, "test-thrower");
    await addIntegration(a.id, "test-recorder");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const base = { taskId: "t", projectId: a.id, userId: "u", title: "T" };
    const events: Array<[string, Record<string, unknown>, string]> = [
      [
        "task.created",
        { ...base, description: null, priority: "low", status: "x", number: 1 },
        "task.created",
      ],
      [
        "task.status_changed",
        { ...base, oldStatus: "a", newStatus: "b" },
        "task.status_changed",
      ],
      [
        "task.priority_changed",
        { ...base, oldPriority: "a", newPriority: "b" },
        "task.priority_changed",
      ],
      [
        "task.title_changed",
        { ...base, oldTitle: "a", newTitle: "b" },
        "task.title_changed",
      ],
      [
        "task.description_changed",
        { ...base, oldDescription: "a", newDescription: "b" },
        "task.description_changed",
      ],
      ["comment.created", { ...base, comment: "c" }, "comment.created"],
      ["task.deleted", base, "task.deleted"],
      [
        "task.moved",
        {
          ...base,
          fromProjectId: "x",
          fromProjectName: "X",
          toProjectId: a.id,
          toProjectName: "A",
          oldStatus: "a",
          newStatus: "b",
        },
        "task.moved",
      ],
      [
        "task.due_date_changed",
        { ...base, oldDueDate: null, newDueDate: null },
        "task.due_date_changed",
      ],
      [
        "task.assignee_changed",
        {
          ...base,
          oldAssignee: null,
          newAssignee: undefined,
          newAssigneeId: "u2",
        },
        "task.assignee_changed",
      ],
      ["task.unassigned", base, "task.unassigned"],
    ];
    for (const [eventName, data] of events) {
      await publishEvent(eventName, data, { waitForHandlers: true });
    }

    // The recorder still got every event, so one failure never blocks the rest.
    expect(calls).toHaveLength(11);
    for (const [, , label] of events) {
      expect(errors).toHaveBeenCalledWith(
        `Plugin test-thrower error on ${label}:`,
        expect.objectContaining({
          message: expect.stringMatching(/^boom in on/),
        }),
      );
    }
  });

  it("initializePlugins registers the bundled plugins once and delivers through the bus", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    initializePlugins();
    expect(
      listPlugins()
        .map((plugin) => plugin.type)
        .filter((type) => !type.startsWith("test-")),
    ).toEqual([
      "github",
      "gitea",
      "gitlab",
      "slack",
      "mattermost",
      "discord",
      "generic-webhook",
      "telegram",
    ]);
    expect(getPlugin("generic-webhook")?.name).toBe("Generic Webhook");
    expect(() => initializePlugins()).toThrow(
      "Plugin github already registered",
    );

    // End to end: a bus event reaches a configured generic webhook exactly once.
    const { owner, a } = await seed();
    const [task] = await db
      .insert(schema.taskTable)
      .values({ projectId: a.id, title: "Bus task", number: 4 })
      .returning();
    await addIntegration(a.id, "generic-webhook", {
      webhookUrl: "https://127.0.0.1/hooks/bus",
      events: { taskCreated: true },
    });
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
    try {
      await publishEvent(
        "task.created",
        {
          taskId: task?.id,
          projectId: a.id,
          userId: owner.user.id,
          title: "Bus task",
          description: "",
          priority: "low",
          status: "to-do",
          number: 4,
        },
        { waitForHandlers: true },
      );
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const calls = fetchMock.mock.calls as unknown as Array<
        [string, { body: string }]
      >;
      expect(calls[0]?.[0]).toBe("https://127.0.0.1/hooks/bus");
      expect(JSON.parse(calls[0]?.[1].body ?? "{}")).toMatchObject({
        event: "task.created",
        task: { id: task?.id, title: "Bus task" },
        data: { title: "Bus task" },
      });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
