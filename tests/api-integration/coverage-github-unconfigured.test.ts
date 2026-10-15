import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import listUserRepositories from "../../apps/api/src/github-integration/controllers/list-user-repositories";
import { verifyRepositoryOwner } from "../../apps/api/src/github-integration/controllers/verify-repository-owner";
import { createApp } from "../../apps/api/src/index";
import { validateGitHubConfig } from "../../apps/api/src/plugins/github/config";
import { handleTaskCommentCreated } from "../../apps/api/src/plugins/github/events/task-comment-created";
import { handleTaskCreated } from "../../apps/api/src/plugins/github/events/task-created";
import { handleTaskDescriptionChanged } from "../../apps/api/src/plugins/github/events/task-description-changed";
import { handleTaskPriorityChanged } from "../../apps/api/src/plugins/github/events/task-priority-changed";
import { handleTaskStatusChanged } from "../../apps/api/src/plugins/github/events/task-status-changed";
import { handleTaskTitleChanged } from "../../apps/api/src/plugins/github/events/task-title-changed";
import {
  githubPlugin,
  initializeGitHubPlugin,
} from "../../apps/api/src/plugins/github/index";
import {
  getGithubApp,
  getInstallationIdForRepo,
  getInstallationOctokit,
  getVerifiedInstallationOctokit,
} from "../../apps/api/src/plugins/github/utils/github-app";
import {
  handleGitHubWebhook,
  setupWebhookHandlers,
} from "../../apps/api/src/plugins/github/webhook-handler";
import { handleIssueOpened } from "../../apps/api/src/plugins/github/webhooks/issue-opened";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { sign, stubGithub } from "./support/github-coverage";

// An empty value wins over the root .env that dotenv-mono would otherwise load.
process.env.GITHUB_APP_ID = "";
process.env.GITHUB_WEBHOOK_SECRET = "";
process.env.GITHUB_PRIVATE_KEY = "";
process.env.GITHUB_PRIVATE_KEY_BASE64 = "";

beforeEach(async () => {
  await resetTestDatabase();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const verifiedConfig = {
  repositoryOwner: "example",
  repositoryName: "repo",
  installationId: 10,
  repositoryId: 20,
  verifiedGithubAccountId: "30",
  verifiedByUserId: "user-1",
};
const context = {
  integrationId: "integration-1",
  projectId: "project-1",
  config: verifiedConfig as Record<string, unknown>,
};

describe("GitHub App not configured", () => {
  it("has no app and registers no webhook handlers", () => {
    expect(getGithubApp()).toBeNull();
    expect(getGithubApp(true)).toBeNull();
    expect(() => setupWebhookHandlers()).not.toThrow();
    expect(() => initializeGitHubPlugin()).not.toThrow();
  });

  it("refuses every webhook delivery, whatever the signature", async () => {
    const body = JSON.stringify({ action: "opened" });
    const direct = await handleGitHubWebhook(
      body,
      sign(body, ""),
      "issues",
      "d1",
    );
    expect(direct).toEqual({
      success: false,
      error: "GitHub integration not configured",
    });

    const { app } = createApp();
    const response = await app.request("/api/github-integration/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sign(body, ""),
        "x-github-event": "issues",
      },
      body,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "GitHub integration not configured",
    });
  });

  it("does not create a task from an opened issue even for a bound integration", async () => {
    const calls = stubGithub();
    const { workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await db.insert(schema.integrationTable).values({
      projectId: project.id,
      type: "github",
      config: JSON.stringify(verifiedConfig),
    });
    await handleIssueOpened({
      action: "opened",
      issue: {
        number: 1,
        title: "t",
        body: null,
        html_url: "u",
        user: null,
      },
      installation: { id: 10 },
      repository: {
        id: 20,
        owner: { login: "example" },
        name: "repo",
        full_name: "example/repo",
      },
    });
    expect(await db.query.taskTable.findMany()).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  it("makes no GitHub call from any task event handler", async () => {
    const calls = stubGithub();
    await handleTaskCreated(
      {
        taskId: "t",
        projectId: "p",
        userId: "u",
        title: "x",
        description: null,
        priority: null,
        status: "to-do",
        number: 1,
      },
      context,
    );
    await handleTaskStatusChanged(
      {
        taskId: "t",
        projectId: "p",
        userId: null,
        oldStatus: "to-do",
        newStatus: "done",
        title: "x",
      },
      context,
    );
    await handleTaskPriorityChanged(
      {
        taskId: "t",
        projectId: "p",
        userId: null,
        oldPriority: "low",
        newPriority: "high",
        title: "x",
      },
      context,
    );
    await handleTaskTitleChanged(
      {
        taskId: "t",
        projectId: "p",
        userId: null,
        oldTitle: "a",
        newTitle: "b",
      },
      context,
    );
    await handleTaskDescriptionChanged(
      {
        taskId: "t",
        projectId: "p",
        userId: null,
        oldDescription: "a",
        newDescription: "b",
      },
      context,
    );
    await handleTaskCommentCreated(
      { taskId: "t", projectId: "p", userId: "u", comment: "c" },
      context,
    );
    expect(calls).toEqual([]);
  });

  it("fails closed when an installation client or id is requested", async () => {
    const calls = stubGithub();
    await expect(getInstallationOctokit(10)).rejects.toThrow(
      "GitHub App not configured",
    );
    await expect(getInstallationIdForRepo("example", "repo")).rejects.toThrow(
      "GitHub App not configured",
    );
    await expect(
      getVerifiedInstallationOctokit(verifiedConfig),
    ).rejects.toThrow("GitHub App not configured");
    expect(calls).toEqual([]);
  });
});

describe("repository access without a GitHub App", () => {
  it("answers 503 for listing and verifying repositories once the account is connected, and calls nothing", async () => {
    const calls = stubGithub();
    const { user } = await createWorkspaceMember();
    await db.insert(schema.accountTable).values({
      accountId: "30",
      providerId: "github",
      userId: user.id,
      updatedAt: new Date(),
    });
    await expect(
      listUserRepositories(user.id, { installationPage: 1, repositoryPage: 1 }),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      verifyRepositoryOwner(user.id, "example", "repo"),
    ).rejects.toMatchObject({ status: 503 });
    expect(calls).toEqual([]);
  });

  it("asks for a connected account before anything else", async () => {
    const { user } = await createWorkspaceMember();
    await expect(
      verifyRepositoryOwner(user.id, "example", "repo"),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("GitHub plugin registration and config validation", () => {
  it("registers the GitHub plugin with every task hook", () => {
    expect(githubPlugin).toMatchObject({ type: "github", name: "GitHub" });
    for (const hook of [
      "onTaskCreated",
      "onTaskStatusChanged",
      "onTaskPriorityChanged",
      "onTaskTitleChanged",
      "onTaskDescriptionChanged",
      "onTaskCommentCreated",
      "validateConfig",
    ] as const) {
      expect(typeof githubPlugin[hook]).toBe("function");
    }
  });

  it("validates the stored config shape and reports the invalid fields", async () => {
    expect(await validateGitHubConfig(verifiedConfig)).toEqual({
      valid: true,
    });
    const invalid = await validateGitHubConfig({
      repositoryOwner: "example",
      installationId: "ten",
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toHaveLength(2);
    expect((await validateGitHubConfig(null)).valid).toBe(false);
  });
});
