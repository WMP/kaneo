import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import db from "../../database";
import {
  projectMemberTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import type { ProjectAccess } from "../../utils/project-access";
import { apiKeyAllows } from "../../utils/require-workspace-permission";
import { closeUserProjectConnections } from "../../ws";
import {
  assertCanManageRole,
  assertNotFullAccess,
  assertProjectMemberPermission,
  isInertRole,
  memberError,
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
    if (!apiKeyAllows(c, { member: ["delete"] })) {
      throw memberError(403, "apiKeyScope");
    }
  } else {
    assertProjectMemberPermission(c, access, "delete");
  }

  await assertNotFullAccess(access, userId);

  const [existing] = await db
    .select({
      role: projectMemberTable.role,
      workspaceRole: workspaceUserTable.role,
      joinedAt: projectMemberTable.createdAt,
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
    throw memberError(404, "notProjectMember");
  }

  // An inert role grants nothing, so removing it needs no reach over it.
  const inert = await isInertRole(access, existing.role);
  if (!isSelf && !inert) {
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
    throw memberError(409, "changed");
  }

  // Their project sockets end now, on every instance, instead of at the next
  // delivery after the revalidation window.
  await closeUserProjectConnections(userId, projectId);

  return {
    userId,
    name: existing.name,
    email: existing.email,
    image: existing.image,
    role: existing.role,
    workspaceRole: existing.workspaceRole,
    joinedAt: existing.joinedAt,
    source: "project" as const,
    active: !inert,
  };
}

export default removeProjectMember;
