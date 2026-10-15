import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  createExternalLink,
  createOrUpdateExternalLink,
  deleteExternalLink,
  findExternalLinksByTask,
  getExternalLinksByIntegration,
  updateExternalLink,
} from "../../apps/api/src/plugins/github/services/link-manager";
import {
  findAllIntegrationsByRepo,
  findTaskById,
  findTaskByNumber,
  getIntegrationWithProject,
  isTaskInFinalState,
  updateTaskStatus,
} from "../../apps/api/src/plugins/github/services/task-service";
import {
  getGithubApp,
  getInstallationIdForRepo,
  getInstallationOctokit,
  getVerifiedInstallationOctokit,
  resolveGithubPrivateKey,
} from "../../apps/api/src/plugins/github/utils/github-app";
import { extractIssueReferences } from "../../apps/api/src/plugins/github/utils/issue-references";
import {
  addLabelsToIssue,
  ensureLabelsExist,
  removeLabel,
} from "../../apps/api/src/plugins/github/utils/labels";
import { resolveTargetStatus } from "../../apps/api/src/plugins/github/utils/resolve-column";
import {
  removeLabelFromGitHub,
  syncLabelToGitHub,
} from "../../apps/api/src/plugins/github/utils/sync-label-to-github";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  configureGithubApp,
  GITHUB_PRIVATE_KEY_PEM,
  type GithubRoutes,
  INSTALLATION_TOKEN,
  stubGithub,
} from "./support/github-coverage";

configureGithubApp();

beforeEach(async () => {
  await resetTestDatabase();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function seed(
  options: {
    config?: Record<string, unknown> | string;
    type?: string;
    isActive?: boolean;
    resourceType?: string;
    branchLinkFirst?: boolean;
    noLink?: boolean;
  } = {},
) {
  const { user, workspace } = await createWorkspaceMember({ role: "owner" });
  const { project, columns } = await createProjectFixture({
    workspaceId: workspace.id,
  });
  const config =
    typeof options.config === "string"
      ? options.config
      : JSON.stringify({
          repositoryOwner: "example",
          repositoryName: "repo",
          installationId: 10,
          repositoryId: 20,
          verifiedGithubAccountId: "30",
          verifiedByUserId: user.id,
          ...options.config,
        });
  const [integration] = await db
    .insert(schema.integrationTable)
    .values({
      projectId: project.id,
      type: options.type ?? "github",
      config,
      isActive: options.isActive ?? true,
    })
    .returning();
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId: project.id, title: "T", number: 1 })
    .returning();
  if (options.branchLinkFirst) {
    await db.insert(schema.externalLinkTable).values({
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "branch",
      externalId: "feature-1",
      url: "https://github.com/example/repo/tree/feature-1",
    });
  }
  if (!options.noLink) {
    await db.insert(schema.externalLinkTable).values({
      taskId: task.id,
      integrationId: integration.id,
      resourceType: options.resourceType ?? "issue",
      externalId: "5",
      url: "https://github.com/example/repo/issues/5",
    });
  }
  return { user, workspace, project, columns, integration, task };
}

const REPO = "/repos/example/repo";
const base: GithubRoutes = { [`GET ${REPO}`]: { body: { id: 20 } } };

describe("github-app", () => {
  it("resolves the private key from base64, from escaped newlines, or as-is", () => {
    const original = {
      b64: process.env.GITHUB_PRIVATE_KEY_BASE64,
      raw: process.env.GITHUB_PRIVATE_KEY,
    };
    try {
      process.env.GITHUB_PRIVATE_KEY_BASE64 = Buffer.from(
        "-----KEY-----\nline",
      ).toString("base64");
      expect(resolveGithubPrivateKey()).toBe("-----KEY-----\nline");
      process.env.GITHUB_PRIVATE_KEY_BASE64 = "   ";
      process.env.GITHUB_PRIVATE_KEY = "a\\nb";
      expect(resolveGithubPrivateKey()).toBe("a\nb");
      process.env.GITHUB_PRIVATE_KEY = "a\nb\\nc";
      expect(resolveGithubPrivateKey()).toBe("a\nb\\nc");
      delete process.env.GITHUB_PRIVATE_KEY;
      expect(resolveGithubPrivateKey()).toBe("");
    } finally {
      process.env.GITHUB_PRIVATE_KEY_BASE64 = original.b64 ?? "";
      process.env.GITHUB_PRIVATE_KEY = original.raw;
      delete process.env.GITHUB_PRIVATE_KEY_BASE64;
    }
  });

  it("caches one app for regular use and a separate one for bounded imports", () => {
    const regular = getGithubApp();
    const bounded = getGithubApp(true);
    expect(regular !== null && bounded !== null).toBe(true);
    expect(getGithubApp() === regular).toBe(true);
    expect(getGithubApp(true) === bounded).toBe(true);
    expect(bounded === regular).toBe(false);
  });

  it("looks up the installation id of a repository with an app JWT, not an installation token", async () => {
    const calls = stubGithub({
      [`GET ${REPO}/installation`]: { body: { id: 55 } },
    });
    expect(await getInstallationIdForRepo("example", "repo")).toBe(55);
    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toMatch(/^bearer ey/i);
    expect(calls[0].authorization).not.toContain(INSTALLATION_TOKEN);
  });

  it("propagates a missing installation as an error", async () => {
    stubGithub();
    await expect(
      getInstallationIdForRepo("example", "repo"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("authenticates as the installation once a token is minted", async () => {
    const calls = stubGithub({ [`GET ${REPO}`]: { body: { id: 20 } } });
    const octokit = await getInstallationOctokit(10);
    await octokit.rest.repos.get({ owner: "example", repo: "repo" });
    expect(calls[0].authorization).toBe(`token ${INSTALLATION_TOKEN}`);
  });

  it.each([
    ["no installation", { installationId: null }],
    ["no verified user", { verifiedByUserId: "" }],
    ["no repository id", { repositoryId: undefined }],
  ])(
    "refuses an unverified binding (%s) without any request",
    async (_n, patch) => {
      const calls = stubGithub(base);
      await expect(
        getVerifiedInstallationOctokit({
          repositoryOwner: "example",
          repositoryName: "repo",
          installationId: 10,
          repositoryId: 20,
          verifiedGithubAccountId: "30",
          verifiedByUserId: "u",
          ...patch,
        }),
      ).rejects.toThrow("GitHub integration requires verification");
      expect(calls).toEqual([]);
    },
  );

  it("refuses a repository whose id differs from the bound one", async () => {
    stubGithub({ [`GET ${REPO}`]: { body: { id: 21 } } });
    await expect(
      getVerifiedInstallationOctokit({
        repositoryOwner: "example",
        repositoryName: "repo",
        installationId: 10,
        repositoryId: 20,
        verifiedGithubAccountId: "30",
        verifiedByUserId: "u",
      }),
    ).rejects.toThrow("GitHub repository identity changed");
  });
});

describe("label utilities against GitHub", () => {
  async function client() {
    return getInstallationOctokit(10);
  }

  it("creates a missing label with its table color and skips existing ones", async () => {
    const calls = stubGithub({
      [`GET ${REPO}/labels/status:done`]: { body: {} },
      [`GET ${REPO}/labels/custom`]: { status: 404, body: {} },
      [`POST ${REPO}/labels`]: { status: 201, body: {} },
    });
    await ensureLabelsExist(await client(), "example", "repo", [
      "status:done",
      "custom",
    ]);
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual(
      [{ name: "custom", color: "6B7280" }],
    );
  });

  it("logs and continues when a label cannot be created, and still adds the labels", async () => {
    const calls = stubGithub({
      [`POST ${REPO}/labels`]: { status: 422, body: {} },
      [`POST ${REPO}/issues/5/labels`]: { body: [] },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await addLabelsToIssue(await client(), "example", "repo", 5, ["x"]);
    expect(error).toHaveBeenCalledWith(
      'Failed to create label "x":',
      expect.objectContaining({ status: 422 }),
    );
    expect(calls.some((c) => c.path === `${REPO}/issues/5/labels`)).toBe(true);
  });

  it("logs without throwing when adding labels fails", async () => {
    stubGithub({
      [`GET ${REPO}/labels/x`]: { body: {} },
      [`POST ${REPO}/issues/5/labels`]: { status: 403, body: {} },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      addLabelsToIssue(await client(), "example", "repo", 5, ["x"]),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      "Failed to add labels to issue:",
      expect.objectContaining({ status: 403 }),
    );
  });

  it("removeLabel swallows 404 but rethrows other failures", async () => {
    stubGithub({
      [`DELETE ${REPO}/issues/5/labels/gone`]: { status: 404, body: {} },
      [`DELETE ${REPO}/issues/5/labels/denied`]: { status: 403, body: {} },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const octokit = await client();
    await expect(
      removeLabel(octokit, "example", "repo", 5, "gone"),
    ).resolves.toBeUndefined();
    await expect(
      removeLabel(octokit, "example", "repo", 5, "denied"),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("syncLabelToGitHub / removeLabelFromGitHub", () => {
  const routes = (extra: GithubRoutes = {}): GithubRoutes => ({
    ...base,
    [`GET ${REPO}/labels/bug`]: { body: {} },
    [`POST ${REPO}/issues/5/labels`]: { body: [] },
    ...extra,
  });
  const writes = (calls: { method: string; path: string; body: unknown }[]) =>
    calls
      .filter((c) => c.method !== "GET")
      .map((c) => [c.method, c.path, c.body]);

  it("adds an existing GitHub label to the linked issue", async () => {
    const s = await seed();
    const calls = stubGithub(routes());
    await syncLabelToGitHub(s.task.id, "bug", "red");
    expect(writes(calls)).toEqual([
      ["POST", `${REPO}/issues/5/labels`, { labels: ["bug"] }],
    ]);
  });

  it.each([
    ["red", "EF4444"],
    ["#3B82F6", "3b82f6"],
    ["#abc", "aabbcc"],
    ["d73a4a", "d73a4a"],
    ["not-a-color", "6B7280"],
  ])(
    "creates a missing label with GitHub hex color for %s",
    async (input, hex) => {
      const s = await seed();
      const calls = stubGithub(
        routes({
          [`GET ${REPO}/labels/bug`]: { status: 404, body: {} },
          [`POST ${REPO}/labels`]: { status: 201, body: {} },
        }),
      );
      await syncLabelToGitHub(s.task.id, "bug", input);
      expect(writes(calls)).toEqual([
        ["POST", `${REPO}/labels`, { name: "bug", color: hex }],
        ["POST", `${REPO}/issues/5/labels`, { labels: ["bug"] }],
      ]);
    },
  );

  it("does not attach the label when it cannot be created", async () => {
    const s = await seed();
    const calls = stubGithub(
      routes({
        [`GET ${REPO}/labels/bug`]: { status: 404, body: {} },
        [`POST ${REPO}/labels`]: { status: 422, body: {} },
      }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await syncLabelToGitHub(s.task.id, "bug", "red");
    expect(calls.some((c) => c.path === `${REPO}/issues/5/labels`)).toBe(false);
    expect(error.mock.calls[0][0]).toBe(
      'Failed to create label "bug" in GitHub:',
    );
  });

  it("logs a failed attach without throwing and without leaking credentials", async () => {
    const s = await seed();
    stubGithub(
      routes({ [`POST ${REPO}/issues/5/labels`]: { status: 403, body: {} } }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      syncLabelToGitHub(s.task.id, "bug", "red"),
    ).resolves.toBeUndefined();
    expect(error.mock.calls[0][0]).toBe(
      'Failed to add label "bug" to GitHub issue:',
    );
    const logged = JSON.stringify(
      error.mock.calls.map((c) =>
        c.map((p) => (p instanceof Error ? p.message : p)),
      ),
    );
    expect(logged).not.toContain(INSTALLATION_TOKEN);
    expect(logged).not.toContain(GITHUB_PRIVATE_KEY_PEM.slice(40, 120));
  });

  it("removes the label from the linked issue and logs a failure", async () => {
    const s = await seed();
    const calls = stubGithub(
      routes({ [`DELETE ${REPO}/issues/5/labels/bug`]: { body: [] } }),
    );
    await removeLabelFromGitHub(s.task.id, "bug");
    expect(writes(calls)).toEqual([
      ["DELETE", `${REPO}/issues/5/labels/bug`, null],
    ]);

    stubGithub(
      routes({
        [`DELETE ${REPO}/issues/5/labels/bug`]: { status: 403, body: {} },
      }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await removeLabelFromGitHub(s.task.id, "bug");
    expect(error.mock.calls[0][0]).toBe(
      'Failed to remove label "bug" from GitHub issue:',
    );
  });

  it.each([
    ["a task without any link", { noLink: true }],
    ["a task linked only by pull request", { resourceType: "pull_request" }],
    ["an inactive integration", { isActive: false }],
    ["an integration of another type", { type: "gitea" }],
    ["a corrupt config", { config: "{broken" }],
    ["an unverified legacy config", { config: { verifiedByUserId: "" } }],
  ])("makes no GitHub call for %s", async (_name, options) => {
    const s = await seed(options);
    const calls = stubGithub(routes());
    await syncLabelToGitHub(s.task.id, "bug", "red");
    await removeLabelFromGitHub(s.task.id, "bug");
    expect(calls).toEqual([]);
  });

  it("makes no write when the repository identity changed", async () => {
    const s = await seed();
    const calls = stubGithub({ [`GET ${REPO}`]: { body: { id: 99 } } });
    await syncLabelToGitHub(s.task.id, "bug", "red");
    await removeLabelFromGitHub(s.task.id, "bug");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("characterization: a task that has a branch link created before its issue link is not label-synced", async () => {
    // getGitHubContext reads the first external link of the task without
    // filtering by resource type. Open question for the owners: should the
    // issue link be preferred? Today the label is silently not synced.
    const s = await seed({ branchLinkFirst: true });
    const calls = stubGithub(routes());
    await syncLabelToGitHub(s.task.id, "bug", "red");
    expect(calls).toEqual([]);
  });
});

describe("link-manager and task-service helpers", () => {
  it("updateExternalLink ignores an empty update and writes only the given fields", async () => {
    const s = await seed();
    const [link] = await findExternalLinksByTask(s.task.id);
    await updateExternalLink(link.id, {});
    await updateExternalLink(link.id, { title: "New" });
    const stored = await db.query.externalLinkTable.findFirst({
      where: eq(schema.externalLinkTable.id, link.id),
    });
    expect(stored?.title).toBe("New");
    expect(stored?.url).toBe("https://github.com/example/repo/issues/5");
    expect(stored?.metadata).toBeNull();
  });

  it("createOrUpdateExternalLink creates once, then updates the same row", async () => {
    const s = await seed({ noLink: true });
    const params = {
      taskId: s.task.id,
      integrationId: s.integration.id,
      resourceType: "branch" as const,
      externalId: "b",
      url: "https://x/1",
      title: "one",
    };
    const first = await createOrUpdateExternalLink(params);
    const second = await createOrUpdateExternalLink({
      ...params,
      url: "https://x/2",
      metadata: { a: 1 },
    });
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    const rows = await db.query.externalLinkTable.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ url: "https://x/2", title: "one" });
    expect(JSON.parse(rows[0].metadata ?? "")).toEqual({ a: 1 });
  });

  it("lists links by integration and deletes only the named link", async () => {
    const s = await seed({ noLink: true });
    const one = await createExternalLink({
      taskId: s.task.id,
      integrationId: s.integration.id,
      resourceType: "issue",
      externalId: "1",
      url: "u1",
    });
    await createExternalLink({
      taskId: s.task.id,
      integrationId: s.integration.id,
      resourceType: "issue",
      externalId: "2",
      url: "u2",
    });
    const other = await seed({ noLink: true });
    await createExternalLink({
      taskId: other.task.id,
      integrationId: other.integration.id,
      resourceType: "issue",
      externalId: "9",
      url: "u9",
    });
    expect(
      (await getExternalLinksByIntegration(s.integration.id))
        .map((l) => l.externalId)
        .sort(),
    ).toEqual(["1", "2"]);
    await deleteExternalLink(one.id);
    expect(
      (await getExternalLinksByIntegration(s.integration.id)).map(
        (l) => l.externalId,
      ),
    ).toEqual(["2"]);
    expect(
      await getExternalLinksByIntegration(other.integration.id),
    ).toHaveLength(1);
  });

  it("finds tasks by project and number or id, and integrations with their project", async () => {
    const s = await seed();
    const other = await seed();
    expect((await findTaskByNumber(s.project.id, 1))?.id).toBe(s.task.id);
    expect(await findTaskByNumber(s.project.id, 2)).toBeUndefined();
    expect((await findTaskById(other.task.id))?.projectId).toBe(
      other.project.id,
    );
    expect(await findTaskById("missing")).toBeUndefined();
    const integration = await getIntegrationWithProject(s.integration.id);
    expect(integration?.project.id).toBe(s.project.id);
    expect(await getIntegrationWithProject("missing")).toBeUndefined();
  });

  it("updateTaskStatus handles unknown tasks, unknown columns and virtual statuses", async () => {
    const s = await seed();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await updateTaskStatus("missing", "done")).toEqual({
      applied: false,
    });
    expect(await updateTaskStatus(s.task.id, "no-such-column")).toEqual({
      applied: false,
    });
    expect((await findTaskById(s.task.id))?.status).toBe("to-do");
    const planned = await updateTaskStatus(s.task.id, "planned");
    expect(planned.applied).toBe(true);
    const stored = await findTaskById(s.task.id);
    expect(stored?.status).toBe("planned");
    expect(stored?.columnId).toBeNull();
    const done = await updateTaskStatus(s.task.id, "done");
    expect(done.applied && done.after.columnId).toBe(s.columns.done.id);
  });

  it("isTaskInFinalState prefers the column, then the status slug, then the literal done", async () => {
    const s = await seed();
    const other = await seed();
    expect(
      await isTaskInFinalState({
        projectId: s.project.id,
        status: "to-do",
        columnId: s.columns.done.id,
      }),
    ).toBe(true);
    // A column id of another project is not trusted; the status slug decides.
    expect(
      await isTaskInFinalState({
        projectId: s.project.id,
        status: "to-do",
        columnId: other.columns.done.id,
      }),
    ).toBe(false);
    expect(
      await isTaskInFinalState({
        projectId: s.project.id,
        status: "done",
        columnId: null,
      }),
    ).toBe(true);
    await db
      .delete(schema.columnTable)
      .where(eq(schema.columnTable.projectId, s.project.id));
    expect(
      await isTaskInFinalState({
        projectId: s.project.id,
        status: "done",
        columnId: null,
      }),
    ).toBe(true);
    expect(
      await isTaskInFinalState({
        projectId: s.project.id,
        status: "in-progress",
        columnId: null,
      }),
    ).toBe(false);
  });

  it("findAllIntegrationsByRepo needs both ids to be safe integers", async () => {
    const s = await seed();
    const ok = await findAllIntegrationsByRepo({
      installation: { id: 10 },
      repository: { id: 20 },
    });
    expect(ok.map((i) => i.id)).toEqual([s.integration.id]);
    expect(ok[0].project.id).toBe(s.project.id);
    for (const source of [
      { repository: { id: 20 } },
      { installation: { id: 10.5 }, repository: { id: 20 } },
      { installation: { id: 10 }, repository: { id: Number.NaN } },
      { installation: { id: 11 }, repository: { id: 20 } },
      { installation: { id: 10 }, repository: { id: 21 } },
    ]) {
      expect(await findAllIntegrationsByRepo(source)).toEqual([]);
    }
  });
});

describe("resolveTargetStatus", () => {
  it("returns the fallback for a project without columns", async () => {
    const s = await seed();
    await db
      .delete(schema.columnTable)
      .where(eq(schema.columnTable.projectId, s.project.id));
    expect(
      await resolveTargetStatus(s.project.id, "issue_closed", "done"),
    ).toBe("done");
  });

  it("uses a mapped column, else the fallback column, else the first column", async () => {
    const s = await seed();
    expect(
      await resolveTargetStatus(s.project.id, "pr_opened", "in-review"),
    ).toBe("in-review");
    expect(await resolveTargetStatus(s.project.id, "pr_opened", "custom")).toBe(
      "to-do",
    );
    await db.insert(schema.workflowRuleTable).values({
      projectId: s.project.id,
      integrationType: "github",
      eventType: "pr_opened",
      columnId: s.columns.inProgress.id,
    });
    expect(
      await resolveTargetStatus(s.project.id, "pr_opened", "in-review"),
    ).toBe("in-progress");
    // A rule of another event or another integration type does not apply.
    expect(await resolveTargetStatus(s.project.id, "pr_merged", "done")).toBe(
      "done",
    );
  });

  it("ignores a rule pointing at a column of another project", async () => {
    const s = await seed();
    const other = await seed();
    await db.insert(schema.workflowRuleTable).values({
      projectId: s.project.id,
      integrationType: "github",
      eventType: "pr_merged",
      columnId: other.columns.inReview.id,
    });
    expect(await resolveTargetStatus(s.project.id, "pr_merged", "done")).toBe(
      "done",
    );
  });
});

describe("issue reference parsing", () => {
  it("ignores an unparsable URL reference instead of failing the delivery", () => {
    expect(
      extractIssueReferences(
        "https://[",
        null,
        "https://github.com/example/repo",
      ),
    ).toEqual([]);
    expect(
      extractIssueReferences(
        "https://github.com/example/repo/issues/5",
        null,
        "https://github.com/example/repo",
      ),
    ).toEqual(["5"]);
  });
});
