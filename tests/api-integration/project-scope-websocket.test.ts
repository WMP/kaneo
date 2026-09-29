import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { publishEvent } from "../../apps/api/src/events";
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

    // The event a cross-project relation publishes once per project.
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
