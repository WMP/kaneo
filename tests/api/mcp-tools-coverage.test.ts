import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type McpToolRegistrar,
  registerMcpTools,
} from "../../apps/api/src/mcp/tools";

type ToolResult = { content: Array<{ text: string }>; isError?: boolean };
type ToolCallback = (args: unknown) => Promise<ToolResult>;

const tools = new Map<string, ToolCallback>();
const registrar: McpToolRegistrar = {
  registerTool: (name, _config, callback) => tools.set(name, callback),
};
registerMcpTools(registrar, "http://api.test", "test-token");

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

function request(index = -1) {
  const [input, init] = apiFetch.mock.calls.at(index) as [
    RequestInfo | URL,
    RequestInit | undefined,
  ];
  return {
    url: String(input),
    method: init?.method ?? "GET",
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  };
}

describe("MCP tools: request mapping", () => {
  it("whoami and list_workspaces call the Better Auth endpoints with GET", async () => {
    await call("whoami");
    expect(request()).toMatchObject({
      url: "http://api.test/api/auth/get-session",
      method: "GET",
    });
    await call("list_workspaces");
    expect(request()).toMatchObject({
      url: "http://api.test/api/auth/organization/list",
      method: "GET",
    });
  });

  it("list_projects sends includeArchived only when it is exactly true", async () => {
    await call("list_projects", { workspaceId: "w 1" });
    expect(request().url).toBe("http://api.test/api/project?workspaceId=w+1");
    await call("list_projects", { workspaceId: "w1", includeArchived: false });
    expect(request().url).toBe("http://api.test/api/project?workspaceId=w1");
    await call("list_projects", { workspaceId: "w1", includeArchived: true });
    expect(request().url).toBe(
      "http://api.test/api/project?workspaceId=w1&includeArchived=true",
    );
  });

  it("get_project encodes the id and create_project sends exactly four fields", async () => {
    await call("get_project", { id: "p/1" });
    expect(request().url).toBe("http://api.test/api/project/p%2F1");

    await call("create_project", {
      name: "Alpha",
      workspaceId: "w1",
      icon: "Folder",
      slug: "alpha",
    });
    expect(request()).toMatchObject({
      url: "http://api.test/api/project",
      method: "POST",
      body: { name: "Alpha", workspaceId: "w1", icon: "Folder", slug: "alpha" },
    });
  });

  it("update_project merges the patch over the stored project and keeps the rest", async () => {
    apiFetch.mockResolvedValueOnce(
      Response.json({
        name: "Old",
        icon: "Star",
        slug: "old",
        description: "stored description",
        isPublic: true,
      }),
    );
    await call("update_project", { id: "p1", name: "New" });

    expect(request(0)).toMatchObject({
      url: "http://api.test/api/project/p1",
      method: "GET",
    });
    expect(request(1)).toMatchObject({
      url: "http://api.test/api/project/p1",
      method: "PUT",
      body: {
        name: "New",
        icon: "Star",
        slug: "old",
        description: "stored description",
        isPublic: true,
      },
    });
  });

  it("update_project lets an explicit empty icon/description and false isPublic override the stored values", async () => {
    apiFetch.mockResolvedValueOnce(
      Response.json({
        name: "Old",
        icon: "Star",
        slug: "old",
        description: "d",
        isPublic: true,
      }),
    );
    await call("update_project", {
      id: "p1",
      icon: "",
      description: "",
      isPublic: false,
    });
    expect(request().body).toEqual({
      name: "Old",
      icon: "",
      slug: "old",
      description: "",
      isPublic: false,
    });
  });

  it("update_project falls back to defaults for missing stored optional fields", async () => {
    apiFetch.mockResolvedValueOnce(
      Response.json({ name: "Only", slug: "only" }),
    );
    await call("update_project", { id: "p1" });
    expect(request().body).toEqual({
      name: "Only",
      icon: "Layout",
      slug: "only",
      description: "",
      isPublic: false,
    });
  });

  it("update_project returns a tool error and does not PUT when name or slug is missing", async () => {
    apiFetch.mockResolvedValueOnce(Response.json({ slug: "s" }));
    const noName = await call("update_project", { id: "p1" });
    expect(noName.isError).toBe(true);
    expect(noName.content[0]?.text).toContain("missing name");
    expect(apiFetch).toHaveBeenCalledTimes(1);

    apiFetch.mockClear();
    apiFetch.mockResolvedValueOnce(Response.json({ name: "n" }));
    const noSlug = await call("update_project", { id: "p1" });
    expect(noSlug.isError).toBe(true);
    expect(noSlug.content[0]?.text).toContain("missing slug");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("list_tasks forwards only supplied filters and tolerates a failing custom-field request", async () => {
    apiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/custom-field/")) {
        return Response.json({ message: "forbidden" }, { status: 403 });
      }
      return Response.json({ data: { columns: [] } });
    });

    const result = await call("list_tasks", {
      projectId: "p1",
      status: "to-do",
      page: 2,
      limit: 10,
    });

    expect(result.isError).toBeFalsy();
    const boardCall = apiFetch.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes("/api/task/tasks/"));
    const url = new URL(boardCall as string);
    expect(url.pathname).toBe("/api/task/tasks/p1");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: "to-do",
      page: "2",
      limit: "10",
    });
  });

  it("get_task still returns the task when the custom-field request fails", async () => {
    apiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/custom-field/")) {
        return Response.json({ message: "nope" }, { status: 500 });
      }
      return Response.json({ id: "t1", title: "Hello" });
    });

    const result = await call("get_task", { taskId: "t1" });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]?.text ?? "")).toMatchObject({
      id: "t1",
      title: "Hello",
      customFields: [],
    });
  });

  it("move_task omits destinationStatus unless given", async () => {
    await call("move_task", { taskId: "t1", destinationProjectId: "p2" });
    expect(request()).toMatchObject({
      url: "http://api.test/api/task/move/t1",
      method: "PUT",
      body: { destinationProjectId: "p2" },
    });
    expect(request().body).not.toHaveProperty("destinationStatus");

    await call("move_task", {
      taskId: "t1",
      destinationProjectId: "p2",
      destinationStatus: "done",
    });
    expect(request().body).toEqual({
      destinationProjectId: "p2",
      destinationStatus: "done",
    });
  });

  it("maps status, comment and label tools to their endpoints", async () => {
    const cases: Array<[string, unknown, string, string, unknown]> = [
      [
        "update_task_status",
        { taskId: "t1", status: "done" },
        "http://api.test/api/task/status/t1",
        "PUT",
        { status: "done" },
      ],
      [
        "list_task_comments",
        { taskId: "t1" },
        "http://api.test/api/comment/t1",
        "GET",
        undefined,
      ],
      [
        "create_task_comment",
        { taskId: "t1", content: "hi" },
        "http://api.test/api/comment/t1",
        "POST",
        { content: "hi" },
      ],
      [
        "update_task_comment",
        { commentId: "c1", content: "edited" },
        "http://api.test/api/comment/c1",
        "PUT",
        { content: "edited" },
      ],
      [
        "delete_task_comment",
        { commentId: "c1" },
        "http://api.test/api/comment/c1",
        "DELETE",
        undefined,
      ],
      [
        "list_workspace_labels",
        { workspaceId: "w1" },
        "http://api.test/api/label/workspace/w1",
        "GET",
        undefined,
      ],
      [
        "attach_label_to_task",
        { labelId: "l1", taskId: "t1" },
        "http://api.test/api/label/l1/task",
        "PUT",
        { taskId: "t1" },
      ],
      [
        "detach_label_from_task",
        { labelId: "l1" },
        "http://api.test/api/label/l1/task",
        "DELETE",
        undefined,
      ],
      [
        "get_task_relations",
        { taskId: "t1" },
        "http://api.test/api/task-relation/t1",
        "GET",
        undefined,
      ],
      [
        "delete_task_relation",
        { id: "r1" },
        "http://api.test/api/task-relation/r1",
        "DELETE",
        undefined,
      ],
    ];
    for (const [name, args, url, method, body] of cases) {
      await call(name, args);
      expect(request(), name).toMatchObject({ url, method });
      expect(request().body, name).toEqual(body);
    }
  });

  it("create_label sends taskId only when supplied", async () => {
    await call("create_label", {
      name: "Bug",
      color: "#ff0000",
      workspaceId: "w1",
    });
    expect(request().body).toEqual({
      name: "Bug",
      color: "#ff0000",
      workspaceId: "w1",
    });
    await call("create_label", {
      name: "Bug",
      color: "#ff0000",
      workspaceId: "w1",
      taskId: "t1",
    });
    expect(request().body).toMatchObject({ taskId: "t1" });
    const bad = await call("create_label", {
      name: "Bug",
      color: "red",
      workspaceId: "w1",
    });
    expect(bad.isError).toBe(true);
  });

  it("create_task_relation and update_task_relation send the dependency fields only when given", async () => {
    await call("create_task_relation", {
      sourceTaskId: "a",
      targetTaskId: "b",
      relationType: "related",
    });
    expect(request().body).toEqual({
      sourceTaskId: "a",
      targetTaskId: "b",
      relationType: "related",
    });
    await call("update_task_relation", { id: "r1" });
    expect(request()).toMatchObject({
      url: "http://api.test/api/task-relation/r1",
      method: "PATCH",
      body: {},
    });
  });

  it("delete_label refuses a workspace-level label without sending DELETE", async () => {
    apiFetch.mockResolvedValueOnce(Response.json({ id: "l1", taskId: null }));
    const result = await call("delete_label", { id: "l1" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("not associated with a task");
    expect(apiFetch).toHaveBeenCalledTimes(1);

    apiFetch.mockClear();
    apiFetch.mockResolvedValueOnce(Response.json({ id: "l2", taskId: "t1" }));
    await call("delete_label", { id: "l2" });
    expect(request()).toMatchObject({
      url: "http://api.test/api/label/l2",
      method: "DELETE",
    });
  });
});

describe("MCP tools: update_task merge preconditions", () => {
  const complete = {
    id: "t1",
    title: "T",
    status: "to-do",
    priority: "low",
    projectId: "p1",
    position: 3,
    description: null,
  };

  async function updateWithStored(
    stored: Record<string, unknown>,
    patch: Record<string, unknown>,
  ) {
    apiFetch.mockResolvedValueOnce(Response.json(stored));
    const result = await call("update_task", { taskId: "t1", ...patch });
    // The only request is the GET: a refused merge never reaches the PUT.
    return result;
  }

  it("accepts a numeric-string position and clears a null description to an empty string", async () => {
    const result = await updateWithStored(
      { ...complete, position: "7" },
      { title: "Renamed" },
    );
    expect(result.isError).toBeFalsy();
    expect(request()).toMatchObject({
      method: "PUT",
      body: { title: "Renamed", position: 7, description: "" },
    });
  });

  it.each([
    ["position", { position: undefined }, "numeric `position`"],
    ["position", { position: "abc" }, "numeric `position`"],
    ["title", { title: undefined }, "missing title"],
    ["status", { status: undefined }, "missing status"],
    ["priority", { priority: undefined }, "invalid or missing priority"],
    ["priority", { priority: "critical" }, "invalid or missing priority"],
    ["projectId", { projectId: undefined }, "missing projectId"],
  ])(
    "refuses to PUT when the stored task has no usable %s",
    async (_f, override, message) => {
      const result = await updateWithStored(
        { ...complete, ...override },
        { description: "new" },
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(message);
      expect(apiFetch).toHaveBeenCalledTimes(1);
      expect(request().method).toBe("GET");
    },
  );

  it("keeps stored dates and primary assignee, and sends an empty userId when unassigning", async () => {
    await updateWithStored(
      {
        ...complete,
        startDate: "2026-01-01T00:00:00.000Z",
        dueDate: "2026-01-09T00:00:00.000Z",
        userId: "u1",
      },
      { title: "Keep" },
    );
    expect(request().body).toMatchObject({
      startDate: "2026-01-01T00:00:00.000Z",
      dueDate: "2026-01-09T00:00:00.000Z",
      userId: "u1",
    });

    apiFetch.mockClear();
    await updateWithStored({ ...complete, userId: "u1" }, { userId: null });
    expect(request().body).toMatchObject({ userId: "" });
  });

  it("surfaces a non-Error rejection as a tool error text", async () => {
    apiFetch.mockImplementation(async () => {
      throw "socket hang up";
    });
    const result = await call("whoami");
    expect(result.isError).toBe(true);
  });
});
