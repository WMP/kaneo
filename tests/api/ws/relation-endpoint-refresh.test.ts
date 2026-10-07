import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  handlers: new Map<string, (data: Record<string, unknown>) => Promise<void>>(),
  related: vi.fn(),
  parents: vi.fn(),
}));

vi.mock("../../../apps/api/src/events", () => ({
  subscribeToEvent: (
    name: string,
    handler: (data: Record<string, unknown>) => Promise<void>,
  ) => {
    m.handlers.set(name, handler);
  },
  publishEvent: vi.fn(),
}));
vi.mock("../../../apps/api/src/task/get-subtask-parent-projects", () => ({
  getRelatedEndpointProjects: m.related,
  getSubtaskParentProjects: m.parents,
  getRelationSourceProject: vi.fn(),
}));
vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ workspaceId: "workspace" }] }),
      }),
    }),
  },
}));

import {
  addConnection,
  initializeWebSocketAdapter,
  removeConnection,
  shutdownWebSocketAdapter,
} from "../../../apps/api/src/ws";

function connect(projectId: string) {
  const ws = { send: vi.fn(), close: vi.fn() };
  const conn = addConnection(
    projectId,
    ws as never,
    "user",
    "window",
    "workspace",
  );
  return { ws, conn };
}

describe("cross-project relation endpoint refresh", () => {
  beforeEach(() => {
    m.related.mockReset();
    m.parents.mockReset().mockResolvedValue([]);
  });

  it("tells a project that shows the task only as a relation endpoint to refetch, without ids", async () => {
    vi.useFakeTimers();
    delete process.env.REDIS_URL;
    await initializeWebSocketAdapter();
    m.related.mockResolvedValue([{ projectId: "project-a" }]);
    const a = connect("project-a");

    await m.handlers.get("task.updated")?.({
      projectId: "project-b",
      taskId: "task-in-b",
      userId: "user",
    });
    await vi.advanceTimersByTimeAsync(100);

    expect(m.related).toHaveBeenCalledWith("task-in-b", "project-b");
    const sent = a.ws.send.mock.calls.map(([data]) => JSON.parse(data));
    expect(sent).toEqual([
      expect.objectContaining({
        type: "TASK_RELATION_UPDATED",
        projectId: "project-a",
        taskId: "",
      }),
    ]);
    expect(JSON.stringify(sent)).not.toContain("task-in-b");

    removeConnection("project-a", a.conn);
    await shutdownWebSocketAdapter();
    vi.useRealTimers();
  });

  it("does not look up related projects for events that do not change a relation summary", async () => {
    await m.handlers.get("comment.created")?.({
      projectId: "project-b",
      taskId: "task-in-b",
      userId: "user",
    });
    expect(m.related).not.toHaveBeenCalled();
  });
});
