import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { updateNotificationPreferences } from "../../apps/api/src/notification-preferences/service";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addProjectMember,
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const KEY = "unit-test-encryption-key";

type App = ReturnType<typeof createApp>["app"];

function call(app: App, method: string, path: string, body?: unknown) {
  return app.request(
    `/api/notification-preferences${path === "/" ? "" : path}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

async function storedPreference(userId: string) {
  const [row] = await db
    .select()
    .from(schema.userNotificationPreferenceTable)
    .where(eq(schema.userNotificationPreferenceTable.userId, userId));
  return row;
}

async function storedRules(userId: string) {
  return db
    .select()
    .from(schema.userNotificationWorkspaceRuleTable)
    .where(eq(schema.userNotificationWorkspaceRuleTable.userId, userId));
}

const ntfy = {
  ntfyEnabled: true,
  ntfyServerUrl: "https://127.0.0.1:8443/",
  ntfyTopic: "alerts",
  ntfyToken: "tk_ntfy_plain_secret",
};

const noChannels = {
  isActive: true,
  emailEnabled: false,
  ntfyEnabled: false,
  gotifyEnabled: false,
  webhookEnabled: false,
};

async function setup() {
  const owner = await createWorkspaceMember({
    role: "owner",
    workspaceName: "Acme",
  });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
    name: "Apollo",
  });
  const { project: second } = await createProjectFixture({
    workspaceId: owner.workspace.id,
    name: "Gemini",
  });
  const { app } = createApp();
  mockAuthenticatedSession(owner.user);
  return { owner, project, second, app };
}

describe("API integration: notification preferences", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", KEY);
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reports documented defaults for a user without stored preferences", async () => {
    const { owner, app } = await setup();
    const response = await call(app, "GET", "/");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      emailAddress: owner.user.email,
      emailEnabled: false,
      ntfyEnabled: false,
      ntfyConfigured: false,
      ntfyServerUrl: null,
      ntfyTopic: null,
      ntfyTokenConfigured: false,
      maskedNtfyToken: null,
      gotifyEnabled: false,
      gotifyConfigured: false,
      gotifyServerUrl: null,
      gotifyTokenConfigured: false,
      maskedGotifyToken: null,
      webhookEnabled: false,
      webhookConfigured: false,
      webhookUrl: null,
      webhookSecretConfigured: false,
      maskedWebhookSecret: null,
      taskAssignmentEnabled: true,
      taskCommentEnabled: true,
      taskStatusChangeEnabled: true,
      dueDateReminderEnabled: true,
      dueDateReminderLeadTimeMinutes: 1440,
      workspaces: [],
      createdAt: null,
      updatedAt: null,
    });
  });

  it("encrypts secrets at rest, masks them in responses and honours omit / null / blank", async () => {
    const { owner, app } = await setup();
    const response = await call(app, "PUT", "/", {
      ...ntfy,
      gotifyEnabled: true,
      gotifyServerUrl: "https://127.0.0.1/gotify",
      gotifyToken: "short",
      webhookEnabled: true,
      webhookUrl: "https://127.0.0.1/hook",
      webhookSecret: "whsec_long_secret_value",
      emailEnabled: true,
      taskCommentEnabled: false,
      dueDateReminderLeadTimeMinutes: 90,
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body).toMatchObject({
      emailEnabled: true,
      ntfyEnabled: true,
      ntfyConfigured: true,
      ntfyTokenConfigured: true,
      maskedNtfyToken: "tk_n…cret",
      gotifyConfigured: true,
      maskedGotifyToken: "••••",
      webhookConfigured: true,
      webhookSecretConfigured: true,
      maskedWebhookSecret: "whse…alue",
      taskCommentEnabled: false,
      taskAssignmentEnabled: true,
      dueDateReminderLeadTimeMinutes: 90,
    });
    for (const secret of ["tk_ntfy_plain_secret", "whsec_long_secret_value"]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain('"short"');

    const stored = await storedPreference(owner.user.id);
    for (const value of [
      stored?.ntfyToken,
      stored?.gotifyToken,
      stored?.webhookSecret,
    ]) {
      expect(value).toMatch(/^enc:v1:[\w-]+\.[\w-]+\.[\w-]+$/);
    }
    expect(JSON.stringify(stored)).not.toContain("tk_ntfy_plain_secret");
    expect(JSON.stringify(stored)).not.toContain("whsec_long_secret_value");

    // Omitting a secret leaves the ciphertext byte-for-byte unchanged.
    const omitted = await call(app, "PUT", "/", { taskCommentEnabled: true });
    expect(omitted.status).toBe(200);
    const afterOmit = await storedPreference(owner.user.id);
    expect(afterOmit?.ntfyToken).toBe(stored?.ntfyToken);
    expect(afterOmit?.webhookSecret).toBe(stored?.webhookSecret);
    expect(afterOmit?.taskCommentEnabled).toBe(true);
    expect(afterOmit?.dueDateReminderLeadTimeMinutes).toBe(90);

    // A new value is re-encrypted with a fresh IV; null and blank clear it.
    await call(app, "PUT", "/", { ntfyToken: "another-token-value" });
    const rotated = await storedPreference(owner.user.id);
    expect(rotated?.ntfyToken).not.toBe(stored?.ntfyToken);
    expect(rotated?.ntfyToken?.startsWith("enc:v1:")).toBe(true);
    const cleared = await call(app, "PUT", "/", {
      ntfyToken: null,
      webhookSecret: "   ",
    });
    expect(await cleared.json()).toMatchObject({
      ntfyTokenConfigured: false,
      maskedNtfyToken: null,
      webhookSecretConfigured: false,
      maskedWebhookSecret: null,
    });
    const afterClear = await storedPreference(owner.user.id);
    expect(afterClear?.ntfyToken).toBeNull();
    expect(afterClear?.webhookSecret).toBeNull();
    expect(afterClear?.gotifyToken).toBe(stored?.gotifyToken);
  });

  it("refuses to store a secret without an encryption key and stores nothing", async () => {
    const { owner, app } = await setup();
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "  ");
    const response = await call(app, "PUT", "/", ntfy);
    expect(response.status).toBe(500);
    expect(await response.text()).toContain(
      "NOTIFICATION_SECRET_ENCRYPTION_KEY is required",
    );
    expect(await storedPreference(owner.user.id)).toBeUndefined();
  });

  it("fails closed on a tampered, malformed or foreign-key ciphertext", async () => {
    const { owner, app } = await setup();
    await call(app, "PUT", "/", ntfy);
    const stored = await storedPreference(owner.user.id);
    const original = stored?.ntfyToken as string;
    const setToken = (value: string) =>
      db
        .update(schema.userNotificationPreferenceTable)
        .set({ ntfyToken: value })
        .where(
          eq(schema.userNotificationPreferenceTable.userId, owner.user.id),
        );

    // Flipped ciphertext byte: the GCM tag no longer matches.
    const [iv, tag, data] = original.slice("enc:v1:".length).split(".") as [
      string,
      string,
      string,
    ];
    const flipped = `enc:v1:${iv}.${tag}.${(data[0] === "A" ? "B" : "A") + data.slice(1)}`;
    await setToken(flipped);
    let response = await call(app, "GET", "/");
    expect(response.status).toBe(500);
    expect(await response.text()).toContain(
      "Failed to decrypt notification secret",
    );

    await setToken("enc:v1:onlyone");
    response = await call(app, "GET", "/");
    expect(response.status).toBe(500);
    expect(await response.text()).toContain(
      "Invalid encrypted notification secret payload",
    );

    // Valid ciphertext, but the key was rotated.
    await setToken(original);
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "a-different-key");
    response = await call(app, "GET", "/");
    expect(response.status).toBe(500);
    expect(await response.text()).toContain(
      "Failed to decrypt notification secret",
    );

    // Without any key a stored ciphertext cannot be read either.
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "");
    response = await call(app, "GET", "/");
    expect(response.status).toBe(500);
    expect(await response.text()).toContain(
      "NOTIFICATION_SECRET_ENCRYPTION_KEY",
    );

    // Legacy plaintext (no prefix) is still readable and masked.
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", KEY);
    await setToken("legacy-plain-token");
    response = await call(app, "GET", "/");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ntfyTokenConfigured: true,
      maskedNtfyToken: "lega…oken",
    });
  });

  it("keeps a valid ciphertext as is and encrypts anything else, including look-alikes", async () => {
    const { owner, app } = await setup();
    await call(app, "PUT", "/", ntfy);
    const original = (await storedPreference(owner.user.id))
      ?.ntfyToken as string;
    // Submitting a valid ciphertext again is idempotent.
    await call(app, "PUT", "/", { ntfyToken: original });
    expect((await storedPreference(owner.user.id))?.ntfyToken).toBe(original);
    // A look-alike that does not decrypt is treated as plaintext and encrypted.
    await call(app, "PUT", "/", { ntfyToken: "enc:v1:not.a.ciphertext" });
    const stored = (await storedPreference(owner.user.id))?.ntfyToken as string;
    expect(stored).not.toBe("enc:v1:not.a.ciphertext");
    const read = await (await call(app, "GET", "/")).json();
    expect(read.maskedNtfyToken).toBe("enc:…text");
  });

  it("validates each channel and leaves stored state untouched on failure", async () => {
    const { owner, app } = await setup();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ntfyEnabled: true }, "ntfy requires a server URL and topic"],
      [
        { ntfyServerUrl: "https://127.0.0.1/x" },
        "ntfy requires a server URL and topic",
      ],
      [{ ntfyServerUrl: "not a url", ntfyTopic: "t" }, "Invalid URL"],
      [
        { gotifyEnabled: true, gotifyServerUrl: "https://127.0.0.1" },
        "Gotify requires a server URL and app token",
      ],
      [
        { gotifyServerUrl: "ftp://127.0.0.1", gotifyToken: "t" },
        "URL must use http or https",
      ],
      [
        { webhookEnabled: true },
        "Webhook notifications require an endpoint URL",
      ],
      [
        { webhookSecret: "only-secret" },
        "Webhook notifications require an endpoint URL",
      ],
      [{ webhookUrl: "javascript:alert(1)" }, "URL must use http or https"],
    ];
    for (const [body, message] of cases) {
      const response = await call(app, "PUT", "/", body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.text()).toContain(message);
    }
    expect(await storedPreference(owner.user.id)).toBeUndefined();

    // Blocked destinations when private ones are not allowed.
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
    for (const body of [
      { ntfyServerUrl: "http://localhost:8080", ntfyTopic: "t" },
      { gotifyServerUrl: "http://10.0.0.5", gotifyToken: "t" },
      { webhookUrl: "http://169.254.169.254/latest" },
      { webhookUrl: "http://[::1]/hook" },
    ]) {
      const response = await call(app, "PUT", "/", body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.text()).toContain("non-routable");
    }
    expect(await storedPreference(owner.user.id)).toBeUndefined();

    // Out-of-range lead time is a schema error.
    for (const minutes of [4, 43_201, 10.5]) {
      const response = await call(app, "PUT", "/", {
        dueDateReminderLeadTimeMinutes: minutes,
      });
      expect(response.status).toBe(400);
    }
  });

  it("requires an account email to enable email notifications", async () => {
    const { owner } = await setup();
    await expect(
      updateNotificationPreferences(owner.user.id, null, {
        emailEnabled: true,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Email notifications require an account email address",
    });
    expect(await storedPreference(owner.user.id)).toBeUndefined();
  });

  it("upserts, lists and deletes workspace rules within the caller's own memberships", async () => {
    const { owner, project, second, app } = await setup();
    const path = `/workspaces/${owner.workspace.id}`;

    // Channels must be enabled globally first.
    for (const [channel, message] of [
      ["emailEnabled", "Enable email notifications globally"],
      ["ntfyEnabled", "Enable ntfy notifications globally"],
      ["gotifyEnabled", "Enable Gotify notifications globally"],
      ["webhookEnabled", "Enable webhook notifications globally"],
    ] as const) {
      const response = await call(app, "PUT", path, {
        ...noChannels,
        projectMode: "all",
        [channel]: true,
      });
      expect(response.status, channel).toBe(400);
      expect(await response.text()).toContain(message);
    }
    expect(await storedRules(owner.user.id)).toHaveLength(0);

    await call(app, "PUT", "/", {
      ...ntfy,
      emailEnabled: true,
      gotifyEnabled: true,
      gotifyServerUrl: "https://127.0.0.1/g",
      gotifyToken: "gotify-token",
      webhookEnabled: true,
      webhookUrl: "https://127.0.0.1/hook",
    });

    // Selected mode needs at least one valid, accessible project.
    const selected = (ids?: string[]) => ({
      ...noChannels,
      ntfyEnabled: true,
      projectMode: "selected" as const,
      ...(ids ? { selectedProjectIds: ids } : {}),
    });
    for (const ids of [undefined, [], ["ghost-project"]]) {
      const response = await call(app, "PUT", path, selected(ids));
      expect(response.status).toBe(400);
    }
    const foreign = await createWorkspaceMember();
    const { project: foreignProject } = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    const foreignResponse = await call(
      app,
      "PUT",
      path,
      selected([foreignProject.id]),
    );
    expect(foreignResponse.status).toBe(400);
    expect(await foreignResponse.text()).toContain(
      "One or more selected projects are invalid",
    );
    expect(await storedRules(owner.user.id)).toHaveLength(0);

    const created = await call(app, "PUT", path, selected([project.id]));
    expect(created.status).toBe(200);
    let body = await created.json();
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0]).toMatchObject({
      workspaceId: owner.workspace.id,
      workspaceName: "Acme",
      isActive: true,
      ntfyEnabled: true,
      emailEnabled: false,
      projectMode: "selected",
      selectedProjectIds: [project.id],
    });

    // Replace the selection; the old project is gone.
    body = await (await call(app, "PUT", path, selected([second.id]))).json();
    expect(body.workspaces[0].selectedProjectIds).toEqual([second.id]);
    expect(await storedRules(owner.user.id)).toHaveLength(1);

    // Back to "all" clears the stored selection.
    body = await (
      await call(app, "PUT", path, {
        ...noChannels,
        isActive: false,
        webhookEnabled: true,
        projectMode: "all",
        selectedProjectIds: [project.id],
      })
    ).json();
    expect(body.workspaces[0]).toMatchObject({
      isActive: false,
      projectMode: "all",
      selectedProjectIds: [],
      webhookEnabled: true,
    });
    expect(
      await db.select().from(schema.userNotificationWorkspaceProjectTable),
    ).toHaveLength(0);

    // Another user's rule is invisible and untouched by this user's delete.
    const stranger = await addWorkspaceMember(owner.workspace.id, "member");
    await db.insert(schema.userNotificationWorkspaceRuleTable).values({
      userId: stranger.id,
      workspaceId: owner.workspace.id,
      isActive: true,
      projectMode: "all",
    });
    expect((await call(app, "DELETE", path)).status).toBe(200);
    expect(await storedRules(owner.user.id)).toHaveLength(0);
    expect(await storedRules(stranger.id)).toHaveLength(1);
    const afterDelete = await call(app, "DELETE", path);
    expect(afterDelete.status).toBe(404);
    expect(await afterDelete.text()).toContain(
      "Workspace notification rule not found",
    );
  });

  it("refuses rule changes for a workspace the caller does not belong to", async () => {
    const { owner, app } = await setup();
    const foreign = await createWorkspaceMember();
    const path = `/workspaces/${foreign.workspace.id}`;
    const put = await call(app, "PUT", path, {
      ...noChannels,
      projectMode: "all",
    });
    expect(put.status).toBe(403);
    expect(await put.text()).toContain(
      "You don't have access to this workspace",
    );
    expect((await call(app, "DELETE", path)).status).toBe(403);
    expect(await storedRules(owner.user.id)).toHaveLength(0);
    // The foreign user's own rule survives the attempt.
    await db.insert(schema.userNotificationWorkspaceRuleTable).values({
      userId: foreign.user.id,
      workspaceId: foreign.workspace.id,
      isActive: true,
      projectMode: "all",
    });
    await call(app, "DELETE", path);
    expect(await storedRules(foreign.user.id)).toHaveLength(1);
  });

  it("selection only accepts projects the caller can open and never reveals the others", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project: open } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      members: "none",
    });
    const { project: hidden } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      members: "none",
    });
    const member = await addWorkspaceMember(owner.workspace.id, "member");
    await addProjectMember(open.id, member.id, "member");
    const { app } = createApp();
    mockAuthenticatedSession(member);
    const path = `/workspaces/${owner.workspace.id}`;
    const body = (ids: string[]) => ({
      ...noChannels,
      projectMode: "selected",
      selectedProjectIds: ids,
    });

    const refusedHidden = await call(app, "PUT", path, body([hidden.id]));
    const refusedUnknown = await call(
      app,
      "PUT",
      path,
      body(["ghost-project"]),
    );
    expect(refusedHidden.status).toBe(400);
    expect(refusedUnknown.status).toBe(400);
    expect(await refusedHidden.text()).toBe(await refusedUnknown.text());
    expect(
      (await call(app, "PUT", path, body([open.id, hidden.id]))).status,
    ).toBe(400);
    expect(await storedRules(member.id)).toHaveLength(0);

    expect((await call(app, "PUT", path, body([open.id]))).status).toBe(200);
  });

  it("lists only still-accessible selected projects and lets a fully emptied selection be saved", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project: p1 } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      members: "none",
    });
    const { project: p2 } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      members: "none",
    });
    const member = await addWorkspaceMember(owner.workspace.id, "member");
    await addProjectMember(p1.id, member.id, "member");
    await addProjectMember(p2.id, member.id, "member");
    const { app } = createApp();
    mockAuthenticatedSession(member);
    const path = `/workspaces/${owner.workspace.id}`;
    const selected = (ids: string[]) => ({
      ...noChannels,
      projectMode: "selected",
      selectedProjectIds: ids,
    });
    expect(
      (await call(app, "PUT", path, selected([p1.id, p2.id]))).status,
    ).toBe(200);

    const revoke = (projectId: string) =>
      db
        .delete(schema.projectMemberTable)
        .where(
          and(
            eq(schema.projectMemberTable.projectId, projectId),
            eq(schema.projectMemberTable.userId, member.id),
          ),
        );
    await revoke(p1.id);
    let body = await (await call(app, "GET", "/")).json();
    expect(body.workspaces[0].selectedProjectIds).toEqual([p2.id]);
    // The stored selection is unchanged by merely reading.
    expect(
      await db.select().from(schema.userNotificationWorkspaceProjectTable),
    ).toHaveLength(2);
    // One accessible project remains, so an empty selection is refused.
    expect((await call(app, "PUT", path, selected([]))).status).toBe(400);

    await revoke(p2.id);
    body = await (await call(app, "GET", "/")).json();
    expect(body.workspaces[0].selectedProjectIds).toEqual([]);
    const saved = await call(app, "PUT", path, selected([]));
    expect(saved.status).toBe(200);
    expect((await saved.json()).workspaces[0]).toMatchObject({
      projectMode: "selected",
      selectedProjectIds: [],
    });
    // A new rule or a switch to "selected" still needs a project.
    await call(app, "DELETE", path);
    expect((await call(app, "PUT", path, selected([]))).status).toBe(400);
  });

  it("cascades global channel changes to the user's active workspace rules", async () => {
    const { owner, app } = await setup();
    await call(app, "PUT", "/", {
      ...ntfy,
      emailEnabled: true,
      webhookEnabled: true,
      webhookUrl: "https://127.0.0.1/hook",
    });
    const path = `/workspaces/${owner.workspace.id}`;
    await call(app, "PUT", path, {
      ...noChannels,
      emailEnabled: true,
      ntfyEnabled: true,
      projectMode: "all",
    });

    // Turning a channel off globally switches it off in the rules.
    await call(app, "PUT", "/", { ntfyEnabled: false });
    let [rule] = await storedRules(owner.user.id);
    expect(rule).toMatchObject({ ntfyEnabled: false, emailEnabled: true });

    await call(app, "PUT", "/", { ntfyEnabled: true });
    [rule] = await storedRules(owner.user.id);
    // characterization: enabling a channel globally also switches it on in the
    // user's active rules that already use another channel.
    expect(rule).toMatchObject({ ntfyEnabled: true, emailEnabled: true });

    await call(app, "PUT", "/", { emailEnabled: false, webhookEnabled: false });
    [rule] = await storedRules(owner.user.id);
    expect(rule).toMatchObject({
      emailEnabled: false,
      webhookEnabled: false,
      ntfyEnabled: true,
    });

    // An inactive rule is left alone by the cascade.
    await call(app, "PUT", path, {
      ...noChannels,
      isActive: false,
      ntfyEnabled: true,
      projectMode: "all",
    });
    await call(app, "PUT", "/", { ntfyEnabled: false });
    [rule] = await storedRules(owner.user.id);
    expect(rule).toMatchObject({ isActive: false, ntfyEnabled: true });
  });

  it("scopes preferences to the caller", async () => {
    const { owner, app } = await setup();
    await call(app, "PUT", "/", { ...ntfy, taskCommentEnabled: false });
    const other = await createWorkspaceMember();
    mockAuthenticatedSession(other.user);
    const body = await (await call(app, "GET", "/")).json();
    expect(body).toMatchObject({
      emailAddress: other.user.email,
      ntfyConfigured: false,
      taskCommentEnabled: true,
    });
    expect(JSON.stringify(body)).not.toContain("tk_ntfy_plain_secret");
    expect(await storedPreference(owner.user.id)).toBeDefined();
    expect(await storedPreference(other.user.id)).toBeUndefined();
  });
});
