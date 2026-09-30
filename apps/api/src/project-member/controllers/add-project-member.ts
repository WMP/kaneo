import { and, eq } from "drizzle-orm";
import db from "../../database";
import {
  projectMemberTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import { isFullAccess, type ProjectAccess } from "../../utils/project-access";
import {
  addUserToWorkspace,
  alreadyMemberError,
  assertCanAddUser,
  notifyMemberAdded,
  undoAddUserToWorkspace,
} from "../../workspace/direct-add";
import { assertAssignableProjectRole, memberError } from "../delegation";

const NO_WORKSPACE_ADD = {
  workspaceMemberAdded: false,
  emailAttempted: false,
  emailSent: false,
} as const;

// Gives a person access to the project with a project role.
//
// - A member of the project's workspace is added as before.
// - Somebody who is NOT a workspace member yet can be added in one step when
//   the request carries `workspaceRole` and the caller may add workspace members
//   (`workspaceMayAdd`: `member:create` in their WORKSPACE role; the route has
//   already checked the project-level `member:create` and the API key scope).
//   The person joins the workspace first (`addUserToWorkspace`, the same steps
//   as `POST /workspace/{id}/members`: role delegation, cloud gates, Better
//   Auth hooks, leftovers purged) and then the project. The two writes are not
//   one database transaction (Better Auth owns the first), so a failing project
//   insert undoes the workspace add. A workspace role that grants full access
//   (owner-like: `workspace:manage_settings`) reaches every project already, so
//   no project row is stored, as for the member API's other paths.
async function addProjectMember({
  access,
  actorUserId,
  userId,
  role,
  workspaceRole,
  workspaceMayAdd,
}: {
  access: ProjectAccess;
  actorUserId: string;
  userId: string;
  role: string;
  workspaceRole?: string;
  workspaceMayAdd: boolean;
}) {
  const { workspaceId, projectId } = access;

  const [target] = await db
    .select({
      userId: userTable.id,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
      workspaceRole: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(workspaceUserTable.userId, userTable.id))
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);

  if (!target) {
    if (!workspaceRole) {
      throw memberError(404, "notWorkspaceMember");
    }
    return addNewWorkspaceMember({
      access,
      actorUserId,
      userId,
      role,
      workspaceRole,
      workspaceMayAdd,
    });
  }
  // A workspace role was offered for somebody who already has one: refuse
  // instead of silently ignoring a role the caller may think was applied.
  if (workspaceRole) throw alreadyMemberError();

  await assertAssignableProjectRole(access, role);

  if (await isFullAccess(userId, workspaceId)) {
    throw memberError(409, "alreadyFullAccess");
  }

  // The unique (project, user) constraint decides a race between two adds.
  const [created] = await db
    .insert(projectMemberTable)
    .values({ projectId, userId, role })
    .onConflictDoNothing({
      target: [projectMemberTable.projectId, projectMemberTable.userId],
    })
    .returning({
      id: projectMemberTable.id,
      createdAt: projectMemberTable.createdAt,
    });
  if (!created) {
    throw memberError(409, "alreadyMember");
  }

  return {
    ...target,
    role,
    joinedAt: created.createdAt,
    source: "project" as const,
    active: true,
    ...NO_WORKSPACE_ADD,
  };
}

async function addNewWorkspaceMember({
  access,
  actorUserId,
  userId,
  role,
  workspaceRole,
  workspaceMayAdd,
}: {
  access: ProjectAccess;
  actorUserId: string;
  userId: string;
  role: string;
  workspaceRole: string;
  workspaceMayAdd: boolean;
}) {
  const { workspaceId, projectId } = access;

  await assertAssignableProjectRole(access, role);
  if (!workspaceMayAdd) throw memberError(403, "insufficient");
  const { locale, ...person } = await assertCanAddUser({
    workspaceId,
    actorUserId,
    userId,
    role: workspaceRole,
  });

  const membership = await addUserToWorkspace({
    workspaceId,
    userId,
    role: workspaceRole,
  });

  let joinedAt: Date | null = null;
  let source: "project" | "full-access" = "project";
  try {
    if (await isFullAccess(userId, workspaceId)) {
      // Reaches every project through the workspace role: nothing to store.
      source = "full-access";
    } else {
      const [created] = await db
        .insert(projectMemberTable)
        .values({ projectId, userId, role })
        .onConflictDoNothing({
          target: [projectMemberTable.projectId, projectMemberTable.userId],
        })
        .returning({ createdAt: projectMemberTable.createdAt });
      if (!created) throw memberError(409, "alreadyMember");
      joinedAt = created.createdAt;
    }
  } catch (error) {
    await undoAddUserToWorkspace({
      workspaceId,
      userId,
      memberId: membership.memberId,
    });
    throw error;
  }

  const delivery = await notifyMemberAdded({
    workspaceId,
    actorUserId,
    userId,
    recipient: { email: person.email, locale },
    role: workspaceRole,
  });

  return {
    userId: person.id,
    name: person.name,
    email: person.email,
    image: person.image,
    role: source === "full-access" ? workspaceRole : role,
    workspaceRole,
    joinedAt,
    source,
    active: true,
    workspaceMemberAdded: true,
    ...delivery,
  };
}

export default addProjectMember;
