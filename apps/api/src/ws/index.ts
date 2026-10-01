import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { WSContext } from "hono/ws";
import db from "../database";
import { projectTable } from "../database/schema";
import { subscribeToEvent } from "../events";
import { isRedisConfigured } from "../redis";
import {
  getRelationSourceProject,
  getSubtaskParentProjects,
} from "../task/get-subtask-parent-projects";
import { resolveProjectAccess } from "../utils/project-access";
import type {
  AccessRevokedControl,
  BroadcastAdapter,
  BroadcastMessage,
  ProjectBroadcastMessage,
  UserBroadcast,
  UserBroadcastMessage,
} from "./broadcast-adapter";
import {
  type ConnectionCredential,
  readCredentialStatus,
} from "./connection-credentials";
import { InMemoryBroadcastAdapter } from "./in-memory-broadcast-adapter";
import { RedisBroadcastAdapter } from "./redis-broadcast-adapter";

const INSTANCE_ID = randomUUID();

type ProjectConnection = {
  ws: WSContext;
  userId: string;
  initiatorId: string;
  workspaceId: string;
  // When the user's access to the project (and the credential that opened the
  // socket) was last confirmed: at the upgrade, then again on delivery once
  // `ACCESS_REVALIDATE_MS` has passed. It is the time a check STARTED, so a slow
  // check never makes a connection look fresher than it is.
  validatedAt: number;
  // Consecutive revalidations that could not be decided (a database error), not
  // access being refused. Reset by any check that gets an answer.
  failedChecks: number;
} & ConnectionCredential;

// A socket is authorized once, at the upgrade. Membership can be removed, and a
// session or API key revoked, while it is open, so delivery re-checks a
// connection when its last check is this old (or its session's expiry has
// passed). This bounds how long a removed member keeps receiving events when
// nothing closed the socket explicitly (`closeUserProjectConnections`).
export const ACCESS_REVALIDATE_MS = 60_000;

// A check that cannot be decided skips the message for that connection and is
// asked again on the next delivery, so a single blip disconnects nobody. A
// connection that fails this many checks in a row is closed (1011, per
// connection, so a longer outage does not disconnect everyone at once) and its
// client reconnects and refetches instead of silently missing updates.
export const MAX_FAILED_ACCESS_CHECKS = 3;
const ACCESS_CHECK_FAILED_CLOSE_CODE = 1011;
const ACCESS_CHECK_FAILED_CLOSE_REASON = "Project access could not be verified";

export const ACCESS_REVOKED_CLOSE_CODE = 1008;
export const ACCESS_REVOKED_CLOSE_REASON = "Project access revoked";
export const CREDENTIAL_REVOKED_CLOSE_REASON =
  "Session or API key is no longer valid";

type UserConnection = {
  ws: WSContext;
};

/**
 * User-scoped connections: tracks WebSocket connections keyed by userId.
 * Used for delivering user-targeted events like NOTIFICATION_CREATED.
 */
const userConnections = new Map<string, Set<UserConnection>>();

export function addUserConnection(userId: string, ws: WSContext) {
  if (!userConnections.has(userId)) {
    userConnections.set(userId, new Set());
  }
  const conn: UserConnection = { ws };
  userConnections.get(userId)?.add(conn);
  return conn;
}

export function removeUserConnection(userId: string, conn: UserConnection) {
  const connections = userConnections.get(userId);
  if (connections) {
    connections.delete(conn);
    if (connections.size === 0) {
      userConnections.delete(userId);
    }
  }
}

export function broadcastToUser(userId: string, message: UserBroadcastMessage) {
  deliverToLocalUserConnections(userId, message);

  if (!adapter) {
    return;
  }

  void adapter
    .publishToUser({ userId, message, origin: INSTANCE_ID })
    .catch((err) => {
      console.error("Failed to publish a user broadcast:", err);
    });
}

function deliverToLocalUserConnections(
  userId: string,
  message: UserBroadcastMessage,
) {
  const connections = userConnections.get(userId);
  if (!connections) return;

  const payload = JSON.stringify(message);
  for (const conn of connections) {
    try {
      conn.ws.send(payload);
    } catch {
      connections.delete(conn);
    }
  }
  if (connections.size === 0) {
    userConnections.delete(userId);
  }
}

/**
 * Local connections: each instance tracks only its own WebSocket connections.
 */
const projectConnections = new Map<string, Set<ProjectConnection>>();

/**
 * Batching queues and timers local per-instance.
 * They accumulate messages before flushing to the broadcast adapter.
 */
const projectBroadcastQueues = new Map<
  string,
  Map<string, { message: ProjectBroadcastMessage; excludeInitiatorId?: string }>
>();
const projectBroadcastTimeouts = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

let adapter: BroadcastAdapter | null = null;

// --- Subscribe to incoming broadcasts and deliver to local connections ---
export async function initializeWebSocketAdapter() {
  if (adapter) return;

  const nextAdapter = isRedisConfigured()
    ? new RedisBroadcastAdapter()
    : new InMemoryBroadcastAdapter();

  try {
    await nextAdapter.subscribe((msg: BroadcastMessage) => {
      if ("control" in msg) {
        applyAccessRevoked(msg.projectId, msg.control);
        return;
      }
      return deliverToLocalConnections(
        msg.projectId,
        msg.message,
        msg.excludeInitiatorId,
      );
    });
    await nextAdapter.subscribeToUser((msg: UserBroadcast) => {
      if (msg.origin === INSTANCE_ID) {
        return;
      }
      deliverToLocalUserConnections(msg.userId, msg.message);
    });
  } catch (err) {
    await nextAdapter.shutdown().catch(() => {});
    throw err;
  }

  adapter = nextAdapter;
  console.log(`📡 WebSockets Initialized using: "${adapter.constructor.name}"`);
}

export async function shutdownWebSocketAdapter() {
  const pendingQueues = [...projectBroadcastQueues.entries()];

  for (const timeout of projectBroadcastTimeouts.values()) {
    clearTimeout(timeout);
  }
  projectBroadcastTimeouts.clear();
  projectBroadcastQueues.clear();

  const currentAdapter = adapter;
  if (currentAdapter) {
    await Promise.allSettled(
      pendingQueues.flatMap(([projectId, queue]) =>
        [...queue.values()].map(({ message, excludeInitiatorId }) =>
          currentAdapter.publish({ projectId, message, excludeInitiatorId }),
        ),
      ),
    );
  }

  await currentAdapter?.shutdown();
  adapter = null;
}

function closeLocalProjectConnections(projectId: string) {
  const timeout = projectBroadcastTimeouts.get(projectId);
  if (timeout) clearTimeout(timeout);
  projectBroadcastTimeouts.delete(projectId);
  projectBroadcastQueues.delete(projectId);
  const connections = projectConnections.get(projectId);
  projectConnections.delete(projectId);
  for (const conn of connections ?? []) {
    try {
      conn.ws.send(JSON.stringify({ type: "PROJECT_MOVED", projectId }));
    } catch {
      /* The socket may already be closed. */
    }
    try {
      conn.ws.close(1008, "Project workspace changed");
    } catch {
      /* Already closed. */
    }
  }
}

export async function closeProjectConnections(projectId: string) {
  closeLocalProjectConnections(projectId);
  try {
    await adapter?.publish({
      projectId,
      message: { type: "PROJECT_MOVED", projectId },
    });
  } catch (error) {
    // Delivery also checks the workspace, so missed Redis notifications cannot
    // leave old connections receiving future project updates.
    console.error("Failed to publish project move:", error);
  }
}

function dropConnection(
  projectId: string,
  conn: ProjectConnection,
  code: number,
  reason: string,
) {
  removeConnection(projectId, conn);
  try {
    conn.ws.close(code, reason);
  } catch {
    /* Already closed. */
  }
}

// Closes this instance's sockets of one user for one project (or, with an empty
// `projectId`, for every project of `workspaceId`).
function closeLocalUserConnections(
  userId: string,
  projectId: string,
  workspaceId?: string,
) {
  for (const [connectedProjectId, connections] of [...projectConnections]) {
    if (projectId ? connectedProjectId !== projectId : false) continue;
    for (const conn of [...connections]) {
      if (conn.userId !== userId) continue;
      if (!projectId && conn.workspaceId !== workspaceId) continue;
      dropConnection(
        connectedProjectId,
        conn,
        ACCESS_REVOKED_CLOSE_CODE,
        ACCESS_REVOKED_CLOSE_REASON,
      );
    }
  }
}

// A control message from another instance. The instance that issued it has
// already closed its own sockets, so an echo of its own message is ignored
// instead of walking the connections a second time.
function applyAccessRevoked(projectId: string, control: AccessRevokedControl) {
  if (control.origin === INSTANCE_ID) return;
  closeLocalUserConnections(control.userId, projectId, control.workspaceId);
}

async function publishAccessRevoked(
  projectId: string,
  control: Omit<AccessRevokedControl, "kind" | "origin">,
) {
  try {
    await adapter?.publish({
      projectId,
      control: { kind: "access-revoked", ...control, origin: INSTANCE_ID },
    });
  } catch (error) {
    // Local sockets are already closed, and delivery revalidates the rest.
    console.error("Failed to publish access revocation:", error);
  }
}

/**
 * Closes a user's sockets on a project on every API instance. Call it wherever
 * the user's access to the project ends: removing them from the project, changing
 * their project role to one that cannot be exercised, deleting their workspace
 * membership. Delivery would also close such a socket, but only within
 * `ACCESS_REVALIDATE_MS` and only when an event arrives.
 */
export async function closeUserProjectConnections(
  userId: string,
  projectId: string,
) {
  closeLocalUserConnections(userId, projectId);
  await publishAccessRevoked(projectId, { userId });
}

/** Same, for every project socket of the user inside one workspace. */
export async function closeUserWorkspaceConnections(
  userId: string,
  workspaceId: string,
) {
  closeLocalUserConnections(userId, "", workspaceId);
  await publishAccessRevoked("", { userId, workspaceId });
}

// Checks in flight, shared by everyone who asks for the same thing at once
// (many sockets of one user, several deliveries in a burst).
const inFlightChecks = new Map<string, Promise<unknown>>();
function shared<T>(key: string, run: () => Promise<T>): Promise<T> {
  let pending = inFlightChecks.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = run().finally(() => inFlightChecks.delete(key));
    inFlightChecks.set(key, pending);
  }
  return pending;
}

type Verdict =
  | { ok: true; checkedAt: number; expiresAt?: number }
  | { ok: false; reason: string }
  | { ok: null }; // could not be decided: try again on the next delivery

async function checkProjectAccess(userId: string, projectId: string) {
  return shared(`access\u0000${userId}\u0000${projectId}`, async () => {
    const checkedAt = Date.now();
    return {
      checkedAt,
      allowed: Boolean(await resolveProjectAccess(userId, projectId)),
    };
  });
}

async function checkCredential(conn: ProjectConnection) {
  const id = conn.apiKeyId ?? conn.sessionId;
  if (!id) return { valid: true } as const;
  return shared(
    `credential\u0000${conn.apiKeyId ? "key" : "session"}\u0000${id}`,
    () => readCredentialStatus(conn.userId, conn),
  );
}

async function verdictFor(
  projectId: string,
  conn: ProjectConnection,
): Promise<Verdict> {
  try {
    const [access, credential] = await Promise.all([
      checkProjectAccess(conn.userId, projectId),
      checkCredential(conn),
    ]);
    if (!credential.valid) {
      return { ok: false, reason: CREDENTIAL_REVOKED_CLOSE_REASON };
    }
    if (!access.allowed) {
      return { ok: false, reason: ACCESS_REVOKED_CLOSE_REASON };
    }
    return {
      ok: true,
      checkedAt: access.checkedAt,
      expiresAt: "expiresAt" in credential ? credential.expiresAt : undefined,
    };
  } catch (error) {
    console.error("Failed to revalidate project socket access:", error);
    return { ok: null };
  }
}

// Re-checks the connections whose last confirmation is too old, or whose
// session expiry has passed (the session may have been extended since, which the
// check reads back). Returns the connections that must not receive THIS message:
// those that were closed, and those whose check could not be decided. A check
// that failed does not close anything (a database blip must not disconnect
// everyone); the connection is simply asked again on the next delivery.
async function revalidateConnections(
  projectId: string,
  recipients: ProjectConnection[],
) {
  const now = Date.now();
  const due = recipients.filter(
    (conn) =>
      now - conn.validatedAt >= ACCESS_REVALIDATE_MS ||
      (conn.expiresAt !== undefined && now >= conn.expiresAt),
  );
  const withheld = new Set<ProjectConnection>();

  await Promise.all(
    due.map(async (conn) => {
      const verdict = await verdictFor(projectId, conn);
      if (verdict.ok === true) {
        conn.failedChecks = 0;
        conn.validatedAt = verdict.checkedAt;
        if (verdict.expiresAt !== undefined) conn.expiresAt = verdict.expiresAt;
        return;
      }
      withheld.add(conn);
      if (verdict.ok === null) {
        conn.failedChecks += 1;
        if (conn.failedChecks >= MAX_FAILED_ACCESS_CHECKS) {
          dropConnection(
            projectId,
            conn,
            ACCESS_CHECK_FAILED_CLOSE_CODE,
            ACCESS_CHECK_FAILED_CLOSE_REASON,
          );
        }
        return;
      }
      if (verdict.ok === false) {
        dropConnection(
          projectId,
          conn,
          ACCESS_REVOKED_CLOSE_CODE,
          verdict.reason,
        );
      }
    }),
  );
  return withheld;
}

const workspaceLookups = new Map<string, Promise<string | null>>();
function currentProjectWorkspace(projectId: string) {
  let pending = workspaceLookups.get(projectId);
  if (!pending) {
    pending = db
      .select({ workspaceId: projectTable.workspaceId })
      .from(projectTable)
      .where(eq(projectTable.id, projectId))
      .limit(1)
      .then(([project]) => project?.workspaceId ?? null)
      .finally(() => workspaceLookups.delete(projectId));
    workspaceLookups.set(projectId, pending);
  }
  return pending;
}

async function deliverToLocalConnections(
  projectId: string,
  message: ProjectBroadcastMessage,
  excludeInitiatorId?: string,
) {
  if (message.type === "PROJECT_MOVED") {
    closeLocalProjectConnections(projectId);
    return;
  }
  const connections = projectConnections.get(projectId);
  if (!connections) return;
  const recipients = [...connections];
  let workspaceId: string | null;
  try {
    workspaceId = await currentProjectWorkspace(projectId);
  } catch (error) {
    console.error("Failed to validate project broadcast access:", error);
    workspaceId = null;
  }
  const payload = JSON.stringify(message);
  // Sockets whose access is gone are closed here, and ones that could not be
  // checked are skipped for this message; both are left out below.
  const rejected = await revalidateConnections(
    projectId,
    recipients.filter(
      (conn) => workspaceId !== null && conn.workspaceId === workspaceId,
    ),
  );
  for (const conn of recipients) {
    // A move may have closed these connections while the lookup was in flight.
    if (!projectConnections.get(projectId)?.has(conn)) continue;
    if (rejected.has(conn)) continue;
    if (conn.workspaceId !== workspaceId) {
      removeConnection(projectId, conn);
      try {
        conn.ws.close(1008, "Project workspace changed");
      } catch {
        /* Already closed. */
      }
      continue;
    }
    if (excludeInitiatorId && conn.initiatorId === excludeInitiatorId) continue;
    try {
      conn.ws.send(payload);
    } catch {
      removeConnection(projectId, conn);
    }
  }
}

export function addConnection(
  projectId: string,
  ws: WSContext,
  userId: string,
  initiatorId: string,
  workspaceId: string,
  credential: ConnectionCredential = {},
) {
  if (!projectConnections.has(projectId)) {
    projectConnections.set(projectId, new Set());
  }
  const conn: ProjectConnection = {
    ws,
    userId,
    initiatorId,
    workspaceId,
    validatedAt: Date.now(),
    failedChecks: 0,
    ...credential,
  };
  projectConnections.get(projectId)?.add(conn);
  return conn;
}

export function removeConnection(projectId: string, conn: ProjectConnection) {
  const connections = projectConnections.get(projectId);
  if (connections) {
    connections.delete(conn);
    if (connections.size === 0) {
      projectConnections.delete(projectId);
    }
  }
}

export function broadcastToProject(
  projectId: string,
  message: ProjectBroadcastMessage,
  excludeInitiatorId?: string,
) {
  if (!adapter) {
    console.warn("broadcastToProject called before adapter initialization");
    return;
  }

  if (!projectBroadcastQueues.has(projectId)) {
    projectBroadcastQueues.set(projectId, new Map());
  }

  const messageKey = `${message.type}:${message.taskId ?? ""}:${message.sourceTaskId ?? ""}:${message.targetTaskId ?? ""}`;
  projectBroadcastQueues
    .get(projectId)
    ?.set(messageKey, { message, excludeInitiatorId });

  if (projectBroadcastTimeouts.has(projectId)) {
    return;
  }

  const timeout = setTimeout(() => {
    projectBroadcastTimeouts.delete(projectId);
    const queue = projectBroadcastQueues.get(projectId);
    projectBroadcastQueues.delete(projectId);

    if (!queue || !adapter) return;

    // Publish each queued message through the adapter
    for (const { message: msg, excludeInitiatorId: exId } of queue.values()) {
      void adapter
        .publish({
          projectId,
          message: msg,
          excludeInitiatorId: exId,
        })
        .catch((err) => {
          console.error(
            `Failed to publish broadcast for project ${projectId}:`,
            err,
          );
        });
    }
  }, 100);

  projectBroadcastTimeouts.set(projectId, timeout);
}

type TaskEvent = {
  skipSubtaskParentRefresh?: boolean;
  id: string | undefined;
  projectId: string;
  userId: string;
  initiatorId?: string;
  taskId: string;
  sourceTaskId: string | undefined;
  targetTaskId: string | undefined;
  // Relation events only: which of the relation's tasks live in `projectId`.
  projectTaskIds?: string[];
  secondaryNotification?: boolean;
};

// Include the initiating window: its local mutation refreshes the child project,
// while it may be displaying a different parent board. Never send child data.
function refreshParentBoards(
  projects: { projectId: string }[],
  currentProjectId = "",
) {
  for (const { projectId } of projects) {
    if (projectId === currentProjectId) continue;
    broadcastToProject(projectId, {
      type: "TASK_RELATION_UPDATED",
      projectId,
      taskId: "",
    });
  }
}

subscribeToEvent<{ projects: { projectId: string }[] }>(
  "subtask-parents.refresh",
  async ({ projects }) => {
    refreshParentBoards(projects);
  },
);

const taskUpdateEvents = [
  "task.created",
  "task.updated",
  "task.deleted",
  "task.status_changed",
  "task.priority_changed",
  "task.approval_changed",
  "task.unassigned",
  "task.assignee_changed",
  "task.due_date_changed",
  "task.title_changed",
  "task.description_changed",
  "task.label_assigned",
  "task.label_unassigned",
  "task.label_created",
  "task.label_deleted",
  "task-relation.created",
  "task-relation.updated",
  "task-relation.deleted",
  "comment.created",
  "comment.deleted",
  "comment.updated",
  // Jira integration: a linked issue changed, or its proposal was resolved.
  // The payload carries ids and status names only, never a token or secret.
  "jira.issue_linked",
  "jira.issue_unlinked",
  "jira.status_changed",
  "jira.status_proposal_created",
  "jira.status_proposal_resolved",
];

subscribeToEvent<{
  taskId: string;
  userId: string;
  initiatorId?: string;
  type: string;
  content: string;
  fromProjectId: string;
  fromProjectName: string;
  toProjectId: string;
  toProjectName: string;
  oldStatus: string;
  newStatus: string;
}>("task.moved", async (data) => {
  const { fromProjectId, initiatorId, toProjectId, taskId } = data;

  broadcastToProject(
    toProjectId,
    { type: "TASK_MOVED", projectId: toProjectId, taskId },
    initiatorId,
  );
  broadcastToProject(
    fromProjectId,
    { type: "TASK_MOVED", projectId: fromProjectId, taskId },
    initiatorId,
  );
  refreshParentBoards(await getSubtaskParentProjects([taskId]), fromProjectId);
});

subscribeToEvent<{
  projectId: string;
  userId: string;
  initiatorId?: string;
}>("task-relation.refresh", async (data) => {
  const { projectId, initiatorId } = data;
  if (!projectId) return;

  broadcastToProject(
    projectId,
    {
      type: "TASK_RELATION_UPDATED",
      projectId,
      taskId: "",
      sourceTaskId: undefined,
      targetTaskId: undefined,
    },
    initiatorId,
  );
});

// Project-scoped rather than per task: a project move can unassign every task
// in the project at once, so clients refetch the board once instead of
// receiving one message per task.
subscribeToEvent<{
  projectId: string;
  userId: string;
  initiatorId?: string;
}>("task.bulk_unassigned", async (data) => {
  const { projectId, initiatorId } = data;
  if (!projectId) return;

  broadcastToProject(
    projectId,
    { type: "TASK_UPDATED", projectId, taskId: "" },
    initiatorId,
  );
});

subscribeToEvent<{ notificationId: string; userId: string }>(
  "notification.created",
  async (data) => {
    if (data.userId) {
      broadcastToUser(data.userId, { type: "NOTIFICATION_CREATED" });
    }
  },
);

subscribeToEvent<{
  projectId: string;
  initiatorId?: string;
}>("project.updated", async (data) => {
  const { projectId, initiatorId } = data;
  if (!projectId) return;

  broadcastToProject(
    projectId,
    { type: "PROJECT_UPDATED", projectId },
    initiatorId,
  );
});

const relationEvents = new Set([
  "task-relation.created",
  "task-relation.updated",
  "task-relation.deleted",
]);

for (const eventName of taskUpdateEvents) {
  subscribeToEvent<TaskEvent>(eventName, async (data) => {
    const { projectId, initiatorId } = data;
    let taskId = data.taskId;
    let sourceTaskId = data.sourceTaskId;
    let targetTaskId = data.targetTaskId;

    if (!projectId || !taskId) return;

    if (relationEvents.has(eventName)) {
      // A relation event reaches the subscribers of both projects, so a project
      // only gets ids of tasks IN that project. `publishRelationEvent` requires
      // the publisher to list them in `projectTaskIds`; nothing else is sent, and
      // no lookup happens here.
      const inProject = new Set(data.projectTaskIds);
      if (!inProject.has(taskId)) taskId = "";
      if (sourceTaskId && !inProject.has(sourceTaskId)) {
        sourceTaskId = undefined;
      }
      if (targetTaskId && !inProject.has(targetTaskId)) {
        targetTaskId = undefined;
      }
    }

    let type: string;
    switch (eventName) {
      case "task.created":
        type = "TASK_CREATED";
        break;
      case "task.deleted":
        type = "TASK_DELETED";
        break;
      case "task-relation.created":
      case "task-relation.updated":
      case "task-relation.deleted":
        type = "TASK_RELATION_UPDATED";
        break;
      case "task.label_assigned":
      case "task.label_unassigned":
      case "task.label_created":
      case "task.label_deleted":
        type = "TASK_LABEL_UPDATED";
        break;
      case "comment.created":
      case "comment.deleted":
      case "comment.updated":
        type = "COMMENT_UPDATED";
        break;
      default:
        type = "TASK_UPDATED";
    }

    if (eventName === "task.label_deleted") {
      // Cascade deletion waits for this adapter operation rather than growing
      // the ordinary 100ms broadcast queue behind a slow Redis connection.
      await adapter?.publish({
        projectId,
        message: { type, projectId, taskId },
        excludeInitiatorId: initiatorId,
      });
      return;
    }

    broadcastToProject(
      projectId,
      {
        type,
        projectId,
        taskId,
        sourceTaskId,
        targetTaskId,
      },
      initiatorId,
    );
    if (eventName === "task.status_changed" && !data.skipSubtaskParentRefresh) {
      refreshParentBoards(await getSubtaskParentProjects([taskId]), projectId);
    } else if (eventName === "task-relation.deleted" && data.sourceTaskId) {
      refreshParentBoards(
        await getRelationSourceProject(data.sourceTaskId),
        projectId,
      );
    }
  });
}
