import { and, asc, eq, inArray } from "drizzle-orm";
import db from "../../database";
import {
  projectMemberTable,
  projectTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import {
  createFullAccessChecker,
  singleWorkspaceRole,
  workspaceMemberStanding,
} from "../../utils/project-access";
import {
  createUsableProjectRoleChecker,
  groupRows,
  projectScopeCondition,
} from "../../utils/project-scope-filters";

const MEMBER_MANAGEMENT_ACTIONS = ["create", "update", "delete"];

// Does the caller's WORKSPACE role manage workspace members? Such a caller
// invites and changes members, so hiding people from them would only get in
// the way. `owner` holds everything; ambiguous duplicate membership rows count
// as no membership (`workspaceMemberStanding`).
async function managesWorkspaceMembers(workspaceId: string, userId: string) {
  const standing = await workspaceMemberStanding(userId, workspaceId);
  if (!standing) return false;
  return (
    standing.owner ||
    MEMBER_MANAGEMENT_ACTIONS.some((action) =>
      standing.statements?.member?.includes(action),
    )
  );
}

type ListedMember = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  memberId: string;
  joinedAt: Date;
  instanceRole: string | null;
};

// Adds `fullAccess` and `projects` (id, name and project role of the projects
// the person belongs to, limited to `viewerProjectIds`, `null` being every
// project) to the listed members. A full-access person reaches every project
// through their workspace role and gets no list; a membership whose role grants
// nothing is not a project role any more and is left out.
async function withMemberProjects(
  workspaceId: string,
  members: ListedMember[],
  viewerProjectIds: string[] | null,
) {
  const isFullAccess = createFullAccessChecker(workspaceId);
  const projectsByUser = new Map<
    string,
    { id: string; name: string; role: string }[]
  >();

  if (members.length > 0 && viewerProjectIds?.length !== 0) {
    const rows = await db
      .select({
        userId: projectMemberTable.userId,
        projectId: projectTable.id,
        projectName: projectTable.name,
        role: projectMemberTable.role,
      })
      .from(projectMemberTable)
      .innerJoin(
        projectTable,
        eq(projectMemberTable.projectId, projectTable.id),
      )
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          inArray(
            projectMemberTable.userId,
            members.map((member) => member.id),
          ),
          projectScopeCondition(projectTable.id, viewerProjectIds),
        ),
      )
      .orderBy(asc(projectTable.name), asc(projectTable.id));
    const isUsable = createUsableProjectRoleChecker();
    for (const row of rows) {
      if (!(await isUsable(workspaceId, row.role))) continue;
      const list = projectsByUser.get(row.userId) ?? [];
      list.push({ id: row.projectId, name: row.projectName, role: row.role });
      projectsByUser.set(row.userId, list);
    }
  }

  const result = [];
  for (const { instanceRole, ...member } of members) {
    const fullAccess = await isFullAccess(instanceRole, member.role);
    result.push({
      ...member,
      fullAccess,
      projects: fullAccess ? [] : (projectsByUser.get(member.id) ?? []),
    });
  }
  return result;
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
  // Only these users are looked at (and returned when visible): the caller
  // that needs a few people (the account a resource is linked to) does not
  // read the whole workspace. The visibility rules are the same.
  options: { userIds?: string[]; withProjects?: boolean } = {},
) {
  const { userIds, withProjects } = options;
  if (userIds && userIds.length === 0) return [];
  const memberRows = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
      role: workspaceUserTable.role,
      memberId: workspaceUserTable.id,
      joinedAt: workspaceUserTable.joinedAt,
      instanceRole: userTable.role,
    })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(workspaceUserTable.userId, userTable.id))
    .where(
      userIds
        ? and(
            eq(workspaceUserTable.workspaceId, workspaceId),
            inArray(userTable.id, userIds),
          )
        : eq(workspaceUserTable.workspaceId, workspaceId),
    );

  // One entry per user. Duplicate membership rows follow the rule of
  // `resolveProjectAccess` (`singleWorkspaceRole`): equal rows are one
  // membership, rows that disagree on the role are ambiguous and count as no
  // membership, so that user is not listed.
  const members: Array<(typeof memberRows)[number]> = [];
  for (const group of groupRows(memberRows, (row) => row.id).values()) {
    const [first] = group;
    const role = singleWorkspaceRole(group.map((row) => row.role));
    if (first && role) members.push({ ...first, role });
  }

  const withoutInstanceRole = ({
    instanceRole: _instanceRole,
    ...member
  }: (typeof members)[number]) => member;

  const managesMembers =
    viewerProjectIds === null ||
    (await managesWorkspaceMembers(workspaceId, viewerUserId));

  // Who may see which projects people are in: a caller that manages members
  // (or has full access) and asked for it. The projects are still limited to
  // the ones the caller can open, so the list names no project the caller
  // could not see in the sidebar.
  const present = async (listed: typeof members) =>
    withProjects && managesMembers
      ? withMemberProjects(workspaceId, listed, viewerProjectIds)
      : listed.map(withoutInstanceRole);

  if (managesMembers) {
    return present(members);
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
        userIds
          ? and(
              inArray(projectMemberTable.projectId, viewerProjectIds),
              inArray(projectMemberTable.userId, userIds),
            )
          : inArray(projectMemberTable.projectId, viewerProjectIds),
      );
    const isUsable = createUsableProjectRoleChecker();
    for (const row of sharing) {
      if (await isUsable(workspaceId, row.role)) visibleIds.add(row.userId);
    }
  }

  // Only workspace members are listed, so a project row left behind by someone
  // who is no longer a member is dropped here.
  return present(members.filter((member) => visibleIds.has(member.id)));
}

export default getWorkspaceMembers;
