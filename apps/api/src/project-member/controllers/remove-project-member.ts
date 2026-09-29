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
import { satisfies } from "../../utils/role-statements";
import {
  assertCanManageRole,
  assertNotFullAccess,
  assertProjectMemberPermission,
  isInertRole,
  PROJECT_MEMBER_ERRORS,
} from "../delegation";

// Removes a member, or lets a member leave the project. Removing somebody else
// needs `member:delete` in the project and a target role within the caller's
// own statements (an inert role, which grants nothing, needs no such check);
// leaving needs neither, but an API key still has to allow `member:delete`.
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

  if (isSelf) {
    const apiKey = c.get("apiKey") as
      | { permissions?: Record<string, string[]> | null }
      | undefined;
    if (
      apiKey?.permissions &&
      !satisfies(apiKey.permissions, { member: ["delete"] })
    ) {
      throw new HTTPException(403, {
        message: PROJECT_MEMBER_ERRORS.apiKeyScope,
      });
    }
  } else {
    assertProjectMemberPermission(c, access, "delete");
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

  if (!isSelf && !(await isInertRole(access, existing.role))) {
    await assertCanManageRole(access, existing.role);
  }

  // Only delete the row that was checked: a concurrent role change may have
  // given the member permissions beyond the caller's.
  const deleted = await db
    .delete(projectMemberTable)
    .where(
      and(
        eq(projectMemberTable.projectId, projectId),
        eq(projectMemberTable.userId, userId),
        eq(projectMemberTable.role, existing.role),
      ),
    )
    .returning({ id: projectMemberTable.id });
  if (deleted.length === 0) {
    throw new HTTPException(409, { message: PROJECT_MEMBER_ERRORS.changed });
  }

  return {
    userId,
    name: existing.name,
    email: existing.email,
    image: existing.image,
    role: existing.role,
    source: "project" as const,
    active: !(await isInertRole(access, existing.role)),
  };
}

export default removeProjectMember;
