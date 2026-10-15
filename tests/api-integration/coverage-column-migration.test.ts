import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { migrateColumns } from "../../apps/api/src/migrations/column-migration";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Startup helper for installations that predate project columns: tasks only
// had a `status` slug. It must create the default columns for a project that
// has none, link tasks by slug, seed Git integration workflow rules, and never
// undo what a project changed (docs/agent-guide/database.md, existing data).
async function legacyProject(name = "Legacy") {
  const member = await createWorkspaceMember();
  const { project } = await createProjectFixture({
    workspaceId: member.workspace.id,
    name,
  });
  // A legacy project has no column rows (tasks keep a NULL column).
  await db
    .delete(schema.columnTable)
    .where(eq(schema.columnTable.projectId, project.id));
  let number = 0;
  async function addTask(status: string, columnId: string | null = null) {
    number += 1;
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        userId: member.user.id,
        title: `${name} ${status} ${number}`,
        status,
        columnId,
        priority: "medium",
        number,
        position: number,
      })
      .returning();
    return task;
  }
  return { member, project, addTask };
}

async function columnsOf(projectId: string) {
  return db
    .select()
    .from(schema.columnTable)
    .where(eq(schema.columnTable.projectId, projectId));
}

async function taskColumn(taskId: string) {
  const [row] = await db
    .select({ columnId: schema.taskTable.columnId })
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, taskId));
  return row.columnId;
}

async function rulesOf(projectId: string) {
  const rules = await db
    .select()
    .from(schema.workflowRuleTable)
    .where(eq(schema.workflowRuleTable.projectId, projectId));
  return rules.map((r) => `${r.integrationType}:${r.eventType}:${r.columnId}`);
}

beforeEach(async () => {
  await resetTestDatabase();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("migrateColumns", () => {
  it("does nothing when there are no projects", async () => {
    await migrateColumns();

    expect(await db.select().from(schema.columnTable)).toEqual([]);
  });

  it("creates the four default columns for a project without columns and links tasks by status", async () => {
    const { project, addTask } = await legacyProject();
    const todo = await addTask("to-do");
    const doing = await addTask("in-progress");
    const done = await addTask("done");
    const custom = await addTask("waiting-for-legal");

    await migrateColumns();

    const columns = await columnsOf(project.id);
    expect(
      columns
        .map((c) => [c.slug, c.name, c.position, c.isFinal])
        .sort((a, b) => Number(a[2]) - Number(b[2])),
    ).toEqual([
      ["to-do", "To Do", 0, false],
      ["in-progress", "In Progress", 1, false],
      ["in-review", "In Review", 2, false],
      ["done", "Done", 3, true],
    ]);
    const idOf = (slug: string) => columns.find((c) => c.slug === slug)?.id;
    expect(await taskColumn(todo.id)).toBe(idOf("to-do"));
    expect(await taskColumn(doing.id)).toBe(idOf("in-progress"));
    expect(await taskColumn(done.id)).toBe(idOf("done"));
    // A status without a column stays unlinked rather than guessing one.
    expect(await taskColumn(custom.id)).toBeNull();

    // Idempotent: a second run creates and changes nothing.
    await migrateColumns();
    expect((await columnsOf(project.id)).map((c) => c.id).sort()).toEqual(
      columns.map((c) => c.id).sort(),
    );
    expect(await taskColumn(todo.id)).toBe(idOf("to-do"));
  });

  it("does not re-create columns that a project removed and relinks only mismatched tasks", async () => {
    const { project, addTask } = await legacyProject();
    const [custom] = await db
      .insert(schema.columnTable)
      .values([
        {
          projectId: project.id,
          name: "Backlog",
          slug: "backlog",
          position: 0,
        },
        { projectId: project.id, name: "Done", slug: "done", position: 1 },
      ])
      .returning();
    const [, doneColumn] = await columnsOf(project.id).then((rows) =>
      rows.sort((a, b) => a.position - b.position),
    );
    const stray = await addTask("done", custom.id);
    const correct = await addTask("done", doneColumn.id);
    const noColumn = await addTask("to-do");

    await migrateColumns();

    const columns = await columnsOf(project.id);
    expect(columns.map((c) => c.slug).sort()).toEqual(["backlog", "done"]);
    expect(await taskColumn(stray.id)).toBe(doneColumn.id);
    expect(await taskColumn(correct.id)).toBe(doneColumn.id);
    expect(await taskColumn(noColumn.id)).toBeNull();
  });

  it("seeds issue and transition workflow rules for active GitHub and Gitea integrations only", async () => {
    const github = await legacyProject("Github");
    await github.addTask("to-do");
    const gitea = await legacyProject("Gitea");
    const skipped = await legacyProject("Skipped");
    await db.insert(schema.integrationTable).values([
      {
        projectId: github.project.id,
        type: "github",
        isActive: true,
        config: JSON.stringify({
          statusTransitions: {
            onBranchPush: "in-progress",
            onPROpen: "in-review",
            onPRMerge: "done",
          },
        }),
      },
      {
        projectId: gitea.project.id,
        type: "gitea",
        isActive: true,
        config: JSON.stringify({ statusTransitions: { onPRMerge: "nowhere" } }),
      },
      {
        projectId: skipped.project.id,
        type: "github",
        isActive: false,
        config: JSON.stringify({ statusTransitions: { onPRMerge: "done" } }),
      },
      {
        projectId: skipped.project.id,
        type: "gitlab",
        isActive: true,
        config: JSON.stringify({ statusTransitions: { onPRMerge: "done" } }),
      },
      {
        projectId: skipped.project.id,
        type: "jira",
        isActive: true,
        config: "{}",
      },
    ]);

    await migrateColumns();

    const idIn = async (projectId: string, slug: string) =>
      (await columnsOf(projectId)).find((c) => c.slug === slug)?.id;
    expect((await rulesOf(github.project.id)).sort()).toEqual(
      [
        `github:branch_push:${await idIn(github.project.id, "in-progress")}`,
        `github:pr_opened:${await idIn(github.project.id, "in-review")}`,
        `github:pr_merged:${await idIn(github.project.id, "done")}`,
        `github:issue_opened:${await idIn(github.project.id, "to-do")}`,
        `github:issue_closed:${await idIn(github.project.id, "done")}`,
      ].sort(),
    );
    // The Gitea transition points to a missing column: only the defaults.
    expect((await rulesOf(gitea.project.id)).sort()).toEqual(
      [
        `gitea:issue_opened:${await idIn(gitea.project.id, "to-do")}`,
        `gitea:issue_closed:${await idIn(gitea.project.id, "done")}`,
      ].sort(),
    );
    expect(await rulesOf(skipped.project.id)).toEqual([]);

    // A second run adds no duplicates.
    await migrateColumns();
    expect(await rulesOf(github.project.id)).toHaveLength(5);
    expect(await rulesOf(gitea.project.id)).toHaveLength(2);
  });

  it("keeps an existing rule instead of overwriting it", async () => {
    const { project } = await legacyProject();
    await db.insert(schema.integrationTable).values({
      projectId: project.id,
      type: "github",
      isActive: true,
      config: JSON.stringify({ statusTransitions: { onPRMerge: "done" } }),
    });
    await migrateColumns();
    const columns = await columnsOf(project.id);
    const todoId = columns.find((c) => c.slug === "to-do")?.id as string;
    const doneId = columns.find((c) => c.slug === "done")?.id as string;
    // The user repointed the merge rule to To Do.
    await db
      .update(schema.workflowRuleTable)
      .set({ columnId: todoId })
      .where(eq(schema.workflowRuleTable.eventType, "pr_merged"));

    await migrateColumns();

    const rules = await rulesOf(project.id);
    expect(rules).toContain(`github:pr_merged:${todoId}`);
    expect(rules).not.toContain(`github:pr_merged:${doneId}`);
    expect(rules.filter((r) => r.includes(":pr_merged:"))).toHaveLength(1);
  });

  it("skips default rules for columns that do not exist and continues after a corrupt integration config", async () => {
    const broken = await legacyProject("Broken");
    const fine = await legacyProject("Fine");
    // Only a custom column: neither to-do nor done exists for the defaults.
    await db.insert(schema.columnTable).values({
      projectId: fine.project.id,
      name: "Review",
      slug: "review",
      position: 0,
    });
    const [brokenIntegration] = await db
      .insert(schema.integrationTable)
      .values({
        projectId: broken.project.id,
        type: "github",
        isActive: true,
        config: "{not json",
      })
      .returning();
    await db.insert(schema.integrationTable).values({
      projectId: fine.project.id,
      type: "gitea",
      isActive: true,
      config: JSON.stringify({ statusTransitions: { onPROpen: "review" } }),
    });

    await migrateColumns();

    expect(await rulesOf(broken.project.id)).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(
      `Failed to migrate workflow rules for integration ${brokenIntegration.id}`,
    );
    const review = (await columnsOf(fine.project.id))[0];
    expect(await rulesOf(fine.project.id)).toEqual([
      `gitea:pr_opened:${review.id}`,
    ]);
  });

  it("treats an integration without statusTransitions as defaults only", async () => {
    const { project } = await legacyProject();
    await db.insert(schema.integrationTable).values({
      projectId: project.id,
      type: "github",
      isActive: true,
      config: "{}",
    });

    await migrateColumns();

    expect(
      (await rulesOf(project.id)).map((r) => r.split(":")[1]).sort(),
    ).toEqual(["issue_closed", "issue_opened"]);
  });
});
