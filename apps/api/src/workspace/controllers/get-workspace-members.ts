import { and, eq, inArray } from "drizzle-orm";
import db from "../../database";
import {
  projectMemberTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import { createFullAccessChecker } from "../../utils/project-access";
import { createUsableProjectRoleChecker } from "../../utils/project-scope-filters";
import { resolveRoleStatements } from "../../utils/role-statements";

const MEMBER_MANAGEMENT_ACTIONS = ["create", "update", "delete"];

// Does the caller's WORKSPACE role manage workspace members? Such a caller
// invites and changes members, so hiding people from them would only get in
// the way.
async function managesWorkspaceMembers(workspaceId: string, userId: string) {
  const [membership] = await db
    .select({ role: workspaceUserTable.role })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  if (!membership) return false;
  const statements = await resolveRoleStatements(workspaceId, membership.role);
  return MEMBER_MANAGEMENT_ACTIONS.some((action) =>
    statements?.member?.includes(action),
  );
}

// Members of a workspace as the CALLER may see them. `viewerProjectIds` is the
// caller's project scope (`accessibleProjectIds`, resolved once by the route):
// `null` is full access, which sees everyone. A caller whose workspace role
// grants `member: create|update|delete` sees everyone too. Anyone else sees
// only themselves, the full-access members and the members who share at least
// one project with them, so the list cannot be used to enumerate people who
// work on projects the caller cannot open.
async function getWorkspaceMembers(
  workspaceId: string,
  viewerUserId: string,
  viewerProjectIds: string[] | null,
) {
  const members = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
      role: workspaceUserTable.role,
      instanceRole: userTable.role,
    })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(workspaceUserTable.userId, userTable.id))
    .where(eq(workspaceUserTable.workspaceId, workspaceId));

  const withoutInstanceRole = ({
    instanceRole: _instanceRole,
    ...member
  }: (typeof members)[number]) => member;

  if (
    viewerProjectIds === null ||
    (await managesWorkspaceMembers(workspaceId, viewerUserId))
  ) {
    return members.map(withoutInstanceRole);
  }

  const visibleIds = new Set<string>([viewerUserId]);

  const isFullAccess = createFullAccessChecker(workspaceId);
  for (const member of members) {
    if (await isFullAccess(member.instanceRole, member.role)) {
      visibleIds.add(member.id);
    }
  }

  if (viewerProjectIds.length > 0) {
    const sharing = await db
      .select({
        userId: projectMemberTable.userId,
        role: projectMemberTable.role,
      })
      .from(projectMemberTable)
      .where(inArray(projectMemberTable.projectId, viewerProjectIds));
    const isUsable = createUsableProjectRoleChecker();
    for (const row of sharing) {
      if (await isUsable(workspaceId, row.role)) visibleIds.add(row.userId);
    }
  }

  // Only workspace members are listed, so a project row left behind by someone
  // who is no longer a member is dropped here.
  return members
    .filter((member) => visibleIds.has(member.id))
    .map(withoutInstanceRole);
}

export default getWorkspaceMembers;
