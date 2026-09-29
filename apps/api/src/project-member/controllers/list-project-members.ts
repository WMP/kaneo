import { and, eq, inArray, or } from "drizzle-orm";
import db from "../../database";
import {
  projectMemberTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import { roleHasOwnerPart } from "../../utils/owner-role";
import {
  fullAccessRoleNames,
  unusableProjectRoles,
} from "../../utils/project-access";

type ListedMember = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  source: "project" | "full-access";
  active: boolean;
};

// Everybody who can reach the project: members of this project (with their
// project role) and full-access members (with their workspace role). Only these
// two groups are read, not the whole workspace. A project row of a user who is
// no longer a workspace member is stale and never listed; a project row whose
// role grants nothing is listed with `active: false` so it can be cleaned up.
async function listProjectMembers(projectId: string, workspaceId: string) {
  const projectRowsQuery = db
    .select({
      userId: userTable.id,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
      role: projectMemberTable.role,
    })
    .from(projectMemberTable)
    .innerJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.userId, projectMemberTable.userId),
        eq(workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .innerJoin(userTable, eq(projectMemberTable.userId, userTable.id))
    .where(eq(projectMemberTable.projectId, projectId));

  // The full-access query needs the role names, so those are read first; the
  // project rows do not depend on them.
  const [fullRoles, projectRows] = await Promise.all([
    fullAccessRoleNames(workspaceId),
    projectRowsQuery,
  ]);

  const [fullAccessRows, unusableRoles] = await Promise.all([
    db
      .select({
        userId: userTable.id,
        name: userTable.name,
        email: userTable.email,
        image: userTable.image,
        role: workspaceUserTable.role,
      })
      .from(workspaceUserTable)
      .innerJoin(userTable, eq(workspaceUserTable.userId, userTable.id))
      .where(
        and(
          eq(workspaceUserTable.workspaceId, workspaceId),
          or(
            eq(userTable.role, "admin"),
            inArray(workspaceUserTable.role, fullRoles),
            roleHasOwnerPart(workspaceUserTable.role),
          ),
        ),
      ),
    unusableProjectRoles(db, workspaceId, [
      ...new Set(projectRows.map((row) => row.role)),
    ]),
  ]);

  // Duplicate workspace membership rows repeat a user in both result sets:
  // list each person once.
  const members: ListedMember[] = [];
  const listed = new Set<string>();
  for (const row of fullAccessRows) {
    if (listed.has(row.userId)) continue;
    listed.add(row.userId);
    members.push({ ...row, source: "full-access", active: true });
  }
  const inert = new Set(unusableRoles);
  for (const row of projectRows) {
    if (listed.has(row.userId)) continue;
    listed.add(row.userId);
    members.push({ ...row, source: "project", active: !inert.has(row.role) });
  }

  return members.sort(
    (a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId),
  );
}

export default listProjectMembers;
