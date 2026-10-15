import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const hooks = vi.hoisted(() => ({
  sendDueDateReminder: vi.fn<(...args: unknown[]) => Promise<boolean>>(
    async () => true,
  ),
  sendTrialReminderEmail: vi.fn(),
  failProcessKey: null as string | null,
  failTokenLookup: false,
}));

vi.mock("@kaneo/email", () => ({
  isSmtpConfigured: () => true,
  sendTrialReminderEmail: (...args: unknown[]) =>
    hooks.sendTrialReminderEmail(...args),
}));

// A delivery started by a notification is not under test and would hold locks
// while the next test truncates the tables.
vi.mock("../../apps/api/src/notification-preferences/delivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

vi.mock(
  "../../apps/api/src/plugins/generic-webhook/events",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    sendDueDateReminder: (...args: unknown[]) =>
      hooks.sendDueDateReminder(...args),
  }),
);

// Jira itself is an external service: its client is replaced. The status
// processing and the token lookup are the real code, except where a scenario
// needs one of them to fail for one specific link or for the token lookup.
vi.mock(
  "../../apps/api/src/jira-integration/jira-client",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    createJiraClient: () => ({
      searchIssues: async (jql: string) =>
        [...jql.matchAll(/"([^"]+)"/g)].map(([, key]) => ({
          id: `id-${key}`,
          key,
          fields: { status: { id: "3", name: "In Progress" } },
        })),
    }),
  }),
);
vi.mock(
  "../../apps/api/src/jira-integration/status-sync",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../apps/api/src/jira-integration/status-sync")
      >();
    return {
      ...actual,
      processJiraStatusChange: (
        link: { issueKey: string },
        ...rest: unknown[]
      ) => {
        if (link.issueKey === hooks.failProcessKey) {
          throw new Error("status processing exploded");
        }
        return (
          actual.processJiraStatusChange as (...args: unknown[]) => unknown
        )(link, ...rest);
      },
    };
  },
);
vi.mock(
  "../../apps/api/src/jira-integration/tokens",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../apps/api/src/jira-integration/tokens")
      >();
    return {
      ...actual,
      findJiraUserToken: (connectionId: string, userId: string) => {
        if (hooks.failTokenLookup && userId === "user-fails") {
          throw new Error("token lookup exploded");
        }
        return actual.findJiraUserToken(connectionId, userId);
      },
    };
  },
);

const {
  default: db,
  getDatabase,
  schema,
} = await import("../../apps/api/src/database");
const { checkDueDateReminders } = await import(
  "../../apps/api/src/scheduler/due-date-reminders"
);
const { checkProjectWebhookReminders } = await import(
  "../../apps/api/src/scheduler/project-webhook-reminders"
);
const { enforceActivityRetention } = await import(
  "../../apps/api/src/scheduler/activity-retention"
);
const { pollJiraStatuses } = await import(
  "../../apps/api/src/scheduler/jira-status-poll"
);
const { withJobLease } = await import(
  "../../apps/api/src/scheduler/leader-lock"
);
const { reconcileWorkspaceSeats } = await import(
  "../../apps/api/src/scheduler/seat-reconciliation"
);
const { checkTrialReminders } = await import(
  "../../apps/api/src/scheduler/trial-reminders"
);
const { DUE_DATE_DURATION_MS } = await import(
  "../../apps/api/src/scheduler/reminder-timing"
);
const { storeJiraUserToken } = await import(
  "../../apps/api/src/jira-integration/tokens"
);
const { resetTestDatabase } = await import("./helpers/database");
const { addWorkspaceMember, createProjectFixture, createWorkspaceMember } =
  await import("./helpers/fixtures");

const MINUTE_MS = 60_000;
const DAY = 24 * 60 * MINUTE_MS;

const ENV = {
  KANEO_CLOUD: "true",
  CREEM_API_KEY: "creem_test_dummy",
  CREEM_WEBHOOK_SECRET: "whsec_dummy",
  SMTP_HOST: "smtp.example.com",
  SMTP_FROM: "kaneo@example.com",
  NOTIFICATION_SECRET_ENCRYPTION_KEY: "scheduler-failure-test-key",
};
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [key, value] of Object.entries(ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});

afterAll(() => {
  for (const key of Object.keys(ENV)) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

beforeEach(async () => {
  await resetTestDatabase();
  hooks.sendDueDateReminder.mockReset();
  hooks.sendDueDateReminder.mockResolvedValue(true);
  hooks.sendTrialReminderEmail.mockReset();
  hooks.failProcessKey = null;
  hooks.failTokenLookup = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Method = "select" | "insert" | "update" | "delete" | "execute";

// Makes the real database refuse selected statements, as a lost connection or
// a failing disk would. Everything else reaches the database unchanged.
function failDatabase(
  method: Method,
  when: (callNumber: number, firstArgument: unknown) => boolean,
  { rejects = false }: { rejects?: boolean } = {},
) {
  const target = getDatabase();
  const original = (target[method] as (...args: unknown[]) => unknown).bind(
    target,
  );
  let calls = 0;
  return vi.spyOn(target, method as "select").mockImplementation(((
    ...args: unknown[]
  ) => {
    calls += 1;
    if (when(calls, args[0])) {
      const failure = new Error("injected database failure");
      // `execute` runs the statement at once, so a failure is a rejection.
      if (rejects) return Promise.reject(failure);
      throw failure;
    }
    return original(...args);
  }) as never);
}

describe("due date reminder job failures", () => {
  async function dueTask() {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        columnId: columns.todo.id,
        userId: user.id,
        title: "Due soon",
        number: 1,
        status: "to-do",
        dueDate: new Date(
          Date.now() + (1440 - 5) * MINUTE_MS - DUE_DATE_DURATION_MS,
        ),
      })
      .returning();
    return task;
  }

  const sentFor = (taskId: string) =>
    db
      .select()
      .from(schema.taskReminderSentTable)
      .where(eq(schema.taskReminderSentTable.taskId, taskId));
  const notificationsFor = (taskId: string) =>
    db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.resourceId, taskId));

  it("leaves no sent marker and no notification when the marker cannot be stored, and delivers on the next run", async () => {
    const task = await dueTask();
    const failure = failDatabase(
      "insert",
      (_n, table) => table === schema.taskReminderSentTable,
    );

    await expect(checkDueDateReminders()).resolves.toEqual({
      degraded: false,
    });

    expect(console.error).toHaveBeenCalledWith(
      "Failed to record due date reminder",
      expect.objectContaining({ taskId: task.id }),
    );
    expect(await sentFor(task.id)).toHaveLength(0);
    expect(await notificationsFor(task.id)).toHaveLength(0);

    failure.mockRestore();
    await checkDueDateReminders();
    expect(await notificationsFor(task.id)).toHaveLength(1);
    expect(await sentFor(task.id)).toHaveLength(1);
  });

  it("reports a degraded run when the notification cannot be created", async () => {
    const task = await dueTask();
    failDatabase("insert", (_n, table) => table === schema.notificationTable);

    await expect(checkDueDateReminders()).resolves.toEqual({ degraded: true });

    expect(console.error).toHaveBeenCalledWith(
      "Failed to process due date reminder",
      expect.objectContaining({ taskId: task.id }),
    );
    expect(await notificationsFor(task.id)).toHaveLength(0);
  });

  it("reports a degraded run when the task query fails", async () => {
    await dueTask();
    failDatabase("select", () => true);

    await expect(checkDueDateReminders()).resolves.toEqual({ degraded: true });

    expect(console.error).toHaveBeenCalledWith(
      "Failed to query tasks for due date reminders",
      expect.objectContaining({ reminderType: expect.any(String) }),
    );
  });
});

describe("project webhook reminder job failures", () => {
  async function webhookTask() {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await db.insert(schema.integrationTable).values({
      projectId: project.id,
      type: "generic-webhook",
      isActive: true,
      config: JSON.stringify({
        url: "https://hooks.example.test/in",
        events: { dueDateReminder: true },
      }),
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        columnId: columns.todo.id,
        userId: user.id,
        title: "Webhook due",
        number: 1,
        status: "to-do",
        dueDate: new Date(
          Date.now() + (1440 - 5) * MINUTE_MS - DUE_DATE_DURATION_MS,
        ),
      })
      .returning();
    return task;
  }

  const sentFor = (taskId: string) =>
    db
      .select()
      .from(schema.taskReminderSentTable)
      .where(eq(schema.taskReminderSentTable.taskId, taskId));

  it("forgets the sent marker when the webhook was not delivered, so the next run retries", async () => {
    const task = await webhookTask();
    hooks.sendDueDateReminder.mockResolvedValueOnce(false);

    await expect(checkProjectWebhookReminders()).resolves.toEqual({
      degraded: false,
    });
    expect(hooks.sendDueDateReminder).toHaveBeenCalledTimes(1);
    expect(await sentFor(task.id)).toHaveLength(0);

    await checkProjectWebhookReminders();
    expect(hooks.sendDueDateReminder).toHaveBeenCalledTimes(2);
    expect(await sentFor(task.id)).toHaveLength(1);
  });

  it("reports a degraded run and keeps the other integrations going when delivery throws", async () => {
    const task = await webhookTask();
    hooks.sendDueDateReminder.mockRejectedValueOnce(
      new Error("socket hang up"),
    );

    await expect(checkProjectWebhookReminders()).resolves.toEqual({
      degraded: true,
    });

    expect(console.error).toHaveBeenCalledWith(
      "Failed to process project webhook reminder",
      expect.objectContaining({ error: expect.any(Error) }),
    );
    // The marker was claimed before delivery and is not removed by a throw.
    expect(await sentFor(task.id)).toHaveLength(1);
  });
});

describe("activity retention job failures", () => {
  async function workspaceWithRetention(days = 30) {
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.workspaceTable)
      .set({ activityRetentionDays: days })
      .where(eq(schema.workspaceTable.id, workspace.id));
    return workspace;
  }

  it("reports a degraded run when the workspaces cannot be listed", async () => {
    await workspaceWithRetention();
    failDatabase("select", () => true);

    await expect(enforceActivityRetention()).resolves.toEqual({
      degraded: true,
    });
    expect(console.error).toHaveBeenCalledWith(
      "activity retention: failed to query workspaces",
      expect.any(Error),
    );
  });

  it("keeps cleaning the other workspaces when one fails and reports a degraded run", async () => {
    const broken = await workspaceWithRetention();
    const fine = await workspaceWithRetention();
    const old = new Date(Date.now() - 90 * DAY);
    await db.insert(schema.activityTable).values([
      {
        workspaceId: broken.id,
        type: "calendar",
        content: "x",
        createdAt: old,
      },
      { workspaceId: fine.id, type: "calendar", content: "y", createdAt: old },
    ]);
    failDatabase("delete", (call) => call === 1);

    await expect(enforceActivityRetention()).resolves.toEqual({
      degraded: true,
    });

    const remaining = await db.select().from(schema.activityTable);
    expect(remaining).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("activity retention: failed for workspace"),
      expect.any(Error),
    );
  });

  it("does nothing when no workspace has a retention period", async () => {
    await createWorkspaceMember({ role: "owner" });
    await expect(enforceActivityRetention()).resolves.toEqual({
      degraded: false,
    });
  });
});

describe("seat reconciliation job failures", () => {
  it("does nothing, and takes no lease, while billing is disabled", async () => {
    vi.stubEnv("CREEM_API_KEY", "");
    try {
      await expect(reconcileWorkspaceSeats()).resolves.toEqual({
        degraded: false,
      });
      expect(await db.select().from(schema.jobLeaseTable)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reports a degraded run when the drifted workspaces cannot be queried, and releases the lease", async () => {
    // The first select after the lease claim is the drift query.
    const failure = failDatabase("select", () => true);

    await expect(reconcileWorkspaceSeats()).resolves.toEqual({
      degraded: true,
    });
    failure.mockRestore();

    expect(console.error).toHaveBeenCalledWith(
      "billing: seat reconciliation query failed",
      expect.any(Error),
    );
    expect(await db.select().from(schema.jobLeaseTable)).toEqual([]);
  });
});

describe("withJobLease release failure", () => {
  it("returns the job result when the lease cannot be released, and keeps the lease until it expires", async () => {
    failDatabase(
      "execute",
      (_n, query) =>
        JSON.stringify(
          (query as { queryChunks?: unknown[] }).queryChunks,
        ).includes("DELETE FROM job_lease"),
      { rejects: true },
    );

    const result = await withJobLease(
      "coverage-lease",
      async () => "done",
      () => "held elsewhere",
    );

    expect(result).toBe("done");
    expect(console.error).toHaveBeenCalledWith(
      "Failed to release the coverage-lease lease",
      expect.any(Error),
    );
    const [lease] = await db.select().from(schema.jobLeaseTable);
    expect(lease?.name).toBe("coverage-lease");

    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Another run sees the held lease and does not run the job.
    const again = await withJobLease(
      "coverage-lease",
      async () => "ran",
      () => "held elsewhere",
    );
    expect(again).toBe("held elsewhere");
  });
});

describe("trial reminder job failures", () => {
  async function trial(email?: string) {
    const { user, workspace } = await createWorkspaceMember({
      role: "owner",
      workspaceName: `WS-${randomUUID().slice(0, 6)}`,
    });
    if (email !== undefined) {
      await db
        .update(schema.userTable)
        .set({ email })
        .where(eq(schema.userTable.id, user.id));
    }
    const trialEndsAt = new Date(Date.now() - DAY);
    await db
      .insert(schema.workspaceBillingTable)
      .values({ workspaceId: workspace.id, trialEndsAt });
    return { user, workspace, trialEndsAt };
  }

  it("sends nothing while billing or SMTP is not configured", async () => {
    await trial();
    vi.stubEnv("CREEM_API_KEY", "");
    try {
      await expect(checkTrialReminders()).resolves.toEqual({
        degraded: false,
      });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(hooks.sendTrialReminderEmail).not.toHaveBeenCalled();
  });

  it("reports a degraded run for each reminder type whose query fails", async () => {
    await trial();
    failDatabase("selectDistinctOn" as Method, () => true);

    await expect(checkTrialReminders()).resolves.toEqual({ degraded: true });

    expect(console.error).toHaveBeenCalledWith(
      "Failed to query trial_ending reminders",
      expect.any(Error),
    );
    expect(console.error).toHaveBeenCalledWith(
      "Failed to query trial_expired reminders",
      expect.any(Error),
    );
    expect(hooks.sendTrialReminderEmail).not.toHaveBeenCalled();
  });

  it("skips an owner without an email address and claims nothing for them", async () => {
    await trial("");

    await checkTrialReminders();

    expect(hooks.sendTrialReminderEmail).not.toHaveBeenCalled();
    expect(await db.select().from(schema.billingReminderSentTable)).toEqual([]);
  });

  it("sends nothing when a concurrent run claimed the reminder first", async () => {
    await trial();
    const target = getDatabase();
    const original = target.insert.bind(target) as (
      ...args: unknown[]
    ) => unknown;
    vi.spyOn(target, "insert").mockImplementation(((table: unknown) => {
      if (table === schema.billingReminderSentTable) {
        // The other instance wins the race between the query and the claim.
        return {
          values: () => ({
            onConflictDoNothing: () => ({ returning: async () => [] }),
          }),
        };
      }
      return original(table);
    }) as never);

    await checkTrialReminders();

    expect(hooks.sendTrialReminderEmail).not.toHaveBeenCalled();
  });
});

describe("Jira status poll job failures", () => {
  async function connection(workspaceId: string, label: string) {
    const [row] = await db
      .insert(schema.jiraConnectionTable)
      .values({
        workspaceId,
        baseUrl: `https://${label}.jira.example.test`,
        deployment: "server",
        webhookSecret: `secret-${label}`,
      })
      .returning();
    return row;
  }

  async function seedWorld() {
    const manager = await createWorkspaceMember({ role: "admin" });
    const workspaceId = manager.workspace.id;
    const editor = await addWorkspaceMember(workspaceId, "member");
    const { project, columns } = await createProjectFixture({ workspaceId });
    const conn = await connection(workspaceId, "one");
    let number = 0;
    async function link(createdBy: string, issueKey: string) {
      number += 1;
      const [task] = await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          columnId: columns.todo.id,
          userId: createdBy,
          title: `Task ${number}`,
          number,
          status: "to-do",
        })
        .returning();
      const [row] = await db
        .insert(schema.jiraIssueLinkTable)
        .values({
          taskId: task.id,
          connectionId: conn.id,
          issueId: `id-${issueKey}`,
          issueKey,
          issueUrl: `https://one.jira.example.test/browse/${issueKey}`,
          jiraProjectKey: "PRJ",
          lastStatusId: "1",
          lastStatusName: "To Do",
          createdByUserId: createdBy,
        })
        .returning();
      return row;
    }
    async function token(userId: string) {
      await storeJiraUserToken({
        connectionId: conn.id,
        userId,
        token: `pat-${userId}-0123456789`,
        email: null,
        identity: { name: "someone" } as never,
      });
    }
    const proposals = () => db.select().from(schema.jiraStatusProposalTable);
    return { manager, editor, conn, link, token, proposals, workspaceId };
  }

  it("marks an unreadable stored token and does not call Jira", async () => {
    const world = await seedWorld();
    await world.token(world.editor.id);
    await db
      .update(schema.jiraUserTokenTable)
      .set({ encryptedToken: "not-a-valid-ciphertext" });
    await world.link(world.editor.id, "PRJ-1");

    await expect(pollJiraStatuses()).resolves.toEqual({ degraded: false });

    const [token] = await db.select().from(schema.jiraUserTokenTable);
    expect(token?.lastError).toBe(
      "The stored Jira token cannot be read. Enter it again.",
    );
    expect(await world.proposals()).toEqual([]);
  });

  it("isolates a failing link: the other links of the person are still processed", async () => {
    const world = await seedWorld();
    await world.token(world.editor.id);
    await world.link(world.editor.id, "PRJ-BAD");
    const good = await world.link(world.editor.id, "PRJ-2");
    hooks.failProcessKey = "PRJ-BAD";

    await expect(pollJiraStatuses()).resolves.toEqual({ degraded: true });

    expect(console.error).toHaveBeenCalledWith(
      "Failed to process a polled Jira status",
      expect.objectContaining({ message: "status processing exploded" }),
    );
    const rows = await world.proposals();
    expect(rows.map((r) => r.taskId)).toEqual([good.taskId]);
  });

  it("isolates a failing person: another person's links are still processed", async () => {
    const world = await seedWorld();
    // "user-fails" is only a lookup key for the token failure below.
    await db.insert(schema.userTable).values({
      id: "user-fails",
      name: "Fails",
      email: "fails@example.com",
      emailVerified: true,
    });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: world.workspaceId,
      userId: "user-fails",
      role: "member",
      joinedAt: new Date(),
    });
    await world.token(world.editor.id);
    await world.link("user-fails", "PRJ-1");
    const ok = await world.link(world.editor.id, "PRJ-2");
    hooks.failTokenLookup = true;

    await expect(pollJiraStatuses()).resolves.toEqual({ degraded: true });

    expect(console.error).toHaveBeenCalledWith(
      "Jira status poll failed for a user",
      expect.objectContaining({ message: expect.any(String) }),
    );
    expect((await world.proposals()).map((r) => r.taskId)).toEqual([ok.taskId]);
  });

  it("isolates a failing connection: the next connection is still polled", async () => {
    const world = await seedWorld();
    await world.token(world.editor.id);
    await world.link(world.editor.id, "PRJ-1");
    // Second workspace and connection.
    const other = await createWorkspaceMember({ role: "admin" });
    const otherEditor = await addWorkspaceMember(other.workspace.id, "member");
    const { project, columns } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    const otherConn = await connection(other.workspace.id, "two");
    const [otherTask] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        columnId: columns.todo.id,
        userId: otherEditor.id,
        title: "Other",
        number: 1,
        status: "to-do",
      })
      .returning();
    await storeJiraUserToken({
      connectionId: otherConn.id,
      userId: otherEditor.id,
      token: "pat-other-0123456789",
      email: null,
      identity: { name: "other" } as never,
    });
    await db.insert(schema.jiraIssueLinkTable).values({
      taskId: otherTask.id,
      connectionId: otherConn.id,
      issueId: "id-OTH-1",
      issueKey: "OTH-1",
      issueUrl: "https://two.jira.example.test/browse/OTH-1",
      jiraProjectKey: "OTH",
      lastStatusId: "1",
      lastStatusName: "To Do",
      createdByUserId: otherEditor.id,
    });
    // select #1 lists the connections, select #2 is the first connection's
    // link query.
    failDatabase("select", (call) => call === 2);

    await expect(pollJiraStatuses()).resolves.toEqual({ degraded: true });

    expect(console.error).toHaveBeenCalledWith(
      "Jira status poll failed for a connection",
      expect.objectContaining({ connectionId: expect.any(String) }),
    );
    expect((await world.proposals()).length).toBe(1);
  });
});
