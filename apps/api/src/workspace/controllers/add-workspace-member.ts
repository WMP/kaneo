import {
  addUserToWorkspace,
  assertCanAddUser,
  notifyMemberAdded,
} from "../direct-add";

// Adds an existing account to the workspace with a workspace role, without an
// invitation. The route has checked `member:create` (workspace role, API key
// scope); the role delegation, the person and the cloud gates are checked by
// `assertCanAddUser` before anything is written. The notification and the email
// come after the membership exists and never fail the add.
async function addWorkspaceMember({
  workspaceId,
  actorUserId,
  userId,
  role,
}: {
  workspaceId: string;
  actorUserId: string;
  userId: string;
  role: string;
}) {
  const { locale, ...person } = await assertCanAddUser({
    workspaceId,
    actorUserId,
    userId,
    role,
  });
  const membership = await addUserToWorkspace({ workspaceId, userId, role });
  const delivery = await notifyMemberAdded({
    workspaceId,
    actorUserId,
    userId,
    recipient: { email: person.email, locale },
    role,
  });
  return { ...person, role, ...membership, ...delivery };
}

export default addWorkspaceMember;
