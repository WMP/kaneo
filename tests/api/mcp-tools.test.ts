import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type McpToolRegistrar,
  registerMcpTools,
} from "../../apps/api/src/mcp/tools";

type ToolCallback = (args: unknown) => Promise<{
  content: Array<{ text: string }>;
  isError?: boolean;
}>;

function collectTools() {
  const tools = new Map<string, ToolCallback>();
  const registrar: McpToolRegistrar = {
    registerTool: (name, _config, callback) => tools.set(name, callback),
  };
  registerMcpTools(registrar, "http://api.test", "test-token");
  return tools;
}

const tools = collectTools();

function call(name: string, args: unknown = {}) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool ${name} is not registered`);
  return tool(args);
}

let apiFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiFetch = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", apiFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastRequest() {
  const [input, init] = apiFetch.mock.calls.at(-1) as [
    RequestInfo | URL,
    RequestInit | undefined,
  ];
  return {
    url: String(input),
    method: init?.method ?? "GET",
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
    auth: new Headers(init?.headers).get("authorization"),
  };
}

describe("MCP tool catalog", () => {
  it("resolves workspace members", async () => {
    await call("list_workspace_members", { workspaceId: "ws 1" });

    const request = lastRequest();
    expect(request.url).toBe("http://api.test/api/workspace/ws%201/members");
    expect(request.auth).toBe("Bearer test-token");
  });

  it("passes only the search filters that were supplied", async () => {
    await call("search", { q: "login bug" });
    expect(lastRequest().url).toBe("http://api.test/api/search?q=login+bug");

    await call("search", {
      q: "login bug",
      type: "tasks",
      projectId: "p1",
      limit: 5,
    });
    const url = new URL(lastRequest().url);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "login bug",
      type: "tasks",
      projectId: "p1",
      limit: "5",
    });
  });

  it("rejects a search limit above the API maximum", async () => {
    const result = await call("search", { q: "x", limit: 500 });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("lists the columns whose slugs are valid task statuses", async () => {
    await call("list_project_columns", { projectId: "p1" });

    expect(lastRequest().url).toBe("http://api.test/api/column/p1");
  });

  it("deletes a task", async () => {
    await call("delete_task", { taskId: "t1" });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/t1",
      method: "DELETE",
    });
  });

  it("assigns and unassigns a task", async () => {
    await call("update_task_assignee", { taskId: "t1", userId: "u1" });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/assignee/t1",
      method: "PUT",
      body: { userId: "u1" },
    });

    await call("update_task_assignee", { taskId: "t1", userId: null });
    expect(lastRequest().body).toEqual({ userId: null });
  });

  it("rejects an empty assignee id rather than sending it", async () => {
    const result = await call("update_task_assignee", {
      taskId: "t1",
      userId: "",
    });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("sets and clears a due date", async () => {
    await call("update_task_due_date", {
      taskId: "t1",
      dueDate: "2026-09-01T10:00:00Z",
    });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/due-date/t1",
      method: "PUT",
      body: { dueDate: "2026-09-01T10:00:00Z" },
    });

    await call("update_task_due_date", { taskId: "t1" });
    expect(lastRequest().body).toEqual({});
  });

  it("rejects a due date that is not an ISO date-time", async () => {
    const result = await call("update_task_due_date", {
      taskId: "t1",
      dueDate: "next tuesday",
    });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("reads time entries for a task and by id", async () => {
    await call("list_task_time_entries", { taskId: "t1" });
    expect(lastRequest().url).toBe("http://api.test/api/time-entry/task/t1");

    await call("get_time_entry", { id: "te1" });
    expect(lastRequest().url).toBe("http://api.test/api/time-entry/te1");
  });

  it("creates a running time entry when endTime is omitted", async () => {
    await call("create_time_entry", {
      taskId: "t1",
      startTime: "2026-08-10T09:00:00Z",
    });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/time-entry",
      method: "POST",
      body: { taskId: "t1", startTime: "2026-08-10T09:00:00Z" },
    });
    expect(lastRequest().body).not.toHaveProperty("endTime");
  });

  it("updates a time entry", async () => {
    await call("update_time_entry", {
      id: "te1",
      startTime: "2026-08-10T09:00:00Z",
      endTime: "2026-08-10T10:30:00Z",
      description: "pairing",
    });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/time-entry/te1",
      method: "PUT",
      body: {
        startTime: "2026-08-10T09:00:00Z",
        endTime: "2026-08-10T10:30:00Z",
        description: "pairing",
      },
    });
  });

  it("reads task activity and notifications", async () => {
    await call("list_task_activity", { taskId: "t1" });
    expect(lastRequest().url).toBe("http://api.test/api/activity/t1");

    await call("list_notifications");
    expect(lastRequest().url).toBe("http://api.test/api/notification");
  });

  it("surfaces an API failure as a tool error", async () => {
    apiFetch.mockResolvedValueOnce(
      Response.json({ message: "Task not found" }, { status: 404 }),
    );

    const result = await call("delete_task", { taskId: "missing" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Task not found");
  });

  it("forwards progress and isMilestone on create_task", async () => {
    await call("create_task", {
      projectId: "p1",
      title: "T",
      description: "",
      priority: "medium",
      status: "to-do",
      progress: 40,
      isMilestone: true,
    });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/p1",
      method: "POST",
      body: {
        title: "T",
        description: "",
        priority: "medium",
        status: "to-do",
        progress: 40,
        isMilestone: true,
      },
    });
  });

  it("rejects an unknown field on create_task instead of silently dropping it", async () => {
    const result = await call("create_task", {
      projectId: "p1",
      title: "T",
      description: "",
      priority: "medium",
      status: "to-do",
      bogusField: "x",
    });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("forwards progress, isMilestone, and constraintType/constraintDate on update_task", async () => {
    apiFetch.mockResolvedValueOnce(
      Response.json({
        title: "T",
        description: "D",
        status: "open",
        priority: "medium",
        projectId: "p1",
        position: 1,
      }),
    );

    await call("update_task", {
      taskId: "t1",
      progress: 75,
      isMilestone: true,
      constraintType: "must_start_on",
      constraintDate: "2026-01-01T00:00:00Z",
    });

    const request = lastRequest();
    expect(request).toMatchObject({
      url: "http://api.test/api/task/t1",
      method: "PUT",
      body: {
        progress: 75,
        isMilestone: true,
        constraintType: "must_start_on",
        constraintDate: "2026-01-01T00:00:00Z",
      },
    });
  });

  it("omits progress/isMilestone/constraintType on update_task when not provided, leaving them untouched", async () => {
    apiFetch.mockResolvedValueOnce(
      Response.json({
        title: "T",
        description: "D",
        status: "open",
        priority: "medium",
        projectId: "p1",
        position: 1,
      }),
    );

    await call("update_task", { taskId: "t1", status: "done" });

    const body = lastRequest().body;
    expect(body).not.toHaveProperty("progress");
    expect(body).not.toHaveProperty("isMilestone");
    expect(body).not.toHaveProperty("constraintType");
    expect(body).not.toHaveProperty("constraintDate");
  });

  it("rejects an unknown field on update_task instead of silently dropping it", async () => {
    const result = await call("update_task", {
      taskId: "t1",
      status: "done",
      notARealField: 1,
    });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("forwards dependencyType and lagDays on create_task_relation", async () => {
    await call("create_task_relation", {
      sourceTaskId: "t1",
      targetTaskId: "t2",
      relationType: "blocks",
      dependencyType: "ss",
      lagDays: 7,
    });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task-relation",
      method: "POST",
      body: {
        sourceTaskId: "t1",
        targetTaskId: "t2",
        relationType: "blocks",
        dependencyType: "ss",
        lagDays: 7,
      },
    });
  });

  it("rejects an unknown field on create_task_relation instead of silently dropping it", async () => {
    const result = await call("create_task_relation", {
      sourceTaskId: "t1",
      targetTaskId: "t2",
      relationType: "blocks",
      typoField: true,
    });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("updates a task relation's dependencyType/lagDays", async () => {
    await call("update_task_relation", {
      id: "rel-1",
      dependencyType: "ff",
      lagDays: -2,
    });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task-relation/rel-1",
      method: "PATCH",
      body: { dependencyType: "ff", lagDays: -2 },
    });
  });

  it("rejects an unknown field on update_task_relation", async () => {
    const result = await call("update_task_relation", {
      id: "rel-1",
      dependencyType: "ff",
      extra: "nope",
    });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("sets and clears a task baseline", async () => {
    await call("set_task_baseline", { taskId: "t1" });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/t1/baseline",
      method: "POST",
    });

    await call("clear_task_baseline", { taskId: "t1" });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/t1/baseline",
      method: "DELETE",
    });
  });

  it("reads and updates the workspace calendar", async () => {
    await call("get_workspace_calendar", { workspaceId: "ws1" });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/calendar/ws1",
      method: "GET",
    });

    await call("update_workspace_working_days", {
      workspaceId: "ws1",
      workingDays: 62,
    });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/calendar/ws1",
      method: "PUT",
      body: { workingDays: 62 },
    });
  });

  it("adds and removes a workspace holiday", async () => {
    await call("add_workspace_holiday", {
      workspaceId: "ws1",
      date: "2026-12-25",
      name: "Christmas",
    });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/calendar/ws1/holidays",
      method: "POST",
      body: { date: "2026-12-25", name: "Christmas" },
    });

    await call("delete_workspace_holiday", {
      workspaceId: "ws1",
      holidayId: "hol-1",
    });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/calendar/ws1/holidays/hol-1",
      method: "DELETE",
    });
  });
});
