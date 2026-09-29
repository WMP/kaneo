import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectMemberTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import type { ProjectAccess } from "../../utils/project-access";
import {
  assertAssignableProjectRole,
  assertCanManageRole,
  assertNotFullAccess,
  PROJECT_MEMBER_ERRORS,
} from "../delegation";

async function updateProjectMember({
  access,
  actorUserId,
  userId,
  role,
}: {
  access: ProjectAccess;
  actorUserId: string;
  userId: string;
  role: string;
}) {
  const { workspaceId, projectId } = access;

  const [existing] = await db
    .select({
      role: projectMemberTable.role,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
    })
    .from(projectMemberTable)
    .innerJoin(userTable, eq(projectMemberTable.userId, userTable.id))
    // A project row without workspace membership is stale, not a member.
    .innerJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.userId, projectMemberTable.userId),
        eq(workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .where(
      and(
        eq(projectMemberTable.projectId, projectId),
        eq(projectMemberTable.userId, userId),
      ),
    )
    .limit(1);

  // A full-access user's own row (kept for owners and admins) is not what
  // grants them access, so it is not editable here either.
  await assertNotFullAccess(access, userId);

  if (!existing) {
    throw new HTTPException(404, {
      message: PROJECT_MEMBER_ERRORS.notProjectMember,
    });
  }

  if (userId === actorUserId && !access.unrestricted) {
    throw new HTTPException(403, { message: PROJECT_MEMBER_ERRORS.ownRole });
  }

  await assertCanManageRole(access, existing.role);
  await assertAssignableProjectRole(access, role);

  const [updated] = await db
    .update(projectMemberTable)
    .set({ role })
    .where(
      and(
        eq(projectMemberTable.projectId, projectId),
        eq(projectMemberTable.userId, userId),
      ),
    )
    .returning({ role: projectMemberTable.role });
  if (!updated) {
    throw new HTTPException(404, {
      message: PROJECT_MEMBER_ERRORS.notProjectMember,
    });
  }

  return {
    userId,
    name: existing.name,
    email: existing.email,
    image: existing.image,
    role: updated.role,
    source: "project" as const,
  };
}

export default updateProjectMember;
