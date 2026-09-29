import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectMemberTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import { isFullAccess, type ProjectAccess } from "../../utils/project-access";
import {
  assertAssignableProjectRole,
  PROJECT_MEMBER_ERRORS,
} from "../delegation";

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
    throw new HTTPException(404, {
      message: PROJECT_MEMBER_ERRORS.notWorkspaceMember,
    });
  }

  await assertAssignableProjectRole(access, role);

  if (await isFullAccess(userId, workspaceId)) {
    throw new HTTPException(409, {
      message: PROJECT_MEMBER_ERRORS.alreadyFullAccess,
    });
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
    throw new HTTPException(409, {
      message: PROJECT_MEMBER_ERRORS.alreadyMember,
    });
  }

  return { ...target, role, source: "project" as const, active: true };
}

export default addProjectMember;
