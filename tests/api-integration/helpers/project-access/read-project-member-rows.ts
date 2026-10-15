import { and, eq } from "drizzle-orm";
import db, { schema } from "../../../../apps/api/src/database";

// A user's project memberships in the projects of one workspace.
export async function readProjectMemberRows(
  workspaceId: string,
  userId: string,
) {
  return db
    .select({
      projectId: schema.projectMemberTable.projectId,
      role: schema.projectMemberTable.role,
    })
    .from(schema.projectMemberTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectMemberTable.projectId, schema.projectTable.id),
    )
    .where(
      and(
        eq(schema.projectMemberTable.userId, userId),
        eq(schema.projectTable.workspaceId, workspaceId),
      ),
    );
}
