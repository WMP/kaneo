import { and, eq, inArray } from "drizzle-orm";
import db, { schema } from "../../../../apps/api/src/database";

// Limits a workspace member to the given projects: the user's project
// memberships in the workspace become exactly these projects, each with the
// project role `member`. A full-access user (owner, instance administrator, a
// role granting workspace:manage_settings) ignores the rows.
export async function restrictToProjects(
  workspaceId: string,
  userId: string,
  projectIds: string[],
) {
  await db
    .delete(schema.projectMemberTable)
    .where(
      and(
        eq(schema.projectMemberTable.userId, userId),
        inArray(
          schema.projectMemberTable.projectId,
          db
            .select({ id: schema.projectTable.id })
            .from(schema.projectTable)
            .where(eq(schema.projectTable.workspaceId, workspaceId)),
        ),
      ),
    );
  if (projectIds.length === 0) return;
  await db
    .insert(schema.projectMemberTable)
    .values(
      projectIds.map((projectId) => ({ projectId, userId, role: "member" })),
    );
}
