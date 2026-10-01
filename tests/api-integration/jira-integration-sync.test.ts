import { and, eq, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { waitForPendingEventHandlers } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const jira = vi.hoisted(() => ({
  myself: vi.fn(),
  getCreateFields: vi.fn(),
  createIssue: vi.fn(),
  updateIssue: vi.fn(),
  getIssue: vi.fn(),
  searchIssues: vi.fn(),
  createClient: vi.fn(),
  searches: [] as { token: string; jql: string }[],
}));

const events = vi.hoisted(() => ({
  published: [] as { type: string; data: unknown }[],
}));

// The real event bus, observed: activity, notifications and WebSocket handlers
// still run, and every published event is recorded for the assertions below.
vi.mock("../../apps/api/src/events", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../apps/api/src/events")>();
  return {
    ...original,
    publishEvent: vi.fn(
      async (
        type: string,
        data: unknown,
        options?: { waitForHandlers?: boolean },
      ) => {
        events.published.push({ type, data: structuredClone(data) });
        return original.publishEvent(type, data, options);
      },
    ),
  };
});

vi.mock(
  "../../apps/api/src/jira-integration/jira-client",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../apps/api/src/jira-integration/jira-client")
    >()),
    createJiraClient: jira.createClient,
  }),
);

const { JiraApiError } = await import(
  "../../apps/api/src/jira-integration/jira-client"
);
const { pollJiraStatuses } = await import(
  "../../apps/api/src/scheduler/jira-status-poll"
);

const BASE_URL = "https://jira.example.test";
const TOKEN_A = "test-pat-editor-a-0123456789";
const TOKEN_B = "test-pat-editor-b-9876543210";
const TOKEN_V = "test-pat-viewer-v-5555555555";
const WEBHOOK_SECRET = "test-webhook-secret-abcdef0123456789";
const SECRETS = [TOKEN_A, TOKEN_B, TOKEN_V, WEBHOOK_SECRET];

const ENCRYPTION_KEY_ENV = "NOTIFICATION_SECRET_ENCRYPTION_KEY";
const originalKey = process.env[ENCRYPTION_KEY_ENV];

function restoreKey() {
  if (originalKey === undefined) {
    delete process.env[ENCRYPTION_KEY_ENV];
  } else {
    process.env[ENCRYPTION_KEY_ENV] = originalKey;
  }
}

beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
  events.published.length = 0;
  jira.searches.length = 0;
  process.env[ENCRYPTION_KEY_ENV] = "jira-sync-test-encryption-key";
  jira.myself.mockResolvedValue({ name: "someone", displayName: "Someone" });
  jira.getCreateFields.mockResolvedValue([]);
  jira.createIssue.mockResolvedValue({ id: "10001", key: "PRJ-1" });
  jira.updateIssue.mockResolvedValue(undefined);
  jira.getIssue.mockResolvedValue({
    id: "10001",
    key: "PRJ-1",
    fields: { status: { id: "1", name: "To Do" } },
  });
  jira.searchIssues.mockResolvedValue([]);
  jira.createClient.mockImplementation((config: { token: string }) => ({
    myself: jira.myself,
    getCreateFields: jira.getCreateFields,
    createIssue: jira.createIssue,
    updateIssue: jira.updateIssue,
    getIssue: jira.getIssue,
    searchIssues: async (jql: string, fields: string[]) => {
      jira.searches.push({ token: config.token, jql });
      return jira.searchIssues(jql, fields);
    },
  }));
});

afterEach(restoreKey);
afterAll(restoreKey);

// biome-ignore lint/suspicious/noExplicitAny: response bodies are asserted field by field
type Body = any;

type User = Awaited<ReturnType<typeof createWorkspaceMember>>["user"];

// A workspace with a manager (`admin`), two editors (`member`, both can update
// tasks), a viewer, a member without access to the project, and a member of
// another workspace. One project everybody (but the last two) belongs to, and
// one task assigned to `editor`.
async function setup() {
  const manager = await createWorkspaceMember({ role: "admin" });
  const workspaceId = manager.workspace.id;
  const editor = await addWorkspaceMember(workspaceId, "member");
  const editor2 = await addWorkspaceMember(workspaceId, "member");
  const viewer = await addWorkspaceMember(workspaceId, "viewer");
  const outsider = await createWorkspaceMember({ role: "owner" });

  const { project, columns } = await createProjectFixture({ workspaceId });
  // Joined after the project was created: a workspace member, no project access.
  const noProject = await addWorkspaceMember(workspaceId, "member");

  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Fix the login",
      description: "Users cannot log in.",
      number: 1,
      status: "to-do",
      columnId: columns.todo.id,
      priority: "urgent",
      userId: editor.id,
    })
    .returning();
  if (!task) throw new Error("task was not created");

  const { app } = createApp();
  const as = (user: User) => mockAuthenticatedSession(user);

  const request = async (
    user: User | null,
    method: string,
    path: string,
    body?: unknown,
  ) => {
    if (user) as(user);
    const response = await app.request(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // plain-text error from the access middleware
    }
    return { status: response.status, text, json: json as Body };
  };
  const call = (user: User, method: string, path: string, body?: unknown) =>
    request(user, method, `/api/jira-integration${path}`, body);

  const [connection] = await db
    .insert(schema.jiraConnectionTable)
    .values({
      workspaceId,
      baseUrl: BASE_URL,
      deployment: "server",
      webhookSecret: WEBHOOK_SECRET,
    })
    .returning();
  if (!connection) throw new Error("connection was not created");

  const ws = `/workspace/${workspaceId}`;

  // The token goes through the real route: verified, encrypted, stored.
  const setToken = async (
    user: User,
    token: string,
    identity: Record<string, string> = { name: "someone" },
  ) => {
    jira.myself.mockResolvedValueOnce(identity);
    const response = await call(user, "PUT", `${ws}/me/token`, { token });
    expect(response.status).toBe(200);
    jira.createClient.mockClear();
    jira.myself.mockClear();
  };

  const putMapping = async (
    user: User,
    path: string,
    config: Record<string, unknown>,
  ) => {
    const response = await call(user, "PUT", path, { config });
    expect(response.status, path).toBe(200);
  };

  const webhook = (
    body: unknown,
    {
      id = connection.id,
      secret = WEBHOOK_SECRET as string | null,
    }: { id?: string; secret?: string | null } = {},
  ) =>
    request(
      null,
      "POST",
      `/api/jira-integration/webhook/${id}${secret === null ? "" : `?secret=${encodeURIComponent(secret)}`}`,
      body,
    );

  const seedLink = async ({
    forTask = task,
    issueId = "10001",
    issueKey = "PRJ-1",
    createdBy = editor2.id as string | null,
    status = { id: "1", name: "To Do" } as { id: string; name: string } | null,
  }: {
    forTask?: typeof task;
    issueId?: string;
    issueKey?: string;
    createdBy?: string | null;
    status?: { id: string; name: string } | null;
  } = {}) => {
    const [link] = await db
      .insert(schema.jiraIssueLinkTable)
      .values({
        taskId: forTask.id,
        connectionId: connection.id,
        issueId,
        issueKey,
        issueUrl: `${BASE_URL}/browse/${issueKey}`,
        jiraProjectKey: "PRJ",
        lastStatusId: status?.id ?? null,
        lastStatusName: status?.name ?? null,
        createdByUserId: createdBy,
      })
      .returning();
    if (!link) throw new Error("link was not created");
    return link;
  };

  const seedProposal = async (
    link: typeof schema.jiraIssueLinkTable.$inferSelect,
    overrides: Partial<typeof schema.jiraStatusProposalTable.$inferInsert> = {},
  ) => {
    const [proposal] = await db
      .insert(schema.jiraStatusProposalTable)
      .values({
        taskId: link.taskId,
        linkId: link.id,
        fromStatusName: "To Do",
        toStatusId: "5",
        toStatusName: "Done",
        proposedStatus: "done",
        source: "webhook",
        ...overrides,
      })
      .returning();
    if (!proposal) throw new Error("proposal was not created");
    return proposal;
  };

  const readTask = async () => {
    const [row] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    if (!row) throw new Error("task is gone");
    return row;
  };
  const activities = (type?: string) =>
    db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.taskId, task.id),
          type ? eq(schema.activityTable.type, type) : undefined,
        ),
      );
  const proposals = () =>
    db
      .select()
      .from(schema.jiraStatusProposalTable)
      .where(eq(schema.jiraStatusProposalTable.taskId, task.id));
  const readLink = async () => {
    const [row] = await db
      .select()
      .from(schema.jiraIssueLinkTable)
      .where(eq(schema.jiraIssueLinkTable.taskId, task.id));
    return row ?? null;
  };
  const publishedOf = (type: string) =>
    events.published.filter((event) => event.type === type);

  return {
    app,
    call,
    request,
    webhook,
    setToken,
    putMapping,
    seedLink,
    seedProposal,
    readTask,
    readLink,
    activities,
    proposals,
    publishedOf,
    workspaceId,
    ws,
    project,
    columns,
    task,
    connection,
    manager: manager.user,
    editor,
    editor2,
    viewer,
    noProject,
    outsider: outsider.user,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function statusPayload(
  to: { id: string; name: string },
  {
    from = "To Do",
    issue = { id: "10001", key: "PRJ-1" },
  }: { from?: string; issue?: { id?: string; key?: string } } = {},
) {
  return {
    webhookEvent: "jira:issue_updated",
    timestamp: 1_790_000_000_000,
    user: { name: "bob", displayName: "Bob Example" },
    issue,
    changelog: {
      items: [
        { field: "summary", fromString: "a", toString: "b" },
        {
          field: "status",
          from: "1",
          fromString: from,
          to: to.id,
          toString: to.name,
        },
      ],
    },
  };
}

// No token, webhook secret or Jira credential in anything Kaneo stored or
// published: events, activity, notifications, links and proposals.
async function expectNoSecrets(s: Setup, ...responses: { text: string }[]) {
  await waitForPendingEventHandlers();
  const stored = JSON.stringify([
    events.published,
    await db.select().from(schema.activityTable),
    await db.select().from(schema.notificationTable),
    await db.select().from(schema.jiraIssueLinkTable),
    await db.select().from(schema.jiraStatusProposalTable),
  ]);
  for (const secret of SECRETS) {
    expect(stored).not.toContain(secret);
    for (const response of responses) {
      expect(response.text).not.toContain(secret);
    }
  }
  expect(s.connection.id).toBeTruthy();
}

describe("Jira sync: workspace and project boundary", () => {
  it("answers 403 to a member of another workspace and to a member without access to the project, on every task and proposal route", async () => {
    const s = await setup();
    const link = await s.seedLink();
    const proposal = await s.seedProposal(link);
    await s.setToken(s.editor, TOKEN_A);

    const t = `/task/${s.task.id}`;
    const p = `/proposal/${proposal.id}`;
    const routes: [string, string, unknown?][] = [
      ["GET", t],
      ["GET", `${t}/draft`],
      ["POST", `${t}/send`, { fields: [] }],
      ["POST", `${t}/refresh`],
      ["DELETE", `${t}/link`],
      ["POST", `${p}/accept`, {}],
      ["POST", `${p}/reject`],
    ];

    for (const user of [s.outsider, s.noProject]) {
      for (const [method, path, body] of routes) {
        const response = await s.call(user, method, path, body);
        expect(response.status, `${user.id} ${method} ${path}`).toBe(403);
      }
    }

    // Nothing was reached, nothing changed.
    expect(jira.createClient).not.toHaveBeenCalled();
    expect((await s.readTask()).status).toBe("to-do");
    expect(await s.readLink()).not.toBeNull();
    expect((await s.proposals()).map((row) => row.state)).toEqual(["pending"]);
    expect(await s.activities()).toHaveLength(0);
    expect(s.publishedOf("task.status_changed")).toHaveLength(0);
  });

  it("answers 404 for an unknown proposal or task, and 403 for a task of a workspace the caller is not in", async () => {
    const s = await setup();
    const unknownProposal = await s.call(
      s.editor,
      "POST",
      "/proposal/no-such-proposal/accept",
      {},
    );
    expect(unknownProposal.status).toBe(404);
    expect(
      (await s.call(s.editor, "POST", "/proposal/no-such-proposal/reject"))
        .status,
    ).toBe(404);

    const unknownTask = await s.call(
      s.editor,
      "GET",
      `/task/no-such-task?workspaceId=${s.workspaceId}`,
    );
    expect(unknownTask.status).toBe(404);

    // A task of this workspace named under ANOTHER workspace's id is not
    // reachable either: the caller has no access there.
    const other = await createWorkspaceMember({ role: "owner" });
    const crossed = await s.call(
      s.outsider,
      "GET",
      `/task/${s.task.id}?workspaceId=${other.workspace.id}`,
    );
    expect(crossed.status).toBe(403);
  });

  it("lets a viewer read the Jira state of a task, but not send, unlink, accept or reject", async () => {
    const s = await setup();
    const link = await s.seedLink();
    const proposal = await s.seedProposal(link);

    const info = await s.call(s.viewer, "GET", `/task/${s.task.id}`);
    expect(info.status).toBe(200);
    expect(info.json.link).toMatchObject({ issueKey: "PRJ-1" });
    expect(info.json.pendingProposal).toMatchObject({
      id: proposal.id,
      state: "pending",
      proposedStatus: "done",
    });

    await s.setToken(s.viewer, TOKEN_V);
    const t = `/task/${s.task.id}`;
    const p = `/proposal/${proposal.id}`;
    for (const [method, path, body] of [
      ["GET", `${t}/draft`],
      ["POST", `${t}/send`, { fields: [] }],
      ["DELETE", `${t}/link`],
      ["POST", `${p}/accept`, {}],
      ["POST", `${p}/reject`],
    ] as [string, string, unknown?][]) {
      const response = await s.call(s.viewer, method, path, body);
      expect(response.status, `${method} ${path}`).toBe(403);
    }

    // The viewer's own token was never used for anything.
    expect(jira.createClient).not.toHaveBeenCalled();
    expect(jira.createIssue).not.toHaveBeenCalled();
    expect((await s.readTask()).status).toBe("to-do");
    expect((await s.proposals()).map((row) => row.state)).toEqual(["pending"]);
    expect(await s.readLink()).not.toBeNull();
  });
});

describe("Jira sync: task state", () => {
  it("returns an empty state for a task that is not linked, and the creator's token state for a linked one", async () => {
    const s = await setup();
    const empty = await s.call(s.editor, "GET", `/task/${s.task.id}`);
    expect(empty.json).toEqual({
      link: null,
      pendingProposal: null,
      proposals: [],
      sync: null,
    });

    await s.seedLink({ createdBy: s.editor2.id });
    const readSync = async () =>
      (await s.call(s.editor, "GET", `/task/${s.task.id}`)).json.sync;

    expect(await readSync()).toEqual({
      pollingEnabled: true,
      creatorTokenState: "missing",
    });
    await s.setToken(s.editor2, TOKEN_B);
    expect(await readSync()).toEqual({
      pollingEnabled: true,
      creatorTokenState: "ok",
    });
    await db
      .update(schema.jiraUserTokenTable)
      .set({ lastError: "Jira rejected the token." });
    expect(await readSync()).toMatchObject({ creatorTokenState: "invalid" });
    await db.update(schema.jiraConnectionTable).set({ pollingEnabled: false });
    expect(await readSync()).toMatchObject({ pollingEnabled: false });
  });

  it("lists at most the ten most recent proposals, newest first", async () => {
    const s = await setup();
    const link = await s.seedLink();
    for (let index = 0; index < 12; index++) {
      await s.seedProposal(link, {
        toStatusName: `Status ${index}`,
        state: index === 11 ? "pending" : "superseded",
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
      });
    }
    const info = await s.call(s.viewer, "GET", `/task/${s.task.id}`);
    expect(info.json.proposals).toHaveLength(10);
    expect(info.json.proposals[0].toStatusName).toBe("Status 11");
    expect(info.json.pendingProposal.toStatusName).toBe("Status 11");
  });
});

describe("Jira sync: draft", () => {
  it("uses the mapping's default when the task value is empty, and the most specific level wins: user over project over workspace", async () => {
    const s = await setup();
    await db
      .update(schema.taskTable)
      .set({ description: null })
      .where(eq(schema.taskTable.id, s.task.id));

    const team = (defaultValue: string) => ({
      target: { fieldId: "customfield_10", fieldName: "Team", type: "option" },
      source: { kind: "none" },
      defaultValue,
    });
    await s.putMapping(s.manager, `${s.ws}/mapping`, {
      fieldMappings: [
        {
          target: { fieldId: "description", type: "text" },
          source: { kind: "builtin", field: "description" },
          defaultValue: "Workspace description",
        },
        team("Workspace team"),
      ],
    });

    const draftAs = async (user: User) =>
      (await s.call(user, "GET", `/task/${s.task.id}/draft`)).json;
    const field = (draft: Body, id: string) =>
      draft.fields.find((entry: Body) => entry.fieldId === id);

    let draft = await draftAs(s.editor2);
    expect(field(draft, "description")).toMatchObject({
      value: "Workspace description",
      jiraValue: "Workspace description",
      origin: "default",
      mappingOrigin: "workspace",
    });
    expect(field(draft, "customfield_10")).toMatchObject({
      value: "Workspace team",
      jiraValue: { value: "Workspace team" },
      origin: "default",
      mappingOrigin: "workspace",
    });
    // The task has a title, so the title is the task's own value.
    expect(field(draft, "summary")).toMatchObject({
      value: "Fix the login",
      origin: "task",
      mappingOrigin: "default",
    });

    await s.putMapping(s.manager, `/project/${s.project.id}/mapping`, {
      fieldMappings: [team("Project team")],
    });
    await s.putMapping(s.editor, `${s.ws}/me/mapping`, {
      fieldMappings: [team("My team")],
    });

    draft = await draftAs(s.editor);
    expect(field(draft, "customfield_10")).toMatchObject({
      value: "My team",
      mappingOrigin: "user",
    });
    // Somebody else has no user level: the project level applies.
    draft = await draftAs(s.editor2);
    expect(field(draft, "customfield_10")).toMatchObject({
      value: "Project team",
      mappingOrigin: "project",
    });
    // The task's own description wins over any default once it has one.
    await db
      .update(schema.taskTable)
      .set({ description: "Real description" })
      .where(eq(schema.taskTable.id, s.task.id));
    draft = await draftAs(s.editor2);
    expect(field(draft, "description")).toMatchObject({
      value: "Real description",
      origin: "task",
    });
  });

  it("builds the Jira value of every built-in field, labels as components included", async () => {
    const s = await setup();
    await db
      .update(schema.taskTable)
      .set({ dueDate: new Date("2026-10-01T00:00:00.000Z") })
      .where(eq(schema.taskTable.id, s.task.id));
    await db.insert(schema.labelTable).values([
      {
        name: "needs review",
        color: "#fff",
        taskId: s.task.id,
        workspaceId: s.workspaceId,
      },
      {
        name: "Bug",
        color: "#fff",
        taskId: s.task.id,
        workspaceId: s.workspaceId,
      },
    ]);
    await s.putMapping(s.manager, `${s.ws}/mapping`, {
      components: ["Platform"],
      labelComponentMappings: [
        { kaneoLabel: "bug", jiraComponent: "Quality" },
        { kaneoLabel: "needs review", jiraComponent: "Platform" },
      ],
    });

    const draft = (await s.call(s.editor, "GET", `/task/${s.task.id}/draft`))
      .json;
    const byId = Object.fromEntries(
      draft.fields.map((entry: Body) => [entry.fieldId, entry]),
    );
    expect(byId.priority).toMatchObject({
      value: "urgent",
      jiraValue: { name: "Highest" },
    });
    expect(byId.duedate).toMatchObject({ jiraValue: "2026-10-01" });
    expect(byId.labels.jiraValue.sort()).toEqual(["Bug", "needs-review"]);
    expect(byId.components).toMatchObject({
      jiraValue: [{ name: "Platform" }, { name: "Quality" }],
      origin: "task",
      mappingOrigin: "workspace",
    });
    expect(draft.link).toBeNull();
  });

  it("resolves the assignee from a user mapping, else from the assignee's own token in the connection", async () => {
    const s = await setup();
    // `editor` is the assignee and has connected their own token.
    await s.setToken(s.editor, TOKEN_A, { name: "editor.jira" });

    const assignee = async () =>
      (
        await s.call(s.editor2, "GET", `/task/${s.task.id}/draft`)
      ).json.fields.find((entry: Body) => entry.fieldId === "assignee");

    expect(await assignee()).toMatchObject({
      value: "editor.jira",
      jiraValue: { name: "editor.jira" },
      origin: "task",
    });

    await s.putMapping(s.manager, `${s.ws}/mapping`, {
      userMappings: [{ kaneoUserId: s.editor.id, jiraUser: "mapped.user" }],
    });
    expect(await assignee()).toMatchObject({
      value: "mapped.user",
      jiraValue: { name: "mapped.user" },
    });

    // Nobody to map to: the field stays empty for the person to pick.
    await db.delete(schema.jiraUserTokenTable);
    await s.putMapping(s.manager, `${s.ws}/mapping`, {});
    expect(await assignee()).toMatchObject({
      value: null,
      jiraValue: null,
      origin: "empty",
    });
  });

  it("adds required flags and allowed values read with the caller's own token, and lists required fields nobody maps", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    await s.setToken(s.editor2, TOKEN_B);
    await s.putMapping(s.manager, `${s.ws}/mapping`, {
      jiraProjectKey: "PRJ",
      issueTypeId: "10001",
    });
    jira.getCreateFields.mockResolvedValue([
      {
        fieldId: "summary",
        name: "Summary",
        required: true,
        hasDefaultValue: false,
        schema: { type: "string" },
        allowedValues: null,
      },
      {
        fieldId: "priority",
        name: "Priority",
        required: false,
        hasDefaultValue: true,
        schema: { type: "priority" },
        allowedValues: [{ id: "1", name: "Highest" }],
      },
      {
        fieldId: "customfield_99",
        name: "Cost centre",
        required: true,
        hasDefaultValue: false,
        schema: { type: "option" },
        allowedValues: [{ id: "7", value: "CC-1" }],
      },
    ]);

    const response = await s.call(s.editor2, "GET", `/task/${s.task.id}/draft`);
    expect(response.status).toBe(200);
    const draft = response.json;
    expect(draft.createMeta).toEqual({
      jiraProjectKey: "PRJ",
      issueTypeId: "10001",
    });
    expect(draft.tokenConnected).toBe(true);
    expect(draft.warnings).toEqual([]);
    expect(
      draft.fields.find((entry: Body) => entry.fieldId === "summary").required,
    ).toBe(true);
    expect(
      draft.fields.find((entry: Body) => entry.fieldId === "priority"),
    ).toMatchObject({
      required: false,
      allowedValues: [{ id: "1", name: "Highest" }],
    });
    expect(draft.missingRequired).toEqual([
      { fieldId: "customfield_99", name: "Cost centre", mapped: false },
    ]);

    // Read as the caller: editor2's token, nobody else's.
    expect(jira.createClient.mock.calls.map(([c]) => c.token)).toEqual([
      TOKEN_B,
    ]);
    expect(jira.getCreateFields).toHaveBeenCalledWith("PRJ", "10001");

    // The dialog can ask about another project and issue type.
    await s.call(
      s.editor2,
      "GET",
      `/task/${s.task.id}/draft?jiraProjectKey=OTHER&issueTypeId=5`,
    );
    expect(jira.getCreateFields).toHaveBeenLastCalledWith("OTHER", "5");
    await expectNoSecrets(s, response);
  });

  it("turns a Jira failure into a warning and still returns the draft", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    const query = "?jiraProjectKey=PRJ&issueTypeId=1";

    jira.getCreateFields.mockRejectedValueOnce(
      new JiraApiError("Jira API error 500", 500, "HTTP_ERROR", ["Boom"]),
    );
    const failed = await s.call(
      s.editor,
      "GET",
      `/task/${s.task.id}/draft${query}`,
    );
    expect(failed.status).toBe(200);
    expect(failed.json.warnings).toEqual([
      expect.objectContaining({ code: "JIRA_REQUEST_FAILED" }),
    ]);
    expect(failed.json.createMeta).toBeNull();
    expect(failed.json.fields.length).toBeGreaterThan(0);

    jira.getCreateFields.mockRejectedValueOnce(
      new JiraApiError("Jira API error 401", 401, "HTTP_ERROR"),
    );
    const rejected = await s.call(
      s.editor,
      "GET",
      `/task/${s.task.id}/draft${query}`,
    );
    expect(rejected.status).toBe(200);
    expect(rejected.json.warnings).toEqual([
      expect.objectContaining({ code: "JIRA_TOKEN_INVALID" }),
    ]);

    // Nothing to read the metadata for yet.
    const noTarget = await s.call(s.editor, "GET", `/task/${s.task.id}/draft`);
    expect(noTarget.json.warnings).toEqual([
      expect.objectContaining({ code: "JIRA_TARGET_MISSING" }),
    ]);
  });

  it("opens without a token (with a warning and no Jira call) and needs an active connection", async () => {
    const s = await setup();
    const noToken = await s.call(
      s.editor,
      "GET",
      `/task/${s.task.id}/draft?jiraProjectKey=PRJ&issueTypeId=1`,
    );
    expect(noToken.status).toBe(200);
    expect(noToken.json.tokenConnected).toBe(false);
    expect(noToken.json.warnings).toEqual([
      expect.objectContaining({ code: "JIRA_TOKEN_MISSING" }),
    ]);
    expect(jira.createClient).not.toHaveBeenCalled();

    await db.update(schema.jiraConnectionTable).set({ isActive: false });
    const inactive = await s.call(s.editor, "GET", `/task/${s.task.id}/draft`);
    expect(inactive.status).toBe(404);
    expect(inactive.json.code).toBe("JIRA_NOT_CONFIGURED");

    await db.delete(schema.jiraConnectionTable);
    const none = await s.call(s.editor, "GET", `/task/${s.task.id}/draft`);
    expect(none.status).toBe(404);
    expect(none.json.code).toBe("JIRA_NOT_CONFIGURED");
  });

  it("includes the link of a linked task and does not list create-only required fields for it", async () => {
    const s = await setup();
    await s.seedLink();
    await s.setToken(s.editor, TOKEN_A);
    jira.getCreateFields.mockResolvedValue([
      {
        fieldId: "customfield_99",
        name: "Cost centre",
        required: true,
        hasDefaultValue: false,
        schema: null,
        allowedValues: null,
      },
    ]);
    const draft = (
      await s.call(
        s.editor,
        "GET",
        `/task/${s.task.id}/draft?issueTypeId=10001`,
      )
    ).json;
    expect(draft.link).toMatchObject({ issueKey: "PRJ-1" });
    // The link's own Jira project is the one the metadata was read for.
    expect(jira.getCreateFields).toHaveBeenCalledWith("PRJ", "10001");
    expect(draft.missingRequired).toEqual([]);
  });
});

describe("Jira sync: send", () => {
  const fields = [
    { fieldId: "summary", type: "string", value: "Fix the login" },
    { fieldId: "description", type: "text", value: "Users cannot log in." },
    { fieldId: "priority", type: "priority", value: "urgent" },
    { fieldId: "labels", type: "labels", value: ["needs review", "bug"] },
    { fieldId: "assignee", type: "user", value: "alice" },
    { fieldId: "duedate", type: "date", value: null },
  ];
  const create = { jiraProjectKey: "PRJ", issueTypeId: "10001", fields };

  it("creates the issue with the CALLER's token, stores the link and writes the activity", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A, { name: "editor.a" });
    await s.setToken(s.editor2, TOKEN_B, { name: "editor.b" });

    const response = await s.call(
      s.editor2,
      "POST",
      `/task/${s.task.id}/send`,
      create,
    );
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      created: true,
      warnings: [],
      link: {
        taskId: s.task.id,
        issueId: "10001",
        issueKey: "PRJ-1",
        issueUrl: `${BASE_URL}/browse/PRJ-1`,
        jiraProjectKey: "PRJ",
        lastStatusName: "To Do",
        createdByUserId: s.editor2.id,
      },
    });

    // The client factory got editor2's token, and only that one.
    expect(jira.createClient).toHaveBeenCalledTimes(1);
    expect(jira.createClient.mock.calls[0]?.[0]).toMatchObject({
      token: TOKEN_B,
      baseUrl: BASE_URL,
      deployment: "server",
    });
    expect(
      jira.createClient.mock.calls.map(([config]) => config.token),
    ).not.toContain(TOKEN_A);

    // Typed values were converted on the server; project and type come from the
    // dialog; the empty due date is left out.
    expect(jira.createIssue).toHaveBeenCalledTimes(1);
    expect(jira.createIssue).toHaveBeenCalledWith({
      project: { key: "PRJ" },
      issuetype: { id: "10001" },
      summary: "Fix the login",
      description: "Users cannot log in.",
      priority: { name: "Highest" },
      labels: ["needs-review", "bug"],
      assignee: { name: "alice" },
    });

    const link = await s.readLink();
    expect(link).toMatchObject({
      issueKey: "PRJ-1",
      createdByUserId: s.editor2.id,
      lastStatusId: "1",
    });

    const created = await s.activities("jira_issue_created");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      userId: s.editor2.id,
      eventData: { issueKey: "PRJ-1", issueUrl: `${BASE_URL}/browse/PRJ-1` },
    });
    expect(Object.keys(created[0]?.eventData as object).sort()).toEqual([
      "issueKey",
      "issueUrl",
    ]);

    expect(s.publishedOf("jira.issue_linked")).toEqual([
      {
        type: "jira.issue_linked",
        data: expect.objectContaining({
          taskId: s.task.id,
          projectId: s.project.id,
          issueKey: "PRJ-1",
          created: true,
        }),
      },
    ]);
    await expectNoSecrets(s, response);
  });

  it("updates the linked issue without project and issue type, with the updating person's own token", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    await s.setToken(s.editor2, TOKEN_B);
    await s.seedLink({ createdBy: s.editor2.id });

    const response = await s.call(s.editor, "POST", `/task/${s.task.id}/send`, {
      jiraProjectKey: "IGNORED",
      issueTypeId: "999",
      fields: [
        { fieldId: "summary", type: "string", value: "New title" },
        { fieldId: "project", type: "string", value: "EVIL" },
        { fieldId: "description", type: "text", value: "" },
      ],
    });
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      created: false,
      link: { issueKey: "PRJ-1", createdByUserId: s.editor2.id },
    });
    expect(jira.createIssue).not.toHaveBeenCalled();
    expect(jira.updateIssue).toHaveBeenCalledWith("PRJ-1", {
      summary: "New title",
    });
    expect(jira.createClient.mock.calls.map(([c]) => c.token)).toEqual([
      TOKEN_A,
    ]);

    const updated = await s.activities("jira_issue_updated");
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      userId: s.editor.id,
      eventData: { issueKey: "PRJ-1" },
    });
    expect(await s.activities("jira_issue_created")).toHaveLength(0);
    expect(s.publishedOf("jira.issue_linked")[0]?.data).toMatchObject({
      created: false,
    });
    // The poll still reads it with the token of the person who linked it.
    expect((await s.readLink())?.createdByUserId).toBe(s.editor2.id);
    await expectNoSecrets(s, response);
  });

  it("sees a status that moved in Jira during an update as a proposal, and never applies it", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    await s.seedLink();
    jira.getIssue.mockResolvedValue({
      id: "10001",
      key: "PRJ-1",
      fields: { status: { id: "3", name: "In Progress" } },
    });

    const response = await s.call(s.editor, "POST", `/task/${s.task.id}/send`, {
      fields: [{ fieldId: "summary", type: "string", value: "x" }],
    });
    expect(response.status).toBe(200);
    expect((await s.proposals()).map((row) => row.state)).toEqual(["pending"]);
    expect((await s.readTask()).status).toBe("to-do");
  });

  it("answers JIRA_TOKEN_MISSING without a token, and never calls Jira", async () => {
    const s = await setup();
    await s.setToken(s.editor2, TOKEN_B);

    const response = await s.call(
      s.editor,
      "POST",
      `/task/${s.task.id}/send`,
      create,
    );
    expect(response.status).toBe(409);
    expect(response.json.code).toBe("JIRA_TOKEN_MISSING");
    // Another person's token is never used in their place.
    expect(jira.createClient).not.toHaveBeenCalled();
    expect(jira.createIssue).not.toHaveBeenCalled();
    expect(await s.readLink()).toBeNull();
    expect(await s.activities()).toHaveLength(0);
  });

  it("answers JIRA_NOT_CONFIGURED without an active connection", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    await db.update(schema.jiraConnectionTable).set({ isActive: false });
    const response = await s.call(
      s.editor,
      "POST",
      `/task/${s.task.id}/send`,
      create,
    );
    expect(response.status).toBe(404);
    expect(response.json.code).toBe("JIRA_NOT_CONFIGURED");
    expect(jira.createIssue).not.toHaveBeenCalled();
  });

  it("refuses an invalid body or value before anything reaches Jira", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    const send = (body: unknown) =>
      s.call(s.editor, "POST", `/task/${s.task.id}/send`, body);

    // Creating needs the project and the issue type.
    expect((await send({ fields })).status).toBe(400);
    // A value that is not its field type.
    const badNumber = await send({
      ...create,
      fields: [{ fieldId: "customfield_1", type: "number", value: "abc" }],
    });
    expect(badNumber.status).toBe(400);
    expect(badNumber.text).toContain("customfield_1");
    // An unknown field type, or a client-supplied Jira JSON object.
    expect(
      (
        await send({
          ...create,
          fields: [{ fieldId: "summary", type: "raw", value: "x" }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send({
          ...create,
          fields: [{ fieldId: "assignee", type: "user", value: { name: "x" } }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send({
          ...create,
          fields: [{ fieldId: "bad id!", type: "string", value: "x" }],
        })
      ).status,
    ).toBe(400);

    expect(jira.createIssue).not.toHaveBeenCalled();
    expect(await s.readLink()).toBeNull();
  });

  it("reports a Jira failure with its messages, without a link or activity", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    jira.createIssue.mockRejectedValueOnce(
      new JiraApiError(
        "Jira API error 400: Field 'customfield_9' is required",
        400,
        "HTTP_ERROR",
        [],
        { customfield_9: "Field is required" },
      ),
    );
    const response = await s.call(
      s.editor,
      "POST",
      `/task/${s.task.id}/send`,
      create,
    );
    expect(response.status).toBe(502);
    expect(response.json).toMatchObject({
      code: "JIRA_REQUEST_FAILED",
      errors: { customfield_9: "Field is required" },
    });
    expect(await s.readLink()).toBeNull();
    expect(await s.activities()).toHaveLength(0);

    jira.createIssue.mockRejectedValueOnce(
      new JiraApiError("Jira API error 401", 401, "HTTP_ERROR"),
    );
    const rejected = await s.call(
      s.editor,
      "POST",
      `/task/${s.task.id}/send`,
      create,
    );
    expect(rejected.status).toBe(422);
    expect(rejected.json.code).toBe("JIRA_TOKEN_INVALID");
    await expectNoSecrets(s, response, rejected);
  });

  it("keeps the created issue linked when its status cannot be read, and says so", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    jira.getIssue.mockRejectedValueOnce(
      new JiraApiError("Jira API error 500", 500, "HTTP_ERROR"),
    );
    const response = await s.call(
      s.editor,
      "POST",
      `/task/${s.task.id}/send`,
      create,
    );
    expect(response.status).toBe(200);
    expect(response.json.warnings).toEqual([
      expect.objectContaining({ code: "JIRA_STATUS_UNAVAILABLE" }),
    ]);
    expect(await s.readLink()).toMatchObject({
      issueKey: "PRJ-1",
      lastStatusId: null,
      lastStatusName: null,
    });
  });

  it("answers 409 JIRA_ISSUE_ALREADY_LINKED when the issue is linked to another task, and links nothing", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    const [other] = await db
      .insert(schema.taskTable)
      .values({ projectId: s.project.id, title: "Other", number: 2 })
      .returning();
    if (!other) throw new Error("task was not created");
    await s.seedLink({ forTask: other, issueId: "10001", issueKey: "PRJ-1" });

    const response = await s.call(
      s.editor,
      "POST",
      `/task/${s.task.id}/send`,
      create,
    );
    expect(response.status).toBe(409);
    expect(response.json.code).toBe("JIRA_ISSUE_ALREADY_LINKED");
    expect(await s.readLink()).toBeNull();
    expect(await s.activities()).toHaveLength(0);
    expect(s.publishedOf("jira.issue_linked")).toHaveLength(0);
    expect(await db.select().from(schema.jiraIssueLinkTable)).toHaveLength(1);
  });
});

describe("Jira sync: webhook", () => {
  async function linked() {
    const s = await setup();
    const link = await s.seedLink({ createdBy: s.editor2.id });
    await s.setToken(s.editor2, TOKEN_B);
    return { s, link };
  }

  async function counts(s: Setup) {
    return {
      activities: (await s.activities()).length,
      proposals: (await s.proposals()).length,
      notifications: (await db.select().from(schema.notificationTable)).length,
      link: await s.readLink(),
      task: await s.readTask(),
      events: events.published.length,
    };
  }

  it("rejects a wrong, missing or empty secret and an unknown connection with 401, and changes nothing", async () => {
    const { s } = await linked();
    const before = await counts(s);
    const payload = statusPayload({ id: "3", name: "In Progress" });

    const attempts = [
      await s.webhook(payload, { secret: "wrong-secret" }),
      await s.webhook(payload, { secret: null }),
      await s.webhook(payload, { secret: "" }),
      await s.webhook(payload, { secret: `${WEBHOOK_SECRET}x` }),
      await s.webhook(payload, { secret: WEBHOOK_SECRET.slice(0, -1) }),
      await s.webhook(payload, { id: "no-such-connection" }),
      await s.webhook(payload, {
        id: "no-such-connection",
        secret: "wrong-secret",
      }),
    ];
    for (const attempt of attempts) {
      expect(attempt.status).toBe(401);
    }
    // An unknown connection and a wrong secret are indistinguishable.
    expect(new Set(attempts.map((attempt) => attempt.text)).size).toBe(1);
    expect(attempts[0]?.text).not.toContain(WEBHOOK_SECRET);

    await waitForPendingEventHandlers();
    expect(await counts(s)).toEqual(before);
  });

  it("does not need a session, and ignores a switched-off connection, other events and unknown issues with 200", async () => {
    const { s } = await linked();
    const before = await counts(s);

    const created = await s.webhook({
      webhookEvent: "jira:issue_created",
      issue: { id: "10001", key: "PRJ-1" },
    });
    expect(created).toMatchObject({
      status: 200,
      json: { status: "ignored" },
    });
    const notStatus = await s.webhook({
      webhookEvent: "jira:issue_updated",
      issue: { id: "10001", key: "PRJ-1" },
      changelog: { items: [{ field: "summary", toString: "x" }] },
    });
    expect(notStatus.json).toEqual({ status: "ignored" });
    const unknown = await s.webhook(
      statusPayload(
        { id: "3", name: "In Progress" },
        { issue: { id: "99999", key: "NOPE-1" } },
      ),
    );
    expect(unknown).toMatchObject({ status: 200, json: { status: "ignored" } });

    await db.update(schema.jiraConnectionTable).set({ isActive: false });
    const inactive = await s.webhook(
      statusPayload({ id: "3", name: "In Progress" }),
    );
    expect(inactive).toMatchObject({
      status: 200,
      json: { status: "ignored" },
    });

    expect(await counts(s)).toEqual(before);
  });

  it("answers 400 to invalid JSON (after the secret is checked) and 413 to an oversized body", async () => {
    const { s } = await linked();
    const url = `/api/jira-integration/webhook/${s.connection.id}?secret=${WEBHOOK_SECRET}`;

    const invalid = await s.app.request(url, {
      method: "POST",
      body: "{not json",
    });
    expect(invalid.status).toBe(400);

    const huge = await s.app.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filler: "x".repeat(300 * 1024) }),
    });
    expect(huge.status).toBe(413);
    expect((await s.readLink())?.lastStatusName).toBe("To Do");
  });

  it("records a status change as activity and ONE pending proposal, and leaves the task's status alone", async () => {
    const { s, link } = await linked();

    const response = await s.webhook(
      statusPayload({ id: "3", name: "In Progress" }),
    );
    expect(response).toMatchObject({
      status: 200,
      json: { status: "processed" },
    });
    await waitForPendingEventHandlers();

    const changed = await s.activities("jira_status_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      userId: null,
      content: "To Do → In Progress",
      eventData: {
        issueKey: "PRJ-1",
        fromStatus: "To Do",
        toStatus: "In Progress",
        proposedStatus: null,
      },
    });

    const rows = await s.proposals();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      linkId: link.id,
      state: "pending",
      fromStatusName: "To Do",
      toStatusId: "3",
      toStatusName: "In Progress",
      proposedStatus: null,
      source: "webhook",
      jiraChangedBy: "Bob Example",
    });
    expect(rows[0]?.jiraChangedAt).toEqual(new Date(1_790_000_000_000));

    // The task did not move.
    const task = await s.readTask();
    expect(task.status).toBe("to-do");
    expect(task.columnId).toBe(s.columns.todo.id);
    expect(s.publishedOf("task.status_changed")).toHaveLength(0);

    expect(await s.readLink()).toMatchObject({
      lastStatusId: "3",
      lastStatusName: "In Progress",
      syncError: null,
    });
    expect(s.publishedOf("jira.status_changed")).toEqual([
      {
        type: "jira.status_changed",
        data: expect.objectContaining({
          taskId: s.task.id,
          projectId: s.project.id,
          toStatus: "In Progress",
          proposalId: rows[0]?.id,
          source: "webhook",
        }),
      },
    ]);
    expect(s.publishedOf("jira.status_proposal_created")).toHaveLength(1);

    // The task's user assignee and the person who linked the issue are told.
    const notifications = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.type, "jira_status_proposal"));
    expect(notifications.map((row) => row.userId).sort()).toEqual(
      [s.editor.id, s.editor2.id].sort(),
    );
    expect(notifications[0]).toMatchObject({
      resourceId: s.task.id,
      resourceType: "task",
      eventData: expect.objectContaining({
        issueKey: "PRJ-1",
        toStatus: "In Progress",
        proposalId: rows[0]?.id,
      }),
    });
    await expectNoSecrets(s, { text: JSON.stringify(response.json) });
  });

  it("is idempotent: the same change delivered twice records it once", async () => {
    const { s } = await linked();
    const payload = statusPayload({ id: "3", name: "In Progress" });

    expect((await s.webhook(payload)).json).toEqual({ status: "processed" });
    expect((await s.webhook(payload)).json).toEqual({ status: "ignored" });
    await waitForPendingEventHandlers();

    expect(await s.activities("jira_status_changed")).toHaveLength(1);
    expect(await s.proposals()).toHaveLength(1);
    expect(s.publishedOf("jira.status_changed")).toHaveLength(1);
  });

  it("finds the link by issue key when the id is not one it knows", async () => {
    const { s } = await linked();
    const response = await s.webhook(
      statusPayload(
        { id: "3", name: "In Progress" },
        { issue: { key: "PRJ-1" } },
      ),
    );
    expect(response.json).toEqual({ status: "processed" });
    expect(await s.proposals()).toHaveLength(1);
  });

  it("supersedes the pending proposal when a newer change arrives, and maps the status when it is mapped", async () => {
    const { s } = await linked();
    await s.putMapping(s.manager, `/project/${s.project.id}/mapping`, {
      statusMappings: [
        { jiraStatusName: "Done", kaneoStatus: "done" },
        { jiraStatusId: "3", jiraStatusName: "In Progress", kaneoStatus: null },
      ],
    });

    await s.webhook(statusPayload({ id: "3", name: "In Progress" }));
    await s.webhook(
      statusPayload({ id: "5", name: "Done" }, { from: "In Progress" }),
    );
    await waitForPendingEventHandlers();

    const rows = await s.proposals();
    expect(rows).toHaveLength(2);
    const pending = rows.filter((row) => row.state === "pending");
    const superseded = rows.filter((row) => row.state === "superseded");
    expect(pending).toHaveLength(1);
    expect(superseded).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      toStatusName: "Done",
      proposedStatus: "done",
      fromStatusName: "In Progress",
    });
    expect(superseded[0]).toMatchObject({ toStatusName: "In Progress" });
    expect(await s.activities("jira_status_changed")).toHaveLength(2);
    expect((await s.readTask()).status).toBe("to-do");
    expect(s.publishedOf("jira.status_proposal_created")).toHaveLength(2);

    const info = await s.call(s.viewer, "GET", `/task/${s.task.id}`);
    expect(info.json.pendingProposal.id).toBe(pending[0]?.id);
  });

  it("matches a status mapping by name without case, and by id over name", async () => {
    const { s } = await linked();
    await s.putMapping(s.manager, `${s.ws}/mapping`, {
      statusMappings: [
        { jiraStatusName: "in progress", kaneoStatus: "in-progress" },
        { jiraStatusId: "5", jiraStatusName: "Done", kaneoStatus: "in-review" },
      ],
    });
    await s.webhook(statusPayload({ id: "3", name: "In Progress" }));
    expect((await s.proposals())[0]?.proposedStatus).toBe("in-progress");

    await s.webhook(statusPayload({ id: "5", name: "Renamed in Jira" }));
    const pending = (await s.proposals()).filter(
      (row) => row.state === "pending",
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]?.proposedStatus).toBe("in-review");
  });

  it("does not propose anything when the mapped status is the task's current one, and supersedes the old proposal", async () => {
    const { s } = await linked();
    await s.putMapping(s.manager, `/project/${s.project.id}/mapping`, {
      statusMappings: [
        { jiraStatusName: "In Review", kaneoStatus: "in-review" },
      ],
    });
    // An earlier, still pending proposal about a status nobody mapped.
    await s.webhook(statusPayload({ id: "3", name: "In Progress" }));
    expect((await s.proposals()).map((row) => row.state)).toEqual(["pending"]);

    await db
      .update(schema.taskTable)
      .set({ status: "in-review", columnId: s.columns.inReview.id })
      .where(eq(schema.taskTable.id, s.task.id));

    const response = await s.webhook(
      statusPayload({ id: "4", name: "In Review" }, { from: "In Progress" }),
    );
    expect(response.json).toEqual({ status: "processed" });
    await waitForPendingEventHandlers();

    // Seen and recorded, but nobody has to decide anything.
    const rows = await s.proposals();
    expect(rows.filter((row) => row.state === "pending")).toHaveLength(0);
    expect(rows.map((row) => row.state)).toEqual(["superseded"]);
    expect(await s.activities("jira_status_changed")).toHaveLength(2);
    expect(s.publishedOf("jira.status_changed")).toHaveLength(2);
    expect(s.publishedOf("jira.status_proposal_created")).toHaveLength(1);
    expect(await s.readLink()).toMatchObject({ lastStatusName: "In Review" });
    expect((await s.readTask()).status).toBe("in-review");
  });

  it("treats a mapped status that is no longer a column of the project as not mapped", async () => {
    const { s } = await linked();
    await s.putMapping(s.manager, `${s.ws}/mapping`, {
      statusMappings: [
        { jiraStatusName: "In Progress", kaneoStatus: "removed-column" },
      ],
    });
    await s.webhook(statusPayload({ id: "3", name: "In Progress" }));
    expect((await s.proposals())[0]?.proposedStatus).toBeNull();
  });
});

describe("Jira sync: accept and reject", () => {
  async function withProposal(
    overrides: Partial<typeof schema.jiraStatusProposalTable.$inferInsert> = {},
  ) {
    const s = await setup();
    const link = await s.seedLink();
    const proposal = await s.seedProposal(link, overrides);
    return { s, link, proposal };
  }

  it("changes the task's status through updateTaskStatus, marks the proposal accepted and publishes the events", async () => {
    const { s, proposal } = await withProposal();

    const response = await s.call(
      s.editor,
      "POST",
      `/proposal/${proposal.id}/accept`,
      {},
    );
    expect(response.status).toBe(200);
    expect(response.json.proposal).toMatchObject({
      id: proposal.id,
      state: "accepted",
      resolvedByUserId: s.editor.id,
      resolvedStatus: "done",
    });
    expect(response.json.proposal.resolvedAt).toEqual(expect.any(String));

    const task = await s.readTask();
    expect(task.status).toBe("done");
    expect(task.columnId).toBe(s.columns.done.id);

    // The normal status change ran: event, activity by the caller.
    await waitForPendingEventHandlers();
    expect(s.publishedOf("task.status_changed")).toEqual([
      {
        type: "task.status_changed",
        data: expect.objectContaining({
          taskId: s.task.id,
          userId: s.editor.id,
          oldStatus: "to-do",
          newStatus: "done",
        }),
      },
    ]);
    const statusActivity = await s.activities("status_changed");
    expect(statusActivity).toHaveLength(1);
    expect(statusActivity[0]).toMatchObject({
      userId: s.editor.id,
      eventData: { oldStatus: "to-do", newStatus: "done" },
    });
    expect(s.publishedOf("jira.status_proposal_resolved")).toEqual([
      {
        type: "jira.status_proposal_resolved",
        data: expect.objectContaining({
          taskId: s.task.id,
          projectId: s.project.id,
          proposalId: proposal.id,
          state: "accepted",
          status: "done",
        }),
      },
    ]);
  });

  it("answers 409 PROPOSAL_NOT_PENDING to a second accept, also when two arrive at once, and changes the status once", async () => {
    const { s, proposal } = await withProposal();
    const accept = () =>
      s.call(s.editor, "POST", `/proposal/${proposal.id}/accept`, {});

    const both = await Promise.all([accept(), accept()]);
    expect(both.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(both.find((response) => response.status === 409)?.json.code).toBe(
      "PROPOSAL_NOT_PENDING",
    );
    await waitForPendingEventHandlers();
    expect(s.publishedOf("task.status_changed")).toHaveLength(1);
    expect(s.publishedOf("jira.status_proposal_resolved")).toHaveLength(1);

    const again = await accept();
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("PROPOSAL_NOT_PENDING");
    expect(s.publishedOf("task.status_changed")).toHaveLength(1);
    expect((await s.proposals())[0]).toMatchObject({
      state: "accepted",
      resolvedByUserId: s.editor.id,
    });
  });

  it("needs a status for an unmapped proposal, validates it, and accepts a valid one", async () => {
    const { s, proposal } = await withProposal({
      toStatusName: "Blocked",
      proposedStatus: null,
    });
    const path = `/proposal/${proposal.id}/accept`;

    const missing = await s.call(s.editor, "POST", path, {});
    expect(missing.status).toBe(400);
    expect(missing.json.code).toBe("STATUS_REQUIRED");
    // No body at all is the same thing.
    const noBody = await s.call(s.editor, "POST", path);
    expect(noBody.status).toBe(400);
    expect(noBody.json.code).toBe("STATUS_REQUIRED");

    const invalid = await s.call(s.editor, "POST", path, {
      status: "no-such-column",
    });
    expect(invalid.status).toBe(400);
    expect(invalid.text).toContain("Invalid status");

    // Still pending, and the task has not moved.
    expect((await s.proposals())[0]?.state).toBe("pending");
    expect((await s.readTask()).status).toBe("to-do");
    expect(s.publishedOf("task.status_changed")).toHaveLength(0);

    const accepted = await s.call(s.editor, "POST", path, {
      status: "in-review",
    });
    expect(accepted.status).toBe(200);
    expect(accepted.json.proposal).toMatchObject({
      state: "accepted",
      resolvedStatus: "in-review",
    });
    expect((await s.readTask()).status).toBe("in-review");
  });

  it("lets the person choose another status than the proposed one", async () => {
    const { s, proposal } = await withProposal();
    const response = await s.call(
      s.editor,
      "POST",
      `/proposal/${proposal.id}/accept`,
      { status: "in-progress" },
    );
    expect(response.status).toBe(200);
    expect((await s.readTask()).status).toBe("in-progress");
    expect((await s.proposals())[0]?.resolvedStatus).toBe("in-progress");
  });

  it("cannot accept or reject a superseded, rejected or accepted proposal", async () => {
    const { s, link, proposal } = await withProposal({ state: "superseded" });
    const accepted = await s.seedProposal(link, { state: "accepted" });
    const rejected = await s.seedProposal(link, { state: "rejected" });

    for (const row of [proposal, accepted, rejected]) {
      for (const action of ["accept", "reject"]) {
        const response = await s.call(
          s.editor,
          "POST",
          `/proposal/${row.id}/${action}`,
          action === "accept" ? {} : undefined,
        );
        expect(response.status, `${row.state} ${action}`).toBe(409);
        expect(response.json.code).toBe("PROPOSAL_NOT_PENDING");
      }
    }
    expect((await s.readTask()).status).toBe("to-do");
  });

  it("rejects a proposal without touching the task, once", async () => {
    const { s, proposal } = await withProposal();
    const response = await s.call(
      s.editor,
      "POST",
      `/proposal/${proposal.id}/reject`,
    );
    expect(response.status).toBe(200);
    expect(response.json.proposal).toMatchObject({
      state: "rejected",
      resolvedByUserId: s.editor.id,
      resolvedStatus: null,
    });
    expect((await s.readTask()).status).toBe("to-do");
    expect(s.publishedOf("task.status_changed")).toHaveLength(0);
    expect(
      s.publishedOf("jira.status_proposal_resolved")[0]?.data,
    ).toMatchObject({ state: "rejected", proposalId: proposal.id });

    const again = await s.call(
      s.editor,
      "POST",
      `/proposal/${proposal.id}/reject`,
    );
    expect(again.status).toBe(409);
    expect(
      (await s.call(s.editor, "POST", `/proposal/${proposal.id}/accept`, {}))
        .status,
    ).toBe(409);
    expect((await s.readTask()).status).toBe("to-do");
  });

  it("validates the status against the project of the task", async () => {
    const { s, proposal } = await withProposal({ proposedStatus: "stale" });
    const response = await s.call(
      s.editor,
      "POST",
      `/proposal/${proposal.id}/accept`,
      {},
    );
    expect(response.status).toBe(400);
    expect((await s.proposals())[0]?.state).toBe("pending");
  });
});

describe("Jira sync: refresh and unlink", () => {
  it("reads the status with the CALLER's token and proposes a change, never applying it", async () => {
    const s = await setup();
    await s.seedLink({ createdBy: s.editor2.id });
    await s.setToken(s.editor, TOKEN_A);
    await s.setToken(s.editor2, TOKEN_B);
    jira.getIssue.mockResolvedValue({
      id: "10001",
      key: "PRJ-1",
      fields: { status: { id: "5", name: "Done" } },
    });

    const response = await s.call(
      s.editor,
      "POST",
      `/task/${s.task.id}/refresh`,
    );
    expect(response.status).toBe(200);
    expect(response.json.changed).toBe(true);
    expect(response.json.info.pendingProposal).toMatchObject({
      toStatusName: "Done",
      source: "manual",
      state: "pending",
    });
    expect(response.json.info.link).toMatchObject({ lastStatusName: "Done" });

    // The caller's token, not the token of the person who linked the issue.
    expect(jira.createClient.mock.calls.map(([c]) => c.token)).toEqual([
      TOKEN_A,
    ]);
    expect(jira.getIssue).toHaveBeenCalledWith("PRJ-1", ["status"]);
    expect((await s.readTask()).status).toBe("to-do");
    await waitForPendingEventHandlers();
    // The person who asked is not notified about what they just pulled in.
    const notified = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.type, "jira_status_proposal"));
    expect(notified.map((row) => row.userId)).toEqual([s.editor2.id]);

    const again = await s.call(s.editor, "POST", `/task/${s.task.id}/refresh`);
    expect(again.json.changed).toBe(false);
    expect(await s.proposals()).toHaveLength(1);
    await expectNoSecrets(s, response, again);
  });

  it("lets a viewer with their own token refresh, but not decide", async () => {
    const s = await setup();
    await s.seedLink();
    await s.setToken(s.viewer, TOKEN_V);
    const response = await s.call(
      s.viewer,
      "POST",
      `/task/${s.task.id}/refresh`,
    );
    expect(response.status).toBe(200);
    expect(jira.createClient.mock.calls.map(([c]) => c.token)).toEqual([
      TOKEN_V,
    ]);
  });

  it("starts from the first status it reads: no change, no proposal", async () => {
    const s = await setup();
    await s.seedLink({ status: null });
    await s.setToken(s.editor, TOKEN_A);
    const response = await s.call(
      s.editor,
      "POST",
      `/task/${s.task.id}/refresh`,
    );
    expect(response.status).toBe(200);
    expect(response.json.changed).toBe(false);
    expect(await s.readLink()).toMatchObject({
      lastStatusId: "1",
      lastStatusName: "To Do",
    });
    expect(await s.proposals()).toHaveLength(0);
    expect(await s.activities("jira_status_changed")).toHaveLength(0);
  });

  it("answers JIRA_NOT_LINKED, JIRA_TOKEN_MISSING, and marks a rejected token", async () => {
    const s = await setup();
    const path = `/task/${s.task.id}/refresh`;

    const notLinked = await s.call(s.editor, "POST", path);
    expect(notLinked.status).toBe(404);
    expect(notLinked.json.code).toBe("JIRA_NOT_LINKED");

    await s.seedLink();
    const noToken = await s.call(s.editor, "POST", path);
    expect(noToken.status).toBe(409);
    expect(noToken.json.code).toBe("JIRA_TOKEN_MISSING");

    await s.setToken(s.editor, TOKEN_A);
    jira.getIssue.mockRejectedValueOnce(
      new JiraApiError("Jira API error 401", 401, "HTTP_ERROR"),
    );
    const rejected = await s.call(s.editor, "POST", path);
    expect(rejected.status).toBe(422);
    expect(rejected.json.code).toBe("JIRA_TOKEN_INVALID");
    const status = await s.call(s.editor, "GET", `${s.ws}/me/token`);
    expect(status.json.lastError).toEqual(expect.any(String));
    expect(status.text).not.toContain(TOKEN_A);

    // A working token clears it again.
    const ok = await s.call(s.editor, "POST", path);
    expect(ok.status).toBe(200);
    expect(
      (await s.call(s.editor, "GET", `${s.ws}/me/token`)).json.lastError,
    ).toBeNull();
  });

  it("unlinks without touching Jira, removes the proposals, and records it", async () => {
    const s = await setup();
    const link = await s.seedLink();
    await s.seedProposal(link);
    await s.setToken(s.editor, TOKEN_A);

    const response = await s.call(
      s.editor,
      "DELETE",
      `/task/${s.task.id}/link`,
    );
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ success: true });
    expect(await s.readLink()).toBeNull();
    expect(await s.proposals()).toHaveLength(0);
    expect(jira.createClient).not.toHaveBeenCalled();
    expect(jira.updateIssue).not.toHaveBeenCalled();

    const unlinked = await s.activities("jira_issue_unlinked");
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toMatchObject({
      userId: s.editor.id,
      eventData: { issueKey: "PRJ-1" },
    });
    expect(s.publishedOf("jira.issue_unlinked")).toHaveLength(1);

    const info = await s.call(s.editor, "GET", `/task/${s.task.id}`);
    expect(info.json.link).toBeNull();
    // Unlinking twice is harmless.
    expect(
      (await s.call(s.editor, "DELETE", `/task/${s.task.id}/link`)).status,
    ).toBe(200);
  });
});

describe("Jira sync: poll", () => {
  async function extraTasks(s: Setup, count: number, from = 2) {
    const rows = await db
      .insert(schema.taskTable)
      .values(
        Array.from({ length: count }, (_, index) => ({
          projectId: s.project.id,
          title: `Task ${from + index}`,
          number: from + index,
        })),
      )
      .returning();
    return rows;
  }

  function searchAnswers(map: Record<string, { id: string; name: string }>) {
    jira.searchIssues.mockImplementation(async (jql: string) =>
      [...jql.matchAll(/"([^"]+)"/g)].flatMap(([, key]) => {
        const status = key ? map[key] : undefined;
        return key && status
          ? [
              {
                id: `id-${key}`,
                key,
                fields: { status },
              },
            ]
          : [];
      }),
    );
  }

  it("reads each link with the token of the person who linked it, and records the changes as proposals", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    await s.setToken(s.editor2, TOKEN_B);
    const [second] = await extraTasks(s, 1);
    if (!second) throw new Error("task was not created");
    await s.seedLink({
      issueId: "id-PRJ-1",
      issueKey: "PRJ-1",
      createdBy: s.editor.id,
    });
    await s.seedLink({
      forTask: second,
      issueId: "id-PRJ-2",
      issueKey: "PRJ-2",
      createdBy: s.editor2.id,
    });
    searchAnswers({
      "PRJ-1": { id: "3", name: "In Progress" },
      "PRJ-2": { id: "5", name: "Done" },
    });

    expect(await pollJiraStatuses()).toEqual({ degraded: false });

    const searches = jira.searches;
    expect(searches).toHaveLength(2);
    const forKey = (key: string) =>
      searches.find((search) => search.jql.includes(`"${key}"`));
    expect(forKey("PRJ-1")).toEqual({
      token: TOKEN_A,
      jql: 'key in ("PRJ-1")',
    });
    expect(forKey("PRJ-2")).toEqual({
      token: TOKEN_B,
      jql: 'key in ("PRJ-2")',
    });
    expect(jira.createClient.mock.calls.map(([c]) => c.token).sort()).toEqual(
      [TOKEN_A, TOKEN_B].sort(),
    );

    const rows = await db.select().from(schema.jiraStatusProposalTable);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.state === "pending")).toBe(true);
    expect(rows.every((row) => row.source === "poll")).toBe(true);
    expect(await s.activities("jira_status_changed")).toHaveLength(1);
    // Nothing moved.
    expect((await s.readTask()).status).toBe("to-do");
    expect(s.publishedOf("task.status_changed")).toHaveLength(0);

    // Polling again sees nothing new.
    expect(await pollJiraStatuses()).toEqual({ degraded: false });
    expect(await db.select().from(schema.jiraStatusProposalTable)).toHaveLength(
      2,
    );
    await expectNoSecrets(s);
  });

  it("skips a link whose creator has no token, and never uses somebody else's token for it", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    await s.seedLink({ createdBy: s.viewer.id });
    searchAnswers({ "PRJ-1": { id: "3", name: "In Progress" } });

    expect(await pollJiraStatuses()).toEqual({ degraded: false });
    expect(jira.searches).toHaveLength(0);
    expect(jira.createClient).not.toHaveBeenCalled();
    expect(await s.proposals()).toHaveLength(0);
    expect((await s.readLink())?.syncError).toContain("no Jira token");
  });

  it("does not use the token of a creator who left the workspace", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    await s.seedLink({ createdBy: s.editor.id });
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, s.editor.id));
    searchAnswers({ "PRJ-1": { id: "3", name: "In Progress" } });

    expect(await pollJiraStatuses()).toEqual({ degraded: false });
    expect(jira.searches).toHaveLength(0);
    expect(jira.createClient).not.toHaveBeenCalled();
    expect(await s.proposals()).toHaveLength(0);
    expect((await s.readLink())?.syncError).toContain("no longer a member");
  });

  it("does not poll a link without a creator, a switched-off connection or one with polling off", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    await s.seedLink({ createdBy: null });
    expect(await pollJiraStatuses()).toEqual({ degraded: false });
    expect(jira.searches).toHaveLength(0);

    await db
      .update(schema.jiraIssueLinkTable)
      .set({ createdByUserId: s.editor.id });
    await db.update(schema.jiraConnectionTable).set({ pollingEnabled: false });
    await pollJiraStatuses();
    expect(jira.searches).toHaveLength(0);

    await db
      .update(schema.jiraConnectionTable)
      .set({ pollingEnabled: true, isActive: false });
    await pollJiraStatuses();
    expect(jira.searches).toHaveLength(0);

    await db.update(schema.jiraConnectionTable).set({ isActive: true });
    searchAnswers({ "PRJ-1": { id: "1", name: "To Do" } });
    await pollJiraStatuses();
    expect(jira.searches).toHaveLength(1);
  });

  it("marks the creator's token when Jira rejects it, and records nothing", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    await s.seedLink({ createdBy: s.editor.id });
    jira.searchIssues.mockRejectedValue(
      new JiraApiError("Jira API error 401", 401, "HTTP_ERROR"),
    );

    expect(await pollJiraStatuses()).toEqual({ degraded: false });

    const [token] = await db.select().from(schema.jiraUserTokenTable);
    expect(token?.lastError).toEqual(expect.any(String));
    expect(token?.lastError).not.toContain(TOKEN_A);
    expect(await s.proposals()).toHaveLength(0);
    expect(await s.activities()).toHaveLength(0);
    const status = await s.call(s.editor, "GET", `${s.ws}/me/token`);
    expect(status.json.lastError).toEqual(expect.any(String));
    expect(status.text).not.toContain(TOKEN_A);

    // The task shows the hint while the token is rejected...
    const info = await s.call(s.editor, "GET", `/task/${s.task.id}`);
    expect(info.json.sync.creatorTokenState).toBe("invalid");

    // ...and a later successful poll clears it.
    jira.searchIssues.mockReset();
    searchAnswers({ "PRJ-1": { id: "1", name: "To Do" } });
    await pollJiraStatuses();
    const [cleared] = await db.select().from(schema.jiraUserTokenTable);
    expect(cleared?.lastError).toBeNull();
    await expectNoSecrets(s, status);
  });

  it("reports a degraded run when Jira fails, and keeps going", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    await s.setToken(s.editor2, TOKEN_B);
    const [second] = await extraTasks(s, 1);
    if (!second) throw new Error("task was not created");
    await s.seedLink({ createdBy: s.editor.id });
    await s.seedLink({
      forTask: second,
      issueId: "id-PRJ-2",
      issueKey: "PRJ-2",
      createdBy: s.editor2.id,
    });
    jira.searchIssues.mockImplementation(async (jql: string) => {
      if (jql.includes('"PRJ-1"')) {
        throw new JiraApiError("Jira API error 500", 500, "HTTP_ERROR");
      }
      return [
        {
          id: "id-PRJ-2",
          key: "PRJ-2",
          fields: { status: { id: "3", name: "In Progress" } },
        },
      ];
    });

    expect(await pollJiraStatuses()).toEqual({ degraded: true });
    expect((await s.readLink())?.syncError).toContain("could not be read");
    // The other person's link was still processed.
    const rows = await db.select().from(schema.jiraStatusProposalTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.taskId).toBe(second.id);
  });

  it("reads links in batches of 50 keys, and notes an issue it cannot find", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    const tasks = await extraTasks(s, 119);
    await s.seedLink({ createdBy: s.editor.id });
    for (const [index, task] of tasks.entries()) {
      await s.seedLink({
        forTask: task,
        issueId: `id-PRJ-${index + 2}`,
        issueKey: `PRJ-${index + 2}`,
        createdBy: s.editor.id,
      });
    }
    // Jira only knows the first one.
    searchAnswers({ "PRJ-1": { id: "1", name: "To Do" } });

    expect(await pollJiraStatuses()).toEqual({ degraded: false });

    expect(
      jira.searches.map((search) => (search.jql.match(/"/g)?.length ?? 0) / 2),
    ).toEqual([50, 50, 20]);
    expect(jira.searches.every((search) => search.token === TOKEN_A)).toBe(
      true,
    );
    const missing = await db
      .select()
      .from(schema.jiraIssueLinkTable)
      .where(inArray(schema.jiraIssueLinkTable.issueKey, ["PRJ-2", "PRJ-120"]));
    expect(missing).toHaveLength(2);
    expect(
      missing.every((row) => row.syncError?.includes("was not found")),
    ).toBe(true);
    expect((await s.readLink())?.syncError).toBeNull();
  });

  it("does nothing while another instance holds the lease", async () => {
    const s = await setup();
    await s.setToken(s.editor, TOKEN_A);
    await s.seedLink({ createdBy: s.editor.id });
    await db.execute(
      sql`INSERT INTO job_lease ("name", "owner", "expires_at") VALUES ('jira-status-poll', 'other-instance', now() + interval '10 minutes')`,
    );
    expect(await pollJiraStatuses()).toEqual({ degraded: false });
    expect(jira.searches).toHaveLength(0);
    expect(jira.createClient).not.toHaveBeenCalled();
  });
});
