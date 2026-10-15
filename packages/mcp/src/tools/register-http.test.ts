import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KaneoClient } from "../kaneo/client.js";
import { registerTools } from "./register.js";

// These tests drive the real MCP server, tool registration and Kaneo REST
// client end to end; only the HTTP boundary (fetch) is replaced.

const BASE = "https://kaneo.test";
const realFetch = globalThis.fetch;

type Seen = {
  method: string;
  path: string;
  search: Record<string, string>;
  body: unknown;
  headers: Headers;
};
type Handler = (seen: Seen) => Response | unknown;

let seen: Seen[] = [];
let routes: Record<string, Handler> = {};
let fallback: Handler = () => ({ ok: true });

beforeEach(() => {
  seen = [];
  routes = {};
  fallback = () => ({ ok: true });
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = new URL(String(url));
    const entry: Seen = {
      method: init?.method ?? "GET",
      path: u.pathname,
      search: Object.fromEntries(u.searchParams.entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: new Headers(init?.headers),
    };
    seen.push(entry);
    const handler = routes[`${entry.method} ${entry.path}`] ?? fallback;
    const result = handler(entry);
    return result instanceof Response
      ? result
      : new Response(JSON.stringify(result), { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function connect(usingApiKey = true) {
  const auth = {
    getAccessToken: async () => "tok-1",
    clearToken: async () => {},
    usingApiKey,
  };
  const server = new McpServer({ name: "t", version: "0" });
  registerTools(server, {
    client: new KaneoClient({ baseUrl: BASE, auth: auth as never }),
  });
  const client = new Client({ name: "c", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function call(
  name: string,
  args: Record<string, unknown> = {},
  usingApiKey = true,
) {
  const client = await connect(usingApiKey);
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  const text = content[0]?.text ?? "";
  return { isError: result.isError === true, text, result };
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

type Case = {
  tool: string;
  args: Record<string, unknown>;
  method: string;
  path: string;
  search?: Record<string, string>;
  body?: unknown;
};

const cases: Case[] = [
  {
    tool: "list_workspaces",
    args: {},
    method: "GET",
    path: "/api/auth/organization/list",
  },
  {
    tool: "list_projects",
    args: { workspaceId: "w 1", includeArchived: true },
    method: "GET",
    path: "/api/project",
    search: { workspaceId: "w 1", includeArchived: "true" },
  },
  {
    tool: "list_projects",
    args: { workspaceId: "w1", includeArchived: false },
    method: "GET",
    path: "/api/project",
    search: { workspaceId: "w1" },
  },
  {
    tool: "get_project",
    args: { id: "p/1" },
    method: "GET",
    path: "/api/project/p%2F1",
  },
  {
    tool: "create_project",
    args: { name: "N", workspaceId: "w1", icon: "Layout", slug: "n" },
    method: "POST",
    path: "/api/project",
    body: { name: "N", workspaceId: "w1", icon: "Layout", slug: "n" },
  },
  {
    tool: "create_task",
    args: {
      projectId: "p1",
      title: "T",
      description: "D",
      priority: "high",
      status: "to-do",
      startDate: "2025-01-01T00:00:00Z",
      dueDate: "2025-01-02T00:00:00+01:00",
      userId: "u1",
      progress: 0,
      isMilestone: false,
    },
    method: "POST",
    path: "/api/task/p1",
    body: {
      title: "T",
      description: "D",
      priority: "high",
      status: "to-do",
      startDate: "2025-01-01T00:00:00Z",
      dueDate: "2025-01-02T00:00:00+01:00",
      userId: "u1",
      progress: 0,
      isMilestone: false,
    },
  },
  {
    tool: "create_task",
    args: {
      projectId: "p/1",
      title: "T",
      description: "",
      priority: "low",
      status: "s",
    },
    method: "POST",
    path: "/api/task/p%2F1",
    body: { title: "T", description: "", priority: "low", status: "s" },
  },
  {
    tool: "duplicate_task",
    args: { taskId: "t1", title: "Copy" },
    method: "POST",
    path: "/api/task/duplicate/t1",
    body: { title: "Copy" },
  },
  {
    tool: "duplicate_task",
    args: { taskId: "t1" },
    method: "POST",
    path: "/api/task/duplicate/t1",
    body: {},
  },
  {
    tool: "move_task",
    args: {
      taskId: "t1",
      destinationProjectId: "p2",
      destinationStatus: "done",
    },
    method: "PUT",
    path: "/api/task/move/t1",
    body: { destinationProjectId: "p2", destinationStatus: "done" },
  },
  {
    tool: "move_task",
    args: { taskId: "t1", destinationProjectId: "p2" },
    method: "PUT",
    path: "/api/task/move/t1",
    body: { destinationProjectId: "p2" },
  },
  {
    tool: "update_task_status",
    args: { taskId: "t1", status: "done" },
    method: "PUT",
    path: "/api/task/status/t1",
    body: { status: "done" },
  },
  {
    tool: "list_task_comments",
    args: { taskId: "t1" },
    method: "GET",
    path: "/api/comment/t1",
  },
  {
    tool: "create_task_comment",
    args: { taskId: "t1", content: "Hi" },
    method: "POST",
    path: "/api/comment/t1",
    body: { content: "Hi" },
  },
  {
    tool: "update_task_comment",
    args: { commentId: "c1", content: "Edit" },
    method: "PUT",
    path: "/api/comment/c1",
    body: { content: "Edit" },
  },
  {
    tool: "delete_task_comment",
    args: { commentId: "c1" },
    method: "DELETE",
    path: "/api/comment/c1",
  },
  {
    tool: "list_workspace_labels",
    args: { workspaceId: "w1" },
    method: "GET",
    path: "/api/label/workspace/w1",
  },
  {
    tool: "create_label",
    args: { name: "Bug", color: "#F60", workspaceId: "w1", taskId: "t1" },
    method: "POST",
    path: "/api/label",
    body: { name: "Bug", color: "#F60", workspaceId: "w1", taskId: "t1" },
  },
  {
    tool: "create_label",
    args: { name: "Bug", color: "#FF6600", workspaceId: "w1" },
    method: "POST",
    path: "/api/label",
    body: { name: "Bug", color: "#FF6600", workspaceId: "w1" },
  },
  {
    tool: "attach_label_to_task",
    args: { labelId: "l1", taskId: "t1" },
    method: "PUT",
    path: "/api/label/l1/task",
    body: { taskId: "t1" },
  },
  {
    tool: "detach_label_from_task",
    args: { labelId: "l1" },
    method: "DELETE",
    path: "/api/label/l1/task",
  },
  {
    tool: "create_task_relation",
    args: {
      sourceTaskId: "a",
      targetTaskId: "b",
      relationType: "blocks",
      dependencyType: "ss",
      lagDays: -2,
    },
    method: "POST",
    path: "/api/task-relation",
    body: {
      sourceTaskId: "a",
      targetTaskId: "b",
      relationType: "blocks",
      dependencyType: "ss",
      lagDays: -2,
    },
  },
  {
    tool: "create_task_relation",
    args: {
      sourceTaskId: "a",
      targetTaskId: "b",
      relationType: "related",
      lagDays: 0,
    },
    method: "POST",
    path: "/api/task-relation",
    body: {
      sourceTaskId: "a",
      targetTaskId: "b",
      relationType: "related",
      lagDays: 0,
    },
  },
  {
    tool: "get_task_relations",
    args: { taskId: "t1" },
    method: "GET",
    path: "/api/task-relation/t1",
  },
  {
    tool: "update_task_relation",
    args: { id: "r1", dependencyType: "ff", lagDays: 3 },
    method: "PATCH",
    path: "/api/task-relation/r1",
    body: { dependencyType: "ff", lagDays: 3 },
  },
  {
    tool: "update_task_relation",
    args: { id: "r1", lagDays: 0 },
    method: "PATCH",
    path: "/api/task-relation/r1",
    body: { lagDays: 0 },
  },
  {
    tool: "update_task_relation",
    args: { id: "r1" },
    method: "PATCH",
    path: "/api/task-relation/r1",
    body: {},
  },
  {
    tool: "delete_task_relation",
    args: { id: "r1" },
    method: "DELETE",
    path: "/api/task-relation/r1",
  },
  {
    tool: "list_workspace_members",
    args: { workspaceId: "w1" },
    method: "GET",
    path: "/api/workspace/w1/members",
  },
  {
    tool: "search",
    args: {
      q: "bug fix",
      type: "tasks",
      workspaceId: "w1",
      projectId: "p1",
      limit: 5,
    },
    method: "GET",
    path: "/api/search",
    search: {
      q: "bug fix",
      type: "tasks",
      workspaceId: "w1",
      projectId: "p1",
      limit: "5",
    },
  },
  {
    tool: "search",
    args: { q: "x" },
    method: "GET",
    path: "/api/search",
    search: { q: "x" },
  },
  {
    tool: "list_project_columns",
    args: { projectId: "p1" },
    method: "GET",
    path: "/api/column/p1",
  },
  {
    tool: "delete_task",
    args: { taskId: "t1" },
    method: "DELETE",
    path: "/api/task/t1",
  },
  {
    tool: "update_task_assignee",
    args: { taskId: "t1", userId: "u1" },
    method: "PUT",
    path: "/api/task/assignee/t1",
    body: { userId: "u1" },
  },
  {
    tool: "update_task_assignee",
    args: { taskId: "t1", userId: null },
    method: "PUT",
    path: "/api/task/assignee/t1",
    body: { userId: null },
  },
  {
    tool: "update_task_assignees",
    args: { taskId: "t1", userIds: [] },
    method: "PUT",
    path: "/api/task/t1/assignees",
    body: { userIds: [] },
  },
  {
    tool: "update_task_due_date",
    args: { taskId: "t1", dueDate: "2025-05-05T10:00:00Z" },
    method: "PUT",
    path: "/api/task/due-date/t1",
    body: { dueDate: "2025-05-05T10:00:00Z" },
  },
  {
    tool: "update_task_due_date",
    args: { taskId: "t1" },
    method: "PUT",
    path: "/api/task/due-date/t1",
    body: {},
  },
  {
    tool: "set_task_baseline",
    args: { taskId: "t1" },
    method: "POST",
    path: "/api/task/t1/baseline",
  },
  {
    tool: "clear_task_baseline",
    args: { taskId: "t1" },
    method: "DELETE",
    path: "/api/task/t1/baseline",
  },
  {
    tool: "list_task_time_entries",
    args: { taskId: "t1" },
    method: "GET",
    path: "/api/time-entry/task/t1",
  },
  {
    tool: "get_time_entry",
    args: { id: "e1" },
    method: "GET",
    path: "/api/time-entry/e1",
  },
  {
    tool: "create_time_entry",
    args: {
      taskId: "t1",
      startTime: "2025-01-01T09:00:00Z",
      endTime: "2025-01-01T10:00:00Z",
      description: "Work",
    },
    method: "POST",
    path: "/api/time-entry",
    body: {
      taskId: "t1",
      startTime: "2025-01-01T09:00:00Z",
      endTime: "2025-01-01T10:00:00Z",
      description: "Work",
    },
  },
  {
    tool: "create_time_entry",
    args: { taskId: "t1", startTime: "2025-01-01T09:00:00Z" },
    method: "POST",
    path: "/api/time-entry",
    body: { taskId: "t1", startTime: "2025-01-01T09:00:00Z" },
  },
  {
    tool: "update_time_entry",
    args: {
      id: "e1",
      startTime: "2025-01-01T09:00:00Z",
      endTime: "2025-01-01T11:00:00Z",
      description: "More",
    },
    method: "PUT",
    path: "/api/time-entry/e1",
    body: {
      startTime: "2025-01-01T09:00:00Z",
      endTime: "2025-01-01T11:00:00Z",
      description: "More",
    },
  },
  {
    tool: "update_time_entry",
    args: { id: "e1", startTime: "2025-01-01T09:00:00Z" },
    method: "PUT",
    path: "/api/time-entry/e1",
    body: { startTime: "2025-01-01T09:00:00Z" },
  },
  {
    tool: "list_task_activity",
    args: { taskId: "t1" },
    method: "GET",
    path: "/api/activity/t1",
  },
  {
    tool: "list_notifications",
    args: {},
    method: "GET",
    path: "/api/notification",
  },
  {
    tool: "get_workspace_calendar",
    args: { workspaceId: "w1" },
    method: "GET",
    path: "/api/calendar/w1",
  },
  {
    tool: "update_workspace_working_days",
    args: { workspaceId: "w1", workingDays: 62 },
    method: "PUT",
    path: "/api/calendar/w1",
    body: { workingDays: 62 },
  },
  {
    tool: "add_workspace_holiday",
    args: { workspaceId: "w1", date: "2025-12-25", name: "Christmas" },
    method: "POST",
    path: "/api/calendar/w1/holidays",
    body: { date: "2025-12-25", name: "Christmas" },
  },
  {
    tool: "delete_workspace_holiday",
    args: { workspaceId: "w1", holidayId: "h/1" },
    method: "DELETE",
    path: "/api/calendar/w1/holidays/h%2F1",
  },
  {
    tool: "list_project_custom_fields",
    args: { projectId: "p1" },
    method: "GET",
    path: "/api/custom-field/project/p1",
  },
  {
    tool: "get_task_custom_fields",
    args: { taskId: "t1" },
    method: "GET",
    path: "/api/custom-field/task/t1",
  },
  {
    tool: "set_task_custom_field_value",
    args: { taskId: "t1", fieldId: "f1", value: "" },
    method: "PUT",
    path: "/api/custom-field/value",
    body: { taskId: "t1", fieldId: "f1", value: "" },
  },
];

describe("single-request tools", () => {
  it.each(cases)("$tool $args sends $method $path", async (c) => {
    routes[`${c.method} ${c.path}`] = () => ({ echoed: c.tool });
    const { isError, text } = await call(c.tool, c.args);
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual({ echoed: c.tool });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: c.method,
      path: c.path,
      search: c.search ?? {},
    });
    expect(seen[0]?.body).toEqual(c.body);
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer tok-1");
    const hasBody = c.body !== undefined;
    expect(seen[0]?.headers.get("content-type")).toBe(
      hasBody ? "application/json" : null,
    );
  });

  it.each(cases)(
    "$tool $args passes API errors through as an MCP error",
    async (c) => {
      fallback = () => json({ message: "Forbidden by test" }, 403);
      const { isError, text } = await call(c.tool, c.args);
      expect(isError).toBe(true);
      const parsed = JSON.parse(text) as { error: string };
      expect(parsed.error).toMatch(/^\/api\/.*: Forbidden by test$/);
    },
  );

  it.each(cases)(
    "$tool $args reports network failures as an MCP error",
    async (c) => {
      globalThis.fetch = vi.fn(async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch;
      const { isError, text } = await call(c.tool, c.args);
      expect(isError).toBe(true);
      expect(JSON.parse(text)).toEqual({ error: "fetch failed" });
    },
  );
});

describe("whoami", () => {
  it("uses /api/user/me with an API key", async () => {
    routes["GET /api/user/me"] = () => ({ id: "u1" });
    const { text, isError } = await call("whoami", {}, true);
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual({ id: "u1" });
    expect(seen.map((s) => s.path)).toEqual(["/api/user/me"]);
  });

  it("uses the session endpoint with device auth", async () => {
    routes["GET /api/auth/get-session"] = () => ({ user: { id: "u1" } });
    const { text } = await call("whoami", {}, false);
    expect(JSON.parse(text)).toEqual({ user: { id: "u1" } });
    expect(seen.map((s) => s.path)).toEqual(["/api/auth/get-session"]);
  });
});

describe("input validation", () => {
  it.each([
    ["an unknown field", "list_projects", { workspaceId: "w1", bogus: 1 }],
    ["an empty required string", "get_project", { id: "   " }],
    ["a missing required field", "create_project", { name: "N" }],
    [
      "a bad priority",
      "create_task",
      {
        projectId: "p",
        title: "t",
        description: "",
        priority: "huge",
        status: "s",
      },
    ],
    [
      "a non-ISO date",
      "update_task_due_date",
      { taskId: "t", dueDate: "tomorrow" },
    ],
    [
      "a bad label color",
      "create_label",
      { name: "x", color: "red", workspaceId: "w" },
    ],
    ["an out of range limit", "search", { q: "x", limit: 51 }],
    [
      "an invalid working days mask",
      "update_workspace_working_days",
      { workspaceId: "w", workingDays: 128 },
    ],
    [
      "an invalid dependency type",
      "create_task_relation",
      {
        sourceTaskId: "a",
        targetTaskId: "b",
        relationType: "blocks",
        dependencyType: "xx",
      },
    ],
    [
      "a progress above 100",
      "create_task",
      {
        projectId: "p",
        title: "t",
        description: "",
        priority: "low",
        status: "s",
        progress: 101,
      },
    ],
  ])("rejects %s without calling the API", async (_n, tool, args) => {
    const { isError } = await call(tool, args as Record<string, unknown>);
    expect(isError).toBe(true);
    expect(seen).toHaveLength(0);
  });
});

describe("update_project", () => {
  const existing = {
    name: "Old",
    icon: "Star",
    slug: "OLD",
    description: "desc",
    isPublic: true,
  };

  it("merges the patch onto the stored project and PUTs a full body", async () => {
    routes["GET /api/project/p1"] = () => existing;
    routes["PUT /api/project/p1"] = (s) => s.body;
    const { text } = await call("update_project", {
      id: "p1",
      name: "New",
      isPublic: false,
    });
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      "GET /api/project/p1",
      "PUT /api/project/p1",
    ]);
    expect(JSON.parse(text)).toEqual({
      name: "New",
      icon: "Star",
      slug: "OLD",
      description: "desc",
      isPublic: false,
    });
  });

  it("lets an explicit empty icon and description override the stored values", async () => {
    routes["GET /api/project/p1"] = () => existing;
    await call("update_project", { id: "p1", icon: "", description: "" });
    expect(seen[1]?.body).toEqual({
      name: "Old",
      icon: "",
      slug: "OLD",
      description: "",
      isPublic: true,
    });
  });

  it("falls back to defaults for missing stored optional fields", async () => {
    routes["GET /api/project/p1"] = () => ({ name: "N", slug: "n" });
    await call("update_project", { id: "p1", slug: "renamed" });
    expect(seen[1]?.body).toEqual({
      name: "N",
      icon: "Layout",
      slug: "renamed",
      description: "",
      isPublic: false,
    });
  });

  it.each([
    [{ slug: "s" }, "Cannot update project: missing name."],
    [{ name: "n" }, "Cannot update project: missing slug."],
  ])(
    "fails without writing when the stored project is incomplete %j",
    async (stored, message) => {
      routes["GET /api/project/p1"] = () => stored;
      const { isError, text } = await call("update_project", { id: "p1" });
      expect(isError).toBe(true);
      expect(JSON.parse(text)).toEqual({ error: message });
      expect(seen.map((s) => s.method)).toEqual(["GET"]);
    },
  );

  it("does not write when the project cannot be read", async () => {
    routes["GET /api/project/p1"] = () =>
      json({ message: "Project not found" }, 404);
    const { isError, text } = await call("update_project", {
      id: "p1",
      name: "x",
    });
    expect(isError).toBe(true);
    expect(JSON.parse(text)).toEqual({
      error: "/api/project/p1: Project not found",
    });
    expect(seen).toHaveLength(1);
  });
});

describe("list_tasks", () => {
  const board = {
    data: {
      columns: [
        { id: "c1", tasks: [{ id: "t1" }, { id: "t2" }, { name: "no id" }] },
      ],
      archivedTasks: [{ id: "t3" }],
      plannedTasks: [{ id: "t1" }],
    },
  };

  it("sends only the provided filters and merges bulk custom field values by task", async () => {
    routes["GET /api/task/tasks/p%201"] = () => board;
    routes["GET /api/custom-field/project/p%201/values"] = () => [
      {
        taskId: "t1",
        fieldId: "f1",
        fieldName: "Severity",
        fieldType: "text",
        value: "high",
      },
      { taskId: "t1", fieldId: "f2" },
      {
        taskId: "t3",
        fieldId: "f1",
        fieldName: "Severity",
        fieldType: "text",
        value: "low",
      },
      { taskId: 7, fieldId: "f1" },
      { fieldId: "f1" },
    ];
    const { isError, text } = await call("list_tasks", {
      projectId: "p 1",
      status: "open",
      priority: "high",
      assigneeId: "u1",
      page: 2,
      relatedPage: 3,
      limit: 10,
      sortBy: "title",
      sortOrder: "desc",
      dueBefore: "2025-01-01T00:00:00Z",
      dueAfter: "2024-01-01T00:00:00+02:00",
    });
    expect(isError).toBe(false);
    const list = seen.find((s) => s.path === "/api/task/tasks/p%201");
    expect(list?.search).toEqual({
      status: "open",
      priority: "high",
      assigneeId: "u1",
      page: "2",
      relatedPage: "3",
      limit: "10",
      sortBy: "title",
      sortOrder: "desc",
      dueBefore: "2025-01-01T00:00:00Z",
      dueAfter: "2024-01-01T00:00:00+02:00",
    });
    const t1Fields = [
      { fieldId: "f1", name: "Severity", type: "text", value: "high" },
      { fieldId: "f2", name: "", type: "", value: null },
    ];
    expect(JSON.parse(text)).toEqual({
      data: {
        columns: [
          {
            id: "c1",
            tasks: [
              { id: "t1", customFields: t1Fields },
              { id: "t2", customFields: [] },
              { name: "no id", customFields: [] },
            ],
          },
        ],
        archivedTasks: [
          {
            id: "t3",
            customFields: [
              { fieldId: "f1", name: "Severity", type: "text", value: "low" },
            ],
          },
        ],
        plannedTasks: [{ id: "t1", customFields: t1Fields }],
      },
    });
  });

  it("omits the query string when no filters are given", async () => {
    routes["GET /api/task/tasks/p1"] = () => ({ data: { columns: [] } });
    await call("list_tasks", { projectId: "p1" });
    expect(seen[0]?.search).toEqual({});
  });

  it("returns the board without custom fields when the bulk request fails", async () => {
    routes["GET /api/task/tasks/p1"] = () => ({
      data: { columns: [{ id: "c", tasks: [{ id: "t1" }] }] },
    });
    routes["GET /api/custom-field/project/p1/values"] = () =>
      json({ message: "denied" }, 403);
    const { isError, text } = await call("list_tasks", { projectId: "p1" });
    expect(isError).toBe(false);
    expect(JSON.parse(text).data.columns[0].tasks).toEqual([
      { id: "t1", customFields: [] },
    ]);
  });

  it("tolerates a non-array bulk response and malformed board shapes", async () => {
    routes["GET /api/task/tasks/p1"] = () => ({
      data: { columns: "none", archivedTasks: null },
    });
    routes["GET /api/custom-field/project/p1/values"] = () => ({
      not: "an array",
    });
    const { isError, text } = await call("list_tasks", { projectId: "p1" });
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual({
      data: { columns: "none", archivedTasks: null },
    });
  });

  it("returns a board without a data envelope unchanged", async () => {
    routes["GET /api/task/tasks/p1"] = () => ({ message: "odd" });
    const { text } = await call("list_tasks", { projectId: "p1" });
    expect(JSON.parse(text)).toEqual({ message: "odd" });
  });

  it("reports a failed board read", async () => {
    routes["GET /api/task/tasks/p1"] = () =>
      json({ message: "No access" }, 403);
    const { isError, text } = await call("list_tasks", { projectId: "p1" });
    expect(isError).toBe(true);
    expect(JSON.parse(text)).toEqual({
      error: "/api/task/tasks/p1: No access",
    });
  });

  it("rejects a page size above 100 without calling the API", async () => {
    const { isError } = await call("list_tasks", {
      projectId: "p1",
      limit: 101,
    });
    expect(isError).toBe(true);
    expect(seen).toHaveLength(0);
  });
});

describe("get_task", () => {
  it("adds the task's custom field values", async () => {
    routes["GET /api/task/t1"] = () => ({ id: "t1", title: "T" });
    routes["GET /api/custom-field/task/t1"] = () => [
      { fieldId: "f1", fieldName: "Sev", fieldType: "number", value: "3" },
    ];
    const { text } = await call("get_task", { taskId: "t1" });
    expect(JSON.parse(text)).toEqual({
      id: "t1",
      title: "T",
      customFields: [
        { fieldId: "f1", name: "Sev", type: "number", value: "3" },
      ],
    });
  });

  it("degrades to no custom fields when they cannot be read or are malformed", async () => {
    routes["GET /api/task/t1"] = () => ({ id: "t1" });
    routes["GET /api/custom-field/task/t1"] = () =>
      json({ message: "denied" }, 403);
    expect(JSON.parse((await call("get_task", { taskId: "t1" })).text)).toEqual(
      {
        id: "t1",
        customFields: [],
      },
    );
    routes["GET /api/custom-field/task/t1"] = () => ({ not: "array" });
    expect(JSON.parse((await call("get_task", { taskId: "t1" })).text)).toEqual(
      {
        id: "t1",
        customFields: [],
      },
    );
  });

  it("fails when the task itself is missing", async () => {
    routes["GET /api/task/t9"] = () => json({ message: "Task not found" }, 404);
    const { isError, text } = await call("get_task", { taskId: "t9" });
    expect(isError).toBe(true);
    expect(JSON.parse(text)).toEqual({ error: "/api/task/t9: Task not found" });
  });
});

describe("update_task", () => {
  const stored = {
    id: "t1",
    title: "T",
    description: null,
    status: "to-do",
    priority: "low",
    projectId: "p1",
    position: 2,
    userId: "u1",
    approvalStatus: "approved",
  };

  it("does nothing but read when no field is given", async () => {
    routes["GET /api/task/t1"] = () => stored;
    const { text } = await call("update_task", { taskId: "t1" });
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      "GET /api/task/t1",
    ]);
    expect(JSON.parse(text)).toEqual(stored);
  });

  it("sends a full body merged with the patch", async () => {
    routes["GET /api/task/t1"] = () => stored;
    routes["PUT /api/task/t1"] = (s) => s.body;
    const { text } = await call("update_task", {
      taskId: "t1",
      title: "Renamed",
      userId: null,
      dueDate: "2025-03-03T00:00:00Z",
    });
    expect(JSON.parse(text)).toEqual({
      title: "Renamed",
      description: "",
      status: "to-do",
      priority: "low",
      projectId: "p1",
      position: 2,
      dueDate: "2025-03-03T00:00:00Z",
      userId: "",
    });
  });

  it("sets only the approval gate through the approval endpoint", async () => {
    routes["GET /api/task/t1"] = () => stored;
    await call("update_task", {
      taskId: "t1",
      approvalStatus: "rejected",
      approvalNote: null,
    });
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      "GET /api/task/t1",
      "PUT /api/task/approval/t1",
    ]);
    expect(seen[1]?.body).toEqual({
      approvalStatus: "rejected",
      approvalNote: null,
    });
  });

  it("keeps the stored approval status when only a note is sent, defaulting to none", async () => {
    routes["GET /api/task/t1"] = () => stored;
    await call("update_task", { taskId: "t1", approvalNote: "ok" });
    expect(seen[1]?.body).toEqual({
      approvalStatus: "approved",
      approvalNote: "ok",
    });

    seen = [];
    routes["GET /api/task/t1"] = () => ({
      ...stored,
      approvalStatus: undefined,
    });
    await call("update_task", { taskId: "t1", approvalNote: "ok" });
    expect(seen[1]?.body).toEqual({
      approvalStatus: "none",
      approvalNote: "ok",
    });
  });

  it("omits approvalNote from the approval request when not provided", async () => {
    routes["GET /api/task/t1"] = () => stored;
    await call("update_task", { taskId: "t1", approvalStatus: "pending" });
    expect(seen[1]?.body).toEqual({ approvalStatus: "pending" });
  });

  it("does not write when the stored task is invalid for a full update", async () => {
    routes["GET /api/task/t1"] = () => ({ ...stored, priority: "bogus" });
    const { isError, text } = await call("update_task", {
      taskId: "t1",
      title: "x",
    });
    expect(isError).toBe(true);
    expect(JSON.parse(text)).toEqual({
      error: "Cannot update task: invalid or missing priority.",
    });
    expect(seen).toHaveLength(1);
  });

  it("does not set approval when the task update itself fails", async () => {
    routes["GET /api/task/t1"] = () => stored;
    routes["PUT /api/task/t1"] = () => json({ message: "Conflict" }, 409);
    const { isError } = await call("update_task", {
      taskId: "t1",
      title: "x",
      approvalStatus: "pending",
    });
    expect(isError).toBe(true);
    expect(seen.map((s) => s.path)).toEqual(["/api/task/t1", "/api/task/t1"]);
  });

  it("rejects an invalid approval status without calling the API", async () => {
    const { isError } = await call("update_task", {
      taskId: "t1",
      approvalStatus: "maybe",
    });
    expect(isError).toBe(true);
    expect(seen).toHaveLength(0);
  });
});

describe("delete_label", () => {
  it("deletes a task-level label after confirming it is attached", async () => {
    routes["GET /api/label/l1"] = () => ({ id: "l1", taskId: "t1" });
    routes["DELETE /api/label/l1"] = () => ({ deleted: true });
    const { isError, text } = await call("delete_label", { id: "l1" });
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual({ deleted: true });
    expect(seen.map((s) => s.method)).toEqual(["GET", "DELETE"]);
  });

  it.each([[{ id: "l1", taskId: null }], [null], [{ id: "l1" }]])(
    "refuses a workspace-level label (%j) and sends no DELETE",
    async (label) => {
      routes["GET /api/label/l1"] = () => label;
      const { isError, text } = await call("delete_label", { id: "l1" });
      expect(isError).toBe(true);
      expect(JSON.parse(text).error).toMatch(
        /not associated with a task and cannot be deleted/,
      );
      expect(seen.map((s) => s.method)).toEqual(["GET"]);
    },
  );

  it("reports a missing label from the API", async () => {
    routes["GET /api/label/l1"] = () =>
      json({ message: "Label not found" }, 404);
    const { isError, text } = await call("delete_label", { id: "l1" });
    expect(isError).toBe(true);
    expect(JSON.parse(text)).toEqual({
      error: "/api/label/l1: Label not found",
    });
  });
});

describe("tool metadata", () => {
  it("advertises strict input schemas for every tool", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const covered = new Set([
      ...cases.map((c) => c.tool),
      "whoami",
      "update_project",
      "list_tasks",
      "get_task",
      "update_task",
      "delete_label",
    ]);
    expect(tools.map((t) => t.name).sort()).toEqual([...covered].sort());
    for (const tool of tools) {
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
  });
});
