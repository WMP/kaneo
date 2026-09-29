import { asc, eq } from "drizzle-orm";
import db from "../../database";
import {
  projectMemberTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import { createFullAccessChecker } from "../../utils/project-access";

// Every workspace member who can reach the project: full-access members
// (listed with their workspace role) and members of this project (listed with
// their project role). A project row of a user who is no longer a workspace
// member is stale and never listed.
async function listProjectMembers(projectId: string, workspaceId: string) {
  const [workspaceMembers, projectRows] = await Promise.all([
    db
      .select({
        userId: userTable.id,
        name: userTable.name,
        email: userTable.email,
        image: userTable.image,
        instanceRole: userTable.role,
        workspaceRole: workspaceUserTable.role,
      })
      .from(workspaceUserTable)
      .innerJoin(userTable, eq(workspaceUserTable.userId, userTable.id))
      .where(eq(workspaceUserTable.workspaceId, workspaceId))
      .orderBy(asc(userTable.name), asc(userTable.id)),
    db
      .select({
        userId: projectMemberTable.userId,
        role: projectMemberTable.role,
      })
      .from(projectMemberTable)
      .where(eq(projectMemberTable.projectId, projectId)),
  ]);

  const projectRoles = new Map(
    projectRows.map((row) => [row.userId, row.role]),
  );
  const hasFullAccess = createFullAccessChecker(workspaceId);

  const members: {
    userId: string;
    name: string;
    email: string;
    image: string | null;
    role: string;
    source: "project" | "full-access";
  }[] = [];

  for (const member of workspaceMembers) {
    const base = {
      userId: member.userId,
      name: member.name,
      email: member.email,
      image: member.image,
    };
    if (await hasFullAccess(member.instanceRole, member.workspaceRole)) {
      members.push({
        ...base,
        role: member.workspaceRole,
        source: "full-access",
      });
      continue;
    }
    const role = projectRoles.get(member.userId);
    if (role) {
      members.push({ ...base, role, source: "project" });
    }
  }

  return members;
}

export default listProjectMembers;
