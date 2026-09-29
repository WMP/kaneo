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
  isInertRole,
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

  // A full-access user's own row (kept for the creator of a project) is not
  // what grants them access, so it is not editable here either. Cheaper than
  // the join below, so it goes first.
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

  if (!existing) {
    throw new HTTPException(404, {
      message: PROJECT_MEMBER_ERRORS.notProjectMember,
    });
  }

  if (userId === actorUserId) {
    throw new HTTPException(403, { message: PROJECT_MEMBER_ERRORS.ownRole });
  }

  // An inert role grants nothing, so replacing it needs no reach over it.
  if (!(await isInertRole(access, existing.role))) {
    await assertCanManageRole(access, existing.role);
  }
  await assertAssignableProjectRole(access, role);

  // Only change the row that was checked, so a concurrent change cannot slip
  // past the delegation checks above.
  const [updated] = await db
    .update(projectMemberTable)
    .set({ role })
    .where(
      and(
        eq(projectMemberTable.projectId, projectId),
        eq(projectMemberTable.userId, userId),
        eq(projectMemberTable.role, existing.role),
      ),
    )
    .returning({ role: projectMemberTable.role });
  if (!updated) {
    throw new HTTPException(409, { message: PROJECT_MEMBER_ERRORS.changed });
  }

  return {
    userId,
    name: existing.name,
    email: existing.email,
    image: existing.image,
    role: updated.role,
    source: "project" as const,
    active: true,
  };
}

export default updateProjectMember;
