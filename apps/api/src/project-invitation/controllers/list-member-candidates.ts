import { and, asc, eq, isNull } from "drizzle-orm";
import db, { schema } from "../../database";
import {
  createFullAccessChecker,
  type ProjectAccess,
  singleWorkspaceRole,
} from "../../utils/project-access";
import { groupRows } from "../../utils/project-scope-filters";

// Workspace members who can be added to the project right now: not a member of
// it yet and not full-access (full-access members reach every project through
// their workspace role, and cannot be added at project level).
async function listMemberCandidates(access: ProjectAccess) {
  const rows = await db
    .select({
      id: schema.userTable.id,
      name: schema.userTable.name,
      email: schema.userTable.email,
      image: schema.userTable.image,
      instanceRole: schema.userTable.role,
      workspaceRole: schema.workspaceUserTable.role,
    })
    .from(schema.workspaceUserTable)
    .innerJoin(
      schema.userTable,
      eq(schema.workspaceUserTable.userId, schema.userTable.id),
    )
    .leftJoin(
      schema.projectMemberTable,
      and(
        eq(schema.projectMemberTable.projectId, access.projectId),
        eq(schema.projectMemberTable.userId, schema.userTable.id),
      ),
    )
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, access.workspaceId),
        isNull(schema.projectMemberTable.id),
      ),
    )
    .orderBy(asc(schema.userTable.name), asc(schema.userTable.id));

  // Duplicate workspace membership rows repeat a person: collapse them like
  // the access rules do. Rows that disagree on the role make the membership
  // ambiguous, which counts as no membership at all: not offered.
  const isFullAccess = createFullAccessChecker(access.workspaceId);
  const candidates: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  }[] = [];
  for (const group of groupRows(rows, (row) => row.id).values()) {
    const [row] = group;
    if (!row) continue;
    const workspaceRole = singleWorkspaceRole(
      group.map((entry) => entry.workspaceRole),
    );
    if (!workspaceRole) continue;
    if (await isFullAccess(row.instanceRole, workspaceRole)) continue;
    candidates.push({
      id: row.id,
      name: row.name,
      email: row.email,
      image: row.image,
    });
  }
  return candidates;
}

export default listMemberCandidates;
