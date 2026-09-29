import { and, eq } from "drizzle-orm";
import db from "../../database";
import {
  projectMemberTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import { isFullAccess, type ProjectAccess } from "../../utils/project-access";
import { assertAssignableProjectRole, memberError } from "../delegation";

async function addProjectMember({
  access,
  userId,
  role,
}: {
  access: ProjectAccess;
  userId: string;
  role: string;
}) {
  const { workspaceId, projectId } = access;

  const [target] = await db
    .select({
      userId: userTable.id,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
    })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(workspaceUserTable.userId, userTable.id))
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  if (!target) {
    throw memberError(404, "notWorkspaceMember");
  }

  await assertAssignableProjectRole(access, role);

  if (await isFullAccess(userId, workspaceId)) {
    throw memberError(409, "alreadyFullAccess");
  }

  // The unique (project, user) constraint decides a race between two adds.
  const [created] = await db
    .insert(projectMemberTable)
    .values({ projectId, userId, role })
    .onConflictDoNothing({
      target: [projectMemberTable.projectId, projectMemberTable.userId],
    })
    .returning({ id: projectMemberTable.id });
  if (!created) {
    throw memberError(409, "alreadyMember");
  }

  return { ...target, role, source: "project" as const, active: true };
}

export default addProjectMember;
