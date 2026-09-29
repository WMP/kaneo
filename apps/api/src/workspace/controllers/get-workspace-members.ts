import { and, eq, inArray } from "drizzle-orm";
import db from "../../database";
import {
  projectMemberTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import {
  accessibleProjectIds,
  createFullAccessChecker,
  projectRoleStatements,
} from "../../utils/project-access";

// Members of a workspace as the CALLER may see them. Full-access callers
// (instance administrator, workspace owner, a role granting
// `workspace:manage_settings`) see everyone. Anyone else sees only themselves,
// the full-access members, and the members who share at least one project with
// them, so the list cannot be used to enumerate people who work on projects the
// caller cannot open.
async function getWorkspaceMembers(workspaceId: string, viewerUserId: string) {
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

  const viewerProjectIds = await accessibleProjectIds(
    viewerUserId,
    workspaceId,
  );
  const withoutInstanceRole = ({
    instanceRole: _instanceRole,
    ...member
  }: (typeof members)[number]) => member;

  if (viewerProjectIds === null) {
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
      .where(
        and(
          inArray(projectMemberTable.projectId, viewerProjectIds),
          inArray(
            projectMemberTable.userId,
            members.map((member) => member.id),
          ),
        ),
      );
    const usable = new Map<string, boolean>();
    for (const row of sharing) {
      let ok = usable.get(row.role);
      if (ok === undefined) {
        ok = (await projectRoleStatements(workspaceId, row.role)) !== null;
        usable.set(row.role, ok);
      }
      if (ok) visibleIds.add(row.userId);
    }
  }

  return members
    .filter((member) => visibleIds.has(member.id))
    .map(withoutInstanceRole);
}

export default getWorkspaceMembers;
