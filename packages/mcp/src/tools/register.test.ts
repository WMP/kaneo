import { describe, expect, it, vi } from "vitest";
import { registerTools } from "./register.js";

type RegisteredTool = {
  name: string;
  config: { inputSchema?: { parse: (args: unknown) => unknown } };
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
};

function createServerMock() {
  const tools = new Map<string, RegisteredTool>();

  return {
    server: {
      registerTool: vi.fn(
        (
          name: string,
          config: RegisteredTool["config"],
          handler: RegisteredTool["handler"],
        ) => {
          tools.set(name, { name, config, handler });
        },
      ),
    },
    tools,
  };
}

describe("registerTools", () => {
  it("registers the MCP tools", () => {
    const { server } = createServerMock();
    const client = { json: vi.fn() };

    registerTools(server as never, { client: client as never });

    expect(server.registerTool).toHaveBeenCalled();
    expect(server.registerTool).toHaveBeenCalledWith(
      "whoami",
      expect.any(Object),
      expect.any(Function),
    );
    expect(server.registerTool).toHaveBeenCalledWith(
      "update_task",
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("builds the expected query string for list_tasks", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi.fn().mockResolvedValue([{ id: "task-1" }]),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("list_tasks")?.handler({
      projectId: "project 1",
      status: "open",
      page: 2,
      relatedPage: 3,
      sortOrder: "desc",
    });

    expect(client.json).toHaveBeenCalledWith(
      "/api/task/tasks/project%201?status=open&page=2&relatedPage=3&sortOrder=desc",
      { method: "GET" },
    );
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify([{ id: "task-1" }], null, 2),
        },
      ],
      isError: false,
    });
  });

  it("list_tasks attaches every task's custom field values from a single bulk request", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            id: "project-1",
            columns: [
              {
                id: "todo",
                tasks: [{ id: "task-1" }, { id: "task-2" }],
              },
            ],
            archivedTasks: [{ id: "task-3" }],
            plannedTasks: [],
          },
          pagination: { total: 3, page: 1, pageSize: 50, totalPages: 1 },
        })
        .mockResolvedValueOnce([
          {
            id: "v1",
            taskId: "task-1",
            fieldId: "f1",
            value: "42",
            fieldName: "Story points",
            fieldPosition: 0,
            fieldType: "number",
            fieldOptions: null,
          },
          {
            id: "v2",
            taskId: "task-3",
            fieldId: "f1",
            value: "8",
            fieldName: "Story points",
            fieldPosition: 0,
            fieldType: "number",
            fieldOptions: null,
          },
        ]),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("list_tasks")?.handler({
      projectId: "project-1",
    });

    // Exactly one board fetch and one bulk custom-field fetch, regardless of
    // how many tasks are on the page: no per-task request (no N+1).
    expect(client.json).toHaveBeenCalledTimes(2);
    expect(client.json).toHaveBeenNthCalledWith(
      2,
      "/api/custom-field/project/project-1/values",
      { method: "GET" },
    );

    const body = JSON.parse(result?.content[0]?.text ?? "{}");
    expect(body.data.columns[0].tasks[0]).toMatchObject({
      id: "task-1",
      customFields: [
        { fieldId: "f1", name: "Story points", type: "number", value: "42" },
      ],
    });
    expect(body.data.columns[0].tasks[1]).toMatchObject({
      id: "task-2",
      customFields: [],
    });
    expect(body.data.archivedTasks[0]).toMatchObject({
      id: "task-3",
      customFields: [
        { fieldId: "f1", name: "Story points", type: "number", value: "8" },
      ],
    });
  });

  it("get_task attaches the task's custom field values", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi
        .fn()
        .mockResolvedValueOnce({ id: "task-1", title: "Ship it" })
        .mockResolvedValueOnce([
          {
            id: "v1",
            taskId: "task-1",
            fieldId: "f1",
            value: "yes",
            fieldName: "Approved",
            fieldPosition: 0,
            fieldType: "boolean",
            fieldOptions: null,
          },
        ]),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("get_task")?.handler({ taskId: "task-1" });

    expect(client.json).toHaveBeenNthCalledWith(1, "/api/task/task-1", {
      method: "GET",
    });
    expect(client.json).toHaveBeenNthCalledWith(
      2,
      "/api/custom-field/task/task-1",
      { method: "GET" },
    );

    const body = JSON.parse(result?.content[0]?.text ?? "{}");
    expect(body).toMatchObject({
      id: "task-1",
      title: "Ship it",
      customFields: [
        { fieldId: "f1", name: "Approved", type: "boolean", value: "yes" },
      ],
    });
  });

  it("fetches the current task and sends a full body for update_task", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi
        .fn()
        .mockResolvedValueOnce({
          title: "Draft spec",
          description: "Write docs",
          status: "open",
          priority: "medium",
          projectId: "project-1",
          position: 4,
        })
        .mockResolvedValueOnce({ id: "task-1", status: "done" }),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("update_task")?.handler({
      taskId: "task-1",
      status: "done",
    });

    expect(client.json).toHaveBeenNthCalledWith(1, "/api/task/task-1", {
      method: "GET",
    });
    const putCall = client.json.mock.calls[1];
    expect(putCall?.[0]).toBe("/api/task/task-1");
    const putBody = JSON.parse(
      String((putCall?.[1] as { body?: string })?.body ?? "{}"),
    );
    expect(putBody).toEqual(
      expect.objectContaining({
        title: "Draft spec",
        description: "Write docs",
        status: "done",
        priority: "medium",
        projectId: "project-1",
        position: 4,
      }),
    );
    expect(result?.isError).toBe(false);
  });

  it("fetches the current project and sends a full body for update_project", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi
        .fn()
        .mockResolvedValueOnce({
          name: "Roadmap",
          slug: "roadmap",
        })
        .mockResolvedValueOnce({ id: "project-1", name: "Roadmap v2" }),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("update_project")?.handler({
      id: "project-1",
      name: "Roadmap v2",
    });

    expect(client.json).toHaveBeenNthCalledWith(1, "/api/project/project-1", {
      method: "GET",
    });
    const putCall = client.json.mock.calls[1];
    expect(putCall?.[0]).toBe("/api/project/project-1");
    const putBody = JSON.parse(
      String((putCall?.[1] as { body?: string })?.body ?? "{}"),
    );
    expect(putBody).toEqual({
      name: "Roadmap v2",
      icon: "Layout",
      slug: "roadmap",
      description: "",
      isPublic: false,
    });
    expect(result?.isError).toBe(false);
  });

  it("returns an MCP error result when the client request fails", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi.fn().mockRejectedValue(new Error("boom")),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("whoami")?.handler({});

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: "boom" }, null, 2),
        },
      ],
      isError: true,
    });
  });

  it("validates label colors as hex values", () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn() };

    registerTools(server as never, { client: client as never });

    const schema = tools.get("create_label")?.config.inputSchema;
    expect(schema).toBeDefined();
    expect(() =>
      schema?.parse({
        name: "Bug",
        color: "red",
        workspaceId: "workspace-1",
      }),
    ).toThrow(/hex color/i);
  });

  it("validates task date filters as ISO datetimes with timezone", () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn() };

    registerTools(server as never, { client: client as never });

    const schema = tools.get("list_tasks")?.config.inputSchema;
    expect(schema).toBeDefined();
    expect(() =>
      schema?.parse({
        projectId: "project-1",
        dueBefore: "2026-04-04",
      }),
    ).toThrow();
  });

  it("creates a task relation with the expected body", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi.fn().mockResolvedValue({ id: "rel-1", relationType: "blocks" }),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("create_task_relation")?.handler({
      sourceTaskId: "task-1",
      targetTaskId: "task-2",
      relationType: "blocks",
    });

    expect(client.json).toHaveBeenCalledWith("/api/task-relation", {
      method: "POST",
      body: JSON.stringify({
        sourceTaskId: "task-1",
        targetTaskId: "task-2",
        relationType: "blocks",
      }),
    });
    expect(result?.isError).toBe(false);
  });

  it("validates relationType for create_task_relation", () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn() };

    registerTools(server as never, { client: client as never });

    const schema = tools.get("create_task_relation")?.config.inputSchema;
    expect(schema).toBeDefined();
    expect(() =>
      schema?.parse({
        sourceTaskId: "task-1",
        targetTaskId: "task-2",
        relationType: "duplicate",
      }),
    ).toThrow();
  });

  it("gets task relations by task id", async () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn().mockResolvedValue([]) };

    registerTools(server as never, { client: client as never });

    await tools.get("get_task_relations")?.handler({ taskId: "task 1" });

    expect(client.json).toHaveBeenCalledWith("/api/task-relation/task%201", {
      method: "GET",
    });
  });

  it("deletes a task relation by id", async () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn().mockResolvedValue({}) };

    registerTools(server as never, { client: client as never });

    await tools.get("delete_task_relation")?.handler({ id: "rel-1" });

    expect(client.json).toHaveBeenCalledWith("/api/task-relation/rel-1", {
      method: "DELETE",
    });
  });

  it("deletes a task-associated label after a preflight check", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi
        .fn()
        .mockResolvedValueOnce({ id: "label-1", taskId: "task-1" })
        .mockResolvedValueOnce({ id: "label-1" }),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("delete_label")?.handler({ id: "label-1" });

    expect(client.json).toHaveBeenNthCalledWith(1, "/api/label/label-1", {
      method: "GET",
    });
    expect(client.json).toHaveBeenNthCalledWith(2, "/api/label/label-1", {
      method: "DELETE",
    });
    expect(result?.isError).toBe(false);
  });

  it("refuses to delete a workspace label (taskId null)", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi.fn().mockResolvedValue({ id: "label-1", taskId: null }),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("delete_label")?.handler({ id: "label-1" });

    expect(result?.isError).toBe(true);
    expect(client.json).toHaveBeenCalledTimes(1);
    expect(client.json).toHaveBeenCalledWith("/api/label/label-1", {
      method: "GET",
    });
  });

  it("lists a project's custom field definitions", async () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn().mockResolvedValue([]) };

    registerTools(server as never, { client: client as never });

    await tools
      .get("list_project_custom_fields")
      ?.handler({ projectId: "project 1" });

    expect(client.json).toHaveBeenCalledWith(
      "/api/custom-field/project/project%201",
      { method: "GET" },
    );
  });

  it("gets a task's custom field values", async () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn().mockResolvedValue([]) };

    registerTools(server as never, { client: client as never });

    await tools.get("get_task_custom_fields")?.handler({ taskId: "task-1" });

    expect(client.json).toHaveBeenCalledWith("/api/custom-field/task/task-1", {
      method: "GET",
    });
  });

  it("sets a task's custom field value", async () => {
    const { server, tools } = createServerMock();
    const client = {
      json: vi.fn().mockResolvedValue({ id: "value-1" }),
    };

    registerTools(server as never, { client: client as never });

    const result = await tools.get("set_task_custom_field_value")?.handler({
      taskId: "task-1",
      fieldId: "field-1",
      value: "Approved",
    });

    expect(client.json).toHaveBeenCalledWith("/api/custom-field/value", {
      method: "PUT",
      body: JSON.stringify({
        taskId: "task-1",
        fieldId: "field-1",
        value: "Approved",
      }),
    });
    expect(result?.isError).toBe(false);
  });

  it("rejects unknown fields on set_task_custom_field_value", () => {
    const { server, tools } = createServerMock();
    const client = { json: vi.fn() };

    registerTools(server as never, { client: client as never });

    const schema = tools.get("set_task_custom_field_value")?.config.inputSchema;
    expect(schema).toBeDefined();
    expect(() =>
      schema?.parse({
        taskId: "task-1",
        fieldId: "field-1",
        value: "Approved",
        extra: "nope",
      }),
    ).toThrow();
  });
});
