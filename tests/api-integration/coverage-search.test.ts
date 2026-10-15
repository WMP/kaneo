import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import globalSearch from "../../apps/api/src/search/controllers/global-search";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

describe("API integration: global search caller resolution", () => {
  it("resolves the caller by email when no user id is given, and finds nothing for an unknown email", async () => {
    const member = await createWorkspaceMember({
      workspaceName: "Zqfindme Workspace",
    });

    const byEmail = await globalSearch({
      query: "zqfindme",
      userEmail: member.user.email,
      type: "workspaces",
    });
    expect(byEmail.results.map((r) => r.id)).toEqual([member.workspace.id]);
    expect(byEmail.totalCount).toBe(1);

    const unknown = await globalSearch({
      query: "zqfindme",
      userEmail: "nobody@example.com",
      type: "workspaces",
    });
    expect(unknown).toEqual({
      results: [],
      totalCount: 0,
      searchQuery: "zqfindme",
    });

    const anonymous = await globalSearch({
      query: "zqfindme",
      type: "workspaces",
    });
    expect(anonymous.results).toEqual([]);
  });

  it("returns nothing for a user in no workspace, even for a project search, and never leaks other workspaces", async () => {
    const owner = await createWorkspaceMember({
      workspaceName: "Zqprivate Workspace",
    });
    await createProjectFixture({
      workspaceId: owner.workspace.id,
      name: "Zqprivate Project",
    });
    const [loner] = await db
      .insert(schema.userTable)
      .values({
        id: "loner-user",
        email: "loner@example.com",
        emailVerified: true,
        name: "Loner",
      })
      .returning();

    const result = await globalSearch({ query: "zqprivate", userId: loner.id });
    expect(result).toEqual({
      results: [],
      totalCount: 0,
      searchQuery: "zqprivate",
    });

    // A user that belongs to another workspace does not see it either.
    const other = await createWorkspaceMember();
    const crossTenant = await globalSearch({
      query: "zqprivate",
      userId: other.user.id,
    });
    expect(crossTenant.results).toEqual([]);

    // Positive control: the owner finds both the workspace and the project.
    const own = await globalSearch({
      query: "zqprivate",
      userId: owner.user.id,
    });
    expect(own.results.map((r) => r.type).sort()).toEqual([
      "project",
      "workspace",
    ]);
  });
});

describe("API integration: global search activity text", () => {
  async function seedActivities() {
    const member = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({ projectId: project.id, title: "Plain title", number: 1 })
      .returning();
    const rows: Array<{
      label: string;
      type: string;
      eventData: unknown;
      content?: string;
    }> = [
      {
        label: "status",
        type: "status_changed",
        eventData: {
          tag: "zqmark",
          oldStatus: "to-do",
          newStatus: "in-progress",
        },
      },
      {
        label: "priority",
        type: "priority_changed",
        eventData: { tag: "zqmark", oldPriority: "low", newPriority: "urgent" },
      },
      {
        label: "approval",
        type: "approval_changed",
        eventData: {
          tag: "zqmark",
          oldApprovalStatus: "none",
          newApprovalStatus: "pending",
        },
      },
      { label: "unassigned", type: "unassigned", eventData: { tag: "zqmark" } },
      {
        label: "self",
        type: "assignee_changed",
        eventData: { tag: "zqmark", isSelfAssigned: true },
      },
      {
        label: "assigned",
        type: "assignee_changed",
        eventData: { tag: "zqmark", newAssignee: "Bob" },
      },
      {
        label: "assigned-unknown",
        type: "assignee_changed",
        eventData: { tag: "zqmark" },
      },
      {
        label: "due-cleared",
        type: "due_date_changed",
        eventData: {
          tag: "zqmark",
          oldDueDate: "2026-01-01",
          newDueDate: null,
        },
      },
      {
        label: "due-set",
        type: "due_date_changed",
        eventData: { tag: "zqmark", newDueDate: "2026-02-02" },
      },
      {
        label: "due-changed",
        type: "due_date_changed",
        eventData: {
          tag: "zqmark",
          oldDueDate: "2026-01-01",
          newDueDate: "2026-02-02",
        },
      },
      {
        label: "title",
        type: "title_changed",
        eventData: { tag: "zqmark", oldTitle: "Old", newTitle: "New" },
      },
      { label: "created", type: "task", eventData: { tag: "zqmark" } },
      {
        label: "unknown-type",
        type: "something_else",
        eventData: { tag: "zqmark" },
      },
      { label: "array", type: "status_changed", eventData: ["zqmark"] },
      {
        label: "explicit-content",
        type: "status_changed",
        eventData: { tag: "zqmark" },
        content: "zqmark explicit text",
      },
    ];
    const inserted = await db
      .insert(schema.activityTable)
      .values(
        rows.map((row) => ({
          taskId: task.id,
          userId: member.user.id,
          type: row.type,
          eventData: row.eventData,
          content: row.content ?? null,
        })),
      )
      .returning({ id: schema.activityTable.id });
    return {
      member,
      byLabel: new Map(
        rows.map((row, i) => [row.label, inserted[i]?.id as string]),
      ),
    };
  }

  it("describes each activity type in words and omits content it cannot describe", async () => {
    const { member, byLabel } = await seedActivities();

    const { results } = await globalSearch({
      query: "zqmark",
      userId: member.user.id,
      type: "activities",
      limit: 50,
    });
    const contentOf = (label: string) =>
      results.find((r) => r.id === byLabel.get(label))?.content;

    expect(results).toHaveLength(15);
    expect(contentOf("status")).toBe(
      "changed status from To Do to In Progress",
    );
    expect(contentOf("priority")).toBe("changed priority from Low to Urgent");
    expect(contentOf("approval")).toBe(
      "changed approval status from None to Pending",
    );
    expect(contentOf("unassigned")).toBe("unassigned the task");
    expect(contentOf("self")).toBe("assigned the task to themselves");
    expect(contentOf("assigned")).toBe("assigned the task to Bob");
    expect(contentOf("assigned-unknown")).toBe("assigned the task to someone");
    expect(contentOf("due-cleared")).toBe("cleared the due date");
    expect(contentOf("due-set")).toBe("set due date to 2026-02-02");
    expect(contentOf("due-changed")).toBe(
      "changed due date from 2026-01-01 to 2026-02-02",
    );
    expect(contentOf("title")).toBe('changed title from "Old" to "New"');
    expect(contentOf("created")).toBe("created the task");
    expect(contentOf("unknown-type")).toBeUndefined();
    expect(contentOf("array")).toBeUndefined();
    expect(contentOf("explicit-content")).toBe("zqmark explicit text");
  });

  it("a user of another workspace does not see these activities", async () => {
    const { member } = await seedActivities();
    const other = await createWorkspaceMember({ role: "owner" });

    const hidden = await globalSearch({
      query: "zqmark",
      userId: other.user.id,
      type: "activities",
      limit: 50,
    });
    expect(hidden.results).toEqual([]);
    const visible = await globalSearch({
      query: "zqmark",
      userId: member.user.id,
      type: "activities",
      limit: 50,
    });
    expect(visible.results.length).toBeGreaterThan(0);
  });
});
