import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addConnection,
  broadcastToProject,
  initializeWebSocketAdapter,
  shutdownWebSocketAdapter,
} from "../../apps/api/src/ws";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// A project socket that fails while a broadcast is written is dropped; the
// healthy sockets of the same project still receive every later message.
beforeEach(async () => {
  await resetTestDatabase();
  delete process.env.REDIS_URL;
  await initializeWebSocketAdapter();
});

afterEach(async () => {
  await shutdownWebSocketAdapter();
  vi.restoreAllMocks();
});

function fakeWs(send: () => void = () => {}) {
  return {
    send: vi.fn(send),
    close: vi.fn(),
    readyState: 1,
    raw: undefined,
    url: null,
    protocol: null,
  } as never;
}

const sends = (ws: unknown) => (ws as { send: ReturnType<typeof vi.fn> }).send;

describe("project broadcast delivery", () => {
  it("drops a socket whose send throws and keeps delivering to the others", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const broken = fakeWs(() => {
      throw new Error("socket closed");
    });
    const healthy = fakeWs();
    addConnection(
      project.id,
      broken,
      member.user.id,
      "i1",
      member.workspace.id,
    );
    addConnection(
      project.id,
      healthy,
      member.user.id,
      "i2",
      member.workspace.id,
    );

    broadcastToProject(project.id, {
      type: "TASK_UPDATED",
      projectId: project.id,
      taskId: "t1",
    });
    await vi.waitFor(() => expect(sends(healthy)).toHaveBeenCalledTimes(1));
    expect(sends(broken)).toHaveBeenCalledTimes(1);

    broadcastToProject(project.id, {
      type: "TASK_UPDATED",
      projectId: project.id,
      taskId: "t2",
    });
    await vi.waitFor(() => expect(sends(healthy)).toHaveBeenCalledTimes(2));
    // The failed socket was removed and is not written again.
    expect(sends(broken)).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sends(healthy).mock.calls[1]?.[0])).toMatchObject({
      type: "TASK_UPDATED",
      taskId: "t2",
    });
  });
});
