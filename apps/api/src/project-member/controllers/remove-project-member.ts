import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectMemberTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import type { ProjectAccess } from "../../utils/project-access";
import { hasWorkspacePermission } from "../../utils/require-workspace-permission";
import {
  assertCanManageRole,
  assertNotFullAccess,
  PROJECT_MEMBER_ERRORS,
} from "../delegation";

// Removes a member, or lets a member leave the project. Removing somebody else
// needs `member:delete` in the project and a target role within the caller's
// own statements; leaving needs neither.
async function removeProjectMember({
  c,
  access,
  actorUserId,
  userId,
}: {
  c: Context;
  access: ProjectAccess;
  actorUserId: string;
  userId: string;
}) {
  const { workspaceId, projectId } = access;
  const isSelf = userId === actorUserId;

  if (!isSelf && !(await hasWorkspacePermission(c, { member: ["delete"] }))) {
    throw new HTTPException(403, {
      message: PROJECT_MEMBER_ERRORS.insufficient,
    });
  }

  await assertNotFullAccess(access, userId);

  const [existing] = await db
    .select({
      role: projectMemberTable.role,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
    })
    .from(projectMemberTable)
    .innerJoin(userTable, eq(projectMemberTable.userId, userTable.id))
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
  if (!existing) {
    throw new HTTPException(404, {
      message: PROJECT_MEMBER_ERRORS.notProjectMember,
    });
  }

  if (!isSelf) {
    await assertCanManageRole(access, existing.role);
  }

  await db
    .delete(projectMemberTable)
    .where(
      and(
        eq(projectMemberTable.projectId, projectId),
        eq(projectMemberTable.userId, userId),
      ),
    );

  return {
    userId,
    name: existing.name,
    email: existing.email,
    image: existing.image,
    role: existing.role,
    source: "project" as const,
  };
}

export default removeProjectMember;
