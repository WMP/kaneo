import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";
import { DEFAULT_PROJECT_COLUMNS } from "../../../apps/api/src/project/controllers/create-project";

export type SeededMemberContext = {
  user: typeof schema.userTable.$inferSelect;
  workspace: typeof schema.workspaceTable.$inferSelect;
};

export async function createWorkspaceMember(
  overrides?: Partial<{
    userName: string;
    workspaceName: string;
    role: string;
  }>,
): Promise<SeededMemberContext> {
  const userId = `user-${randomUUID()}`;
  const workspaceId = `workspace-${randomUUID()}`;

  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
      name: overrides?.userName || "Integration Test User",
    })
    .returning();

  const [workspace] = await db
    .insert(schema.workspaceTable)
    .values({
      id: workspaceId,
      createdAt: new Date(),
      name: overrides?.workspaceName || "Integration Test Workspace",
      slug: `workspace-${randomUUID()}`,
    })
    .returning();

  await db.insert(schema.workspaceUserTable).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: overrides?.role ?? "member",
    joinedAt: new Date(),
  });

  return { user, workspace };
}

// A new user who joins an EXISTING workspace with a workspace role. Joining the
// workspace gives no project access: pair it with `addProjectMember`.
export async function addWorkspaceMember(workspaceId: string, role: string) {
  const userId = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
      name: `Member ${role}`,
    })
    .returning();
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId,
    role,
    joinedAt: new Date(),
  });
  return user;
}

// Gives a user access to a project with a project role (a workspace role
// catalog name, never `owner`).
export async function addProjectMember(
  projectId: string,
  userId: string,
  role: string,
) {
  const [row] = await db
    .insert(schema.projectMemberTable)
    .values({ projectId, userId, role })
    .returning();
  return row;
}

// The project role a workspace member gets from `members: "workspace"`: their
// own workspace role, except that `owner` is never a project role.
function projectRoleForWorkspaceRole(role: string) {
  return role
    .split(",")
    .map((part) => part.trim())
    .includes("owner")
    ? "admin"
    : role;
}

// `members` decides who can see the project:
// - "workspace" (default): every CURRENT workspace member becomes a project
//   member with the project role equal to their workspace role. Role-matrix
//   tests then exercise the same permissions as before project membership
//   existed. Members added to the workspace afterwards get no project access:
//   use `addProjectMember`.
// - "none": nobody is a project member. Access tests use this so that access
//   comes only from full-access roles or an explicit `addProjectMember`.
export async function createProjectFixture({
  workspaceId,
  name = "Integration Project",
  icon = "Folder",
  slug = `project-${randomUUID()}`,
  members = "workspace",
}: {
  workspaceId: string;
  name?: string;
  icon?: string;
  slug?: string;
  members?: "workspace" | "none";
}) {
  const [project] = await db
    .insert(schema.projectTable)
    .values({
      workspaceId,
      name,
      icon,
      slug,
    })
    .returning();

  if (members === "workspace") {
    const workspaceMembers = await db
      .select({
        userId: schema.workspaceUserTable.userId,
        role: schema.workspaceUserTable.role,
      })
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
    if (workspaceMembers.length > 0) {
      await db.insert(schema.projectMemberTable).values(
        workspaceMembers.map((member) => ({
          projectId: project.id,
          userId: member.userId,
          role: projectRoleForWorkspaceRole(member.role),
        })),
      );
    }
  }

  const insertedColumns: (typeof schema.columnTable.$inferSelect)[] = [];

  for (const col of DEFAULT_PROJECT_COLUMNS) {
    const [inserted] = await db
      .insert(schema.columnTable)
      .values({
        projectId: project.id,
        name: col.name,
        slug: col.slug,
        position: col.position,
        isFinal: col.isFinal,
      })
      .returning();
    if (inserted) {
      insertedColumns.push(inserted);
    }
  }

  const columnsBySlug = new Map(
    insertedColumns.map((column) => [column.slug, column]),
  );

  const todo = columnsBySlug.get("to-do");
  const inProgress = columnsBySlug.get("in-progress");
  const inReview = columnsBySlug.get("in-review");
  const done = columnsBySlug.get("done");

  if (!todo || !inProgress || !inReview || !done) {
    throw new Error("Failed to seed default project columns");
  }

  return {
    project,
    columns: {
      todo,
      inProgress,
      inReview,
      done,
    },
  };
}
