import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { publishEvent } from "../../apps/api/src/events";
import { resolveProjectAccess } from "../../apps/api/src/utils/project-access";
import {
  ACCESS_REVALIDATE_MS,
  addConnection,
  closeUserProjectConnections,
  closeUserWorkspaceConnections,
  initializeWebSocketAdapter,
  removeConnection,
  shutdownWebSocketAdapter,
} from "../../apps/api/src/ws";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// WebSocket delivery of project data must follow project membership: a socket
// gets only payloads about its own project, ids of tasks in another project are
// stripped from relation events, and a socket whose membership ended is closed
// (explicitly, or on delivery once its access was last confirmed
// ACCESS_REVALIDATE_MS ago). See docs/plans/project-membership.md.

// Delivery revalidation goes through resolveProjectAccess; wrap it so tests can
// count, delay and fail those checks while the real decision still runs.
vi.mock("../../apps/api/src/utils/project-access", async (original) => {
  const actual =
    await original<typeof import("../../apps/api/src/utils/project-access")>();
  return {
    ...actual,
    resolveProjectAccess: vi.fn(actual.resolveProjectAccess),
  };
});

type Fake = { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
const opened: Array<{ projectId: string; conn: unknown }> = [];

function connect(
  projectId: string,
  userId: string,
  workspaceId: string,
  initiator = `${userId}-window`,
) {
  const ws: Fake = { send: vi.fn(), close: vi.fn() };
  const conn = addConnection(
    projectId,
    ws as never,
    userId,
    initiator,
    workspaceId,
  );
  opened.push({ projectId, conn });
  return ws;
}

function messages(ws: Fake) {
  return ws.send.mock.calls.map(([data]) => JSON.parse(data as string));
}

async function buildWorld() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const workspaceId = owner.workspace.id;
  const p1 = await createProjectFixture({ workspaceId, members: "none" });
  const p2 = await createProjectFixture({ workspaceId, members: "none" });
  const u = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(p1.project.id, u.id, "member");
  const w = await addWorkspaceMember(workspaceId, "member");
  await addProjectMember(p1.project.id, w.id, "member");
  await addProjectMember(p2.project.id, w.id, "member");
  const a = await addWorkspaceMember(workspaceId, "admin");
  const [t1] = await db
    .insert(schema.taskTable)
    .values({
      projectId: p1.project.id,
      title: "in P1",
      status: "to-do",
      number: 1,
    })
    .returning();
  const [t2] = await db
    .insert(schema.taskTable)
    .values({
      projectId: p2.project.id,
      title: "in P2",
      status: "to-do",
      number: 1,
    })
    .returning();
  return { owner, workspaceId, p1, p2, u, w, a, t1, t2 };
}

beforeEach(async () => {
  await resetTestDatabase();
  await initializeWebSocketAdapter();
});

afterEach(async () => {
  vi.useRealTimers();
  for (const { projectId, conn } of opened.splice(0)) {
    removeConnection(projectId, conn as never);
  }
  await shutdownWebSocketAdapter();
});

describe("what a project socket receives", () => {
  it("a socket on P1 gets nothing derived from P2", async () => {
    const w = await buildWorld();
    const uSocket = connect(w.p1.project.id, w.u.id, w.workspaceId);
    const adminOnP2 = connect(w.p2.project.id, w.a.id, w.workspaceId);

    await publishEvent("task.updated", {
      taskId: w.t2.id,
      projectId: w.p2.project.id,
      userId: w.a.id,
    });
    await vi.waitFor(() => expect(adminOnP2.send).toHaveBeenCalled());
    expect(uSocket.send).not.toHaveBeenCalled();
  });

  it("relation events carry only ids of tasks in the receiving project", async () => {
    const w = await buildWorld();
    const onP1 = connect(w.p1.project.id, w.u.id, w.workspaceId);
    const onP2 = connect(w.p2.project.id, w.a.id, w.workspaceId);
    const relation = {
      id: "rel-1",
      sourceTaskId: w.t1.id,
      targetTaskId: w.t2.id,
      relationType: "blocks",
      taskId: w.t1.id,
      userId: w.a.id,
    };

    // The events a cross-project relation publishes once per project; the
    // publisher lists the relation's tasks that live in the event's project.
    await publishEvent("task-relation.created", {
      ...relation,
      projectId: w.p1.project.id,
      projectTaskIds: [w.t1.id],
    });
    await publishEvent("task-relation.created", {
      ...relation,
      projectId: w.p2.project.id,
      projectTaskIds: [w.t2.id],
      secondaryNotification: true,
    });
    await vi.waitFor(() => {
      expect(onP1.send).toHaveBeenCalled();
      expect(onP2.send).toHaveBeenCalled();
    });

    const [forP1] = messages(onP1);
    expect(forP1).toMatchObject({
      type: "TASK_RELATION_UPDATED",
      projectId: w.p1.project.id,
      taskId: w.t1.id,
      sourceTaskId: w.t1.id,
    });
    expect(forP1.targetTaskId).toBeUndefined();
    expect(JSON.stringify(messages(onP1))).not.toContain(w.t2.id);

    const [forP2] = messages(onP2);
    expect(forP2).toMatchObject({
      type: "TASK_RELATION_UPDATED",
      projectId: w.p2.project.id,
      taskId: "",
      targetTaskId: w.t2.id,
    });
    expect(forP2.sourceTaskId).toBeUndefined();
    expect(JSON.stringify(messages(onP2))).not.toContain(w.t1.id);
  });

  it("a relation event without projectTaskIds carries no relation id at all", async () => {
    const w = await buildWorld();
    const onP1 = connect(w.p1.project.id, w.u.id, w.workspaceId);
    const onP2 = connect(w.p2.project.id, w.a.id, w.workspaceId);
    const relation = {
      id: "rel-3",
      sourceTaskId: w.t1.id,
      targetTaskId: w.t2.id,
      relationType: "blocks",
      taskId: w.t1.id,
      userId: w.a.id,
    };
    await publishEvent("task-relation.created", {
      ...relation,
      projectId: w.p1.project.id,
    });
    await publishEvent("task-relation.created", {
      ...relation,
      projectId: w.p2.project.id,
      secondaryNotification: true,
    });
    await vi.waitFor(() => {
      expect(onP1.send).toHaveBeenCalled();
      expect(onP2.send).toHaveBeenCalled();
    });
    const [forP1] = messages(onP1);
    // No fallback: nothing is sent that the publisher did not list.
    expect(forP1.taskId).toBe("");
    expect(forP1.sourceTaskId).toBeUndefined();
    expect(forP1.targetTaskId).toBeUndefined();
    const [forP2] = messages(onP2);
    expect(forP2.taskId).toBe("");
    expect(forP2.sourceTaskId).toBeUndefined();
    expect(forP2.targetTaskId).toBeUndefined();
  });

  it("a same-project relation keeps both ids", async () => {
    const w = await buildWorld();
    const [t1b] = await db
      .insert(schema.taskTable)
      .values({
        projectId: w.p1.project.id,
        title: "also in P1",
        status: "to-do",
        number: 2,
      })
      .returning();
    const onP1 = connect(w.p1.project.id, w.u.id, w.workspaceId);
    await publishEvent("task-relation.created", {
      id: "rel-2",
      sourceTaskId: w.t1.id,
      targetTaskId: t1b.id,
      relationType: "related",
      taskId: w.t1.id,
      projectId: w.p1.project.id,
      projectTaskIds: [w.t1.id, t1b.id],
      userId: w.a.id,
    });
    await vi.waitFor(() => expect(onP1.send).toHaveBeenCalled());
    expect(messages(onP1)[0]).toMatchObject({
      taskId: w.t1.id,
      sourceTaskId: w.t1.id,
      targetTaskId: t1b.id,
    });
  });
});

describe("closing sockets when access ends", () => {
  it("delivery closes a socket whose membership was removed once the revalidation window passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = await buildWorld();
    const removed = connect(w.p1.project.id, w.u.id, w.workspaceId);
    const stays = connect(w.p1.project.id, w.w.id, w.workspaceId);
    const update = () =>
      publishEvent("task.updated", {
        taskId: w.t1.id,
        projectId: w.p1.project.id,
        userId: w.a.id,
      });

    await db
      .delete(schema.projectMemberTable)
      .where(eq(schema.projectMemberTable.userId, w.u.id));

    // Inside the window the last confirmation still counts.
    await update();
    await vi.waitFor(() => expect(stays.send).toHaveBeenCalledTimes(1));
    expect(removed.send).toHaveBeenCalledTimes(1);
    expect(removed.close).not.toHaveBeenCalled();

    // After it, delivery re-checks and closes the socket instead of sending.
    vi.setSystemTime(Date.now() + ACCESS_REVALIDATE_MS + 1000);
    await update();
    await vi.waitFor(() => expect(stays.send).toHaveBeenCalledTimes(2));
    expect(removed.send).toHaveBeenCalledTimes(1);
    expect(removed.close).toHaveBeenCalledWith(1008, "Project access revoked");
    expect(stays.close).not.toHaveBeenCalled();

    // The closed connection is gone: later events do not reach it either.
    await update();
    await vi.waitFor(() => expect(stays.send).toHaveBeenCalledTimes(3));
    expect(removed.send).toHaveBeenCalledTimes(1);
  });

  it("a user who keeps access is confirmed again and stays connected", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = await buildWorld();
    const socket = connect(w.p1.project.id, w.u.id, w.workspaceId);
    vi.setSystemTime(Date.now() + ACCESS_REVALIDATE_MS + 1000);
    await publishEvent("task.updated", {
      taskId: w.t1.id,
      projectId: w.p1.project.id,
      userId: w.a.id,
    });
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(1));
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("a user who left the workspace is closed even though a project row remains", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = await buildWorld();
    const socket = connect(w.p1.project.id, w.u.id, w.workspaceId);
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, w.u.id));
    vi.setSystemTime(Date.now() + ACCESS_REVALIDATE_MS + 1000);
    await publishEvent("task.updated", {
      taskId: w.t1.id,
      projectId: w.p1.project.id,
      userId: w.a.id,
    });
    await vi.waitFor(() => expect(socket.close).toHaveBeenCalled());
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("full-access users are not closed for lacking a project row", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = await buildWorld();
    const socket = connect(w.p1.project.id, w.a.id, w.workspaceId);
    vi.setSystemTime(Date.now() + ACCESS_REVALIDATE_MS + 1000);
    await publishEvent("task.updated", {
      taskId: w.t1.id,
      projectId: w.p1.project.id,
      userId: w.u.id,
    });
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled());
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("closeUserProjectConnections closes one user's sockets on one project at once", async () => {
    const w = await buildWorld();
    const target = connect(w.p1.project.id, w.w.id, w.workspaceId);
    const otherProject = connect(w.p2.project.id, w.w.id, w.workspaceId);
    const otherUser = connect(w.p1.project.id, w.u.id, w.workspaceId);

    await closeUserProjectConnections(w.w.id, w.p1.project.id);

    expect(target.close).toHaveBeenCalledWith(1008, "Project access revoked");
    expect(otherProject.close).not.toHaveBeenCalled();
    expect(otherUser.close).not.toHaveBeenCalled();
  });

  it("closeUserWorkspaceConnections closes every project socket of the user in that workspace", async () => {
    const w = await buildWorld();
    const first = connect(w.p1.project.id, w.w.id, w.workspaceId);
    const second = connect(w.p2.project.id, w.w.id, w.workspaceId);
    const otherUser = connect(w.p1.project.id, w.u.id, w.workspaceId);
    const foreign = await createWorkspaceMember();
    const foreignProject = await createProjectFixture({
      workspaceId: foreign.workspace.id,
      members: "none",
    });
    const foreignSocket = connect(
      foreignProject.project.id,
      w.w.id,
      foreign.workspace.id,
    );

    await closeUserWorkspaceConnections(w.w.id, w.workspaceId);

    expect(first.close).toHaveBeenCalled();
    expect(second.close).toHaveBeenCalled();
    expect(otherUser.close).not.toHaveBeenCalled();
    expect(foreignSocket.close).not.toHaveBeenCalled();
  });
});

describe("revalidating the credential that opened the socket", () => {
  const later = () =>
    vi.setSystemTime(Date.now() + ACCESS_REVALIDATE_MS + 1000);
  const update = (w: Awaited<ReturnType<typeof buildWorld>>) =>
    publishEvent("task.updated", {
      taskId: w.t1.id,
      projectId: w.p1.project.id,
      userId: w.a.id,
    });

  async function apiKeyFor(userId: string, overrides = {}) {
    const [key] = await db
      .insert(schema.apikeyTable)
      .values({
        id: `key-${Math.random().toString(36).slice(2)}`,
        referenceId: userId,
        userId,
        key: "hashed",
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      })
      .returning();
    return key;
  }

  function connectWith(
    w: Awaited<ReturnType<typeof buildWorld>>,
    userId: string,
    credential: Record<string, unknown>,
  ) {
    const ws: Fake = { send: vi.fn(), close: vi.fn() };
    const conn = addConnection(
      w.p1.project.id,
      ws as never,
      userId,
      `${userId}-window`,
      w.workspaceId,
      credential,
    );
    opened.push({ projectId: w.p1.project.id, conn });
    return ws;
  }

  it("closes an API-key socket once the key is disabled, deleted or expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = await buildWorld();
    const live = await apiKeyFor(w.u.id);
    const disabled = await apiKeyFor(w.u.id);
    const deleted = await apiKeyFor(w.u.id);
    const expired = await apiKeyFor(w.u.id, {
      expiresAt: new Date(Date.now() + 30_000),
    });
    const sockets = {
      live: connectWith(w, w.u.id, { apiKeyId: live.id }),
      disabled: connectWith(w, w.u.id, { apiKeyId: disabled.id }),
      deleted: connectWith(w, w.u.id, { apiKeyId: deleted.id }),
      expired: connectWith(w, w.u.id, { apiKeyId: expired.id }),
    };
    await db
      .update(schema.apikeyTable)
      .set({ enabled: false })
      .where(eq(schema.apikeyTable.id, disabled.id));
    await db
      .delete(schema.apikeyTable)
      .where(eq(schema.apikeyTable.id, deleted.id));

    later();
    await update(w);
    await vi.waitFor(() => expect(sockets.live.send).toHaveBeenCalled());
    expect(sockets.live.close).not.toHaveBeenCalled();
    for (const key of ["disabled", "deleted", "expired"] as const) {
      expect(sockets[key].close).toHaveBeenCalledWith(
        1008,
        "Session or API key is no longer valid",
      );
      expect(sockets[key].send).not.toHaveBeenCalled();
    }
  });

  it("closes a session socket once the session is revoked or has expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = await buildWorld();
    const session = (id: string, expiresAt: Date) =>
      db
        .insert(schema.sessionTable)
        .values({
          id,
          token: `token-${id}`,
          userId: w.u.id,
          expiresAt,
          updatedAt: new Date(),
        })
        .returning();
    const farOff = new Date(Date.now() + 24 * 3600 * 1000);
    await session("s-live", farOff);
    await session("s-revoked", farOff);
    await session("s-expired", new Date(Date.now() + 30_000));
    const live = connectWith(w, w.u.id, {
      sessionId: "s-live",
      expiresAt: farOff.getTime(),
    });
    const revoked = connectWith(w, w.u.id, {
      sessionId: "s-revoked",
      expiresAt: farOff.getTime(),
    });
    const expired = connectWith(w, w.u.id, {
      sessionId: "s-expired",
      expiresAt: Date.now() + 30_000,
    });
    await db
      .delete(schema.sessionTable)
      .where(eq(schema.sessionTable.id, "s-revoked"));

    later();
    await update(w);
    await vi.waitFor(() => expect(live.send).toHaveBeenCalled());
    expect(live.close).not.toHaveBeenCalled();
    for (const socket of [revoked, expired]) {
      expect(socket.close).toHaveBeenCalledWith(
        1008,
        "Session or API key is no longer valid",
      );
      expect(socket.send).not.toHaveBeenCalled();
    }
  });

  it("re-reads a session whose expiry passed before the revalidation window, and keeps one that was extended", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = await buildWorld();
    const soon = Date.now() + 10_000;
    await db.insert(schema.sessionTable).values({
      id: "s-extended",
      token: "token-extended",
      userId: w.u.id,
      // Better Auth pushed the expiry out after the socket opened.
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      updatedAt: new Date(),
    });
    const socket = connectWith(w, w.u.id, {
      sessionId: "s-extended",
      expiresAt: soon,
    });
    // Well inside the 60 s window, but past the expiry known at the upgrade.
    vi.setSystemTime(Date.now() + 20_000);
    await update(w);
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(1));
    expect(socket.close).not.toHaveBeenCalled();
    // The new expiry was read back, so the next delivery needs no new check.
    vi.mocked(resolveProjectAccess).mockClear();
    await update(w);
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(2));
    expect(resolveProjectAccess).not.toHaveBeenCalled();
  });
});

describe("how revalidation behaves under load and failure", () => {
  const update = (
    w: Awaited<ReturnType<typeof buildWorld>>,
    taskId = w.t1.id,
  ) =>
    publishEvent("task.updated", {
      taskId,
      projectId: w.p1.project.id,
      userId: w.a.id,
    });

  it("shares one check per user and project between sockets and concurrent deliveries", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = await buildWorld();
    const first = connect(w.p1.project.id, w.u.id, w.workspaceId, "win-1");
    const second = connect(w.p1.project.id, w.u.id, w.workspaceId, "win-2");
    vi.setSystemTime(Date.now() + ACCESS_REVALIDATE_MS + 1000);
    vi.mocked(resolveProjectAccess).mockClear();
    // Two different messages, so both flush together and deliver concurrently.
    await update(w, w.t1.id);
    await update(w, "another-task");
    await vi.waitFor(() => {
      expect(first.send).toHaveBeenCalledTimes(2);
      expect(second.send).toHaveBeenCalledTimes(2);
    });
    expect(resolveProjectAccess).toHaveBeenCalledTimes(1);
  });

  it("does not close a socket when the check fails, skips that message and asks again next time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = await buildWorld();
    const socket = connect(w.p1.project.id, w.u.id, w.workspaceId);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.setSystemTime(Date.now() + ACCESS_REVALIDATE_MS + 1000);
    vi.mocked(resolveProjectAccess).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await update(w);
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    // Give the (skipped) delivery time to finish.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).not.toHaveBeenCalled();

    // The next delivery checks again, succeeds, and reaches the socket.
    await update(w);
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(1));
    expect(socket.close).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("dates a confirmation from the start of the check, not its end", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = await buildWorld();
    const socket = connect(w.p1.project.id, w.u.id, w.workspaceId);
    const start = Date.now();
    vi.setSystemTime(start + ACCESS_REVALIDATE_MS + 1000);
    const actual = await vi.importActual<
      typeof import("../../apps/api/src/utils/project-access")
    >("../../apps/api/src/utils/project-access");
    vi.mocked(resolveProjectAccess).mockClear();
    // The check takes 50 s of (fake) time.
    vi.mocked(resolveProjectAccess).mockImplementationOnce(
      async (userId, projectId) => {
        vi.setSystemTime(Date.now() + 50_000);
        return actual.resolveProjectAccess(userId, projectId);
      },
    );
    await update(w);
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(1));
    expect(resolveProjectAccess).toHaveBeenCalledTimes(1);

    // 70 s after the check began, 20 s after it ended: still due, because the
    // confirmation is dated from its start.
    vi.setSystemTime(start + ACCESS_REVALIDATE_MS + 1000 + 70_000);
    await update(w);
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(2));
    expect(resolveProjectAccess).toHaveBeenCalledTimes(2);
  });
});

describe("repeated failed checks", () => {
  const update = (w: Awaited<ReturnType<typeof buildWorld>>) =>
    publishEvent("task.updated", {
      taskId: w.t1.id,
      projectId: w.p1.project.id,
      userId: w.a.id,
    });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

  it("closes a connection with 1011 after three failed checks in a row, only that connection", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = await buildWorld();
    const failing = connect(w.p1.project.id, w.u.id, w.workspaceId);
    const healthy = connect(w.p1.project.id, w.w.id, w.workspaceId);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const actual = await vi.importActual<
      typeof import("../../apps/api/src/utils/project-access")
    >("../../apps/api/src/utils/project-access");
    // The check fails for one user only, whatever the delivery.
    vi.mocked(resolveProjectAccess).mockImplementation(
      async (userId, projectId) => {
        if (userId === w.u.id) throw new Error("database unavailable");
        return actual.resolveProjectAccess(userId, projectId);
      },
    );
    try {
      vi.setSystemTime(Date.now() + ACCESS_REVALIDATE_MS + 1000);
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        await update(w);
        await vi.waitFor(() =>
          expect(healthy.send).toHaveBeenCalledTimes(attempt),
        );
        await settle();
        // A blip: the message is skipped, the socket stays.
        expect(failing.send).not.toHaveBeenCalled();
        expect(failing.close).not.toHaveBeenCalled();
      }
      await update(w);
      await vi.waitFor(() => expect(failing.close).toHaveBeenCalledTimes(1));
      expect(failing.close).toHaveBeenCalledWith(
        1011,
        "Project access could not be verified",
      );
      expect(failing.send).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(healthy.send).toHaveBeenCalledTimes(3));
      expect(healthy.close).not.toHaveBeenCalled();
    } finally {
      vi.mocked(resolveProjectAccess).mockImplementation(
        actual.resolveProjectAccess,
      );
      error.mockRestore();
    }
  });

  it("an answered check resets the count", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = await buildWorld();
    const socket = connect(w.p1.project.id, w.u.id, w.workspaceId);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.setSystemTime(Date.now() + ACCESS_REVALIDATE_MS + 1000);
    const failOnce = () =>
      vi
        .mocked(resolveProjectAccess)
        .mockRejectedValueOnce(new Error("database unavailable"));

    // fail, fail, succeed, fail, fail: never three in a row.
    failOnce();
    await update(w);
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    await settle();
    failOnce();
    await update(w);
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(2));
    await settle();
    await update(w);
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(1));
    // The answered check confirmed the connection; force it due again.
    vi.setSystemTime(Date.now() + ACCESS_REVALIDATE_MS + 1000);
    failOnce();
    await update(w);
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(3));
    await settle();
    failOnce();
    await update(w);
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(4));
    await settle();
    expect(socket.close).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
