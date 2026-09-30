import { sendMemberAddedEmail } from "@kaneo/email";
import { isAPIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { auth } from "../auth";
import { syncWorkspaceSeats } from "../billing/controllers/sync-seats";
import db, { schema } from "../database";
import createNotification from "../notification/controllers/create-notification";
import { purgeLeftoversOfEarlierMembership } from "../project-invitation/accept";
import { assertCloudInvitationAllowed } from "../project-invitation/cloud-gates";
import { assertWorkspaceRoleWithinCaller } from "../project-invitation/delegation";
import {
  EMAIL_NOT_ATTEMPTED,
  type EmailDelivery,
} from "../project-invitation/deliver-email";
import { getClientUrl } from "../utils/client-url";
import { codedError } from "../utils/coded-error";
import {
  getMemberAddedEmailCopy,
  getMemberAddedEmailSubject,
} from "../utils/get-member-added-email-copy";
import { isOwnerRole } from "../utils/project-access";
import { splitRoles } from "../utils/role-delegation";
import { resolveRoleStatements } from "../utils/role-statements";
import { closeUserWorkspaceConnections } from "../ws";
import { assertUserDirectoryEnabled } from "./controllers/search-user-directory";

// Adding an existing account to a workspace without an invitation. Used by
// `POST /api/workspace/{id}/members` and by the project member route when the
// person is not in the workspace yet. The routes have already decided that the
// caller holds `member:create` in their WORKSPACE role (and that the API key
// scope allows it); everything that depends on the role and the person is here.

export const DIRECT_ADD_ERROR_CODES = {
  guest: "GUEST_NOT_ALLOWED",
  memberLimit: "WORKSPACE_MEMBER_LIMIT_REACHED",
  ownerRole: "OWNER_ROLE_NOT_ALLOWED",
  unknownRole: "UNKNOWN_ROLE",
  // One answer for an unknown, a guest and a banned account, so the response
  // does not reveal which case applies.
  userNotAddable: "USER_CANNOT_BE_ADDED",
  alreadyMember: "ALREADY_WORKSPACE_MEMBER",
} as const;

// The workspace role being granted: a single catalog role (never `owner`, and
// not a composite name, which resolves as one unknown role) within the caller's
// own workspace-role permissions. A non-owner cannot hand out more than they
// hold; owners and instance administrators are unrestricted except for `owner`.
export async function assertAddableWorkspaceRole(
  workspaceId: string,
  actorUserId: string,
  role: string,
): Promise<void> {
  if (isOwnerRole(role)) {
    throw codedError(
      400,
      DIRECT_ADD_ERROR_CODES.ownerRole,
      "The owner role cannot be granted by adding a member",
    );
  }
  if (
    splitRoles(role).length !== 1 ||
    !(await resolveRoleStatements(workspaceId, role))
  ) {
    throw codedError(
      400,
      DIRECT_ADD_ERROR_CODES.unknownRole,
      "Unknown workspace role",
    );
  }
  await assertWorkspaceRoleWithinCaller({ workspaceId }, actorUserId, role);
}

// A guest (anonymous) account never searches the user directory and never adds
// anybody, on any instance: it is an ephemeral account nobody vouched for.
// Decided on the stored account, not on a session snapshot.
export async function assertActorNotGuest(actorUserId: string): Promise<void> {
  const [actor] = await db
    .select({ isAnonymous: schema.userTable.isAnonymous })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, actorUserId))
    .limit(1);
  if (actor?.isAnonymous) {
    throw codedError(
      403,
      DIRECT_ADD_ERROR_CODES.guest,
      "Guest accounts cannot search accounts or add people",
    );
  }
}

export type AddedPerson = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

// What the routes need of the person: the public fields for the response and
// the locale for the email (not part of any response).
export type AddablePerson = AddedPerson & { locale: string | null };

// An account that may be added: it exists, is a real account (not an anonymous
// guest, and not banned right now), and is not in the workspace yet. On cloud
// the gates of invitations apply too: a guest caller may not add anybody and a
// disposable address is refused.
export async function assertCanAddUser({
  workspaceId,
  actorUserId,
  userId,
  role,
}: {
  workspaceId: string;
  actorUserId: string;
  userId: string;
  role: string;
}): Promise<AddablePerson> {
  await assertActorNotGuest(actorUserId);
  // Adding an account that is not in the workspace yet is what the user
  // directory exists for; where the instance switched it off (or cloud left it
  // off), people are invited instead. Both routes come through here only for
  // somebody who is not a member; adding workspace members to projects does not.
  assertUserDirectoryEnabled();
  await assertAddableWorkspaceRole(workspaceId, actorUserId, role);

  const [person] = await db
    .select({
      id: schema.userTable.id,
      name: schema.userTable.name,
      email: schema.userTable.email,
      image: schema.userTable.image,
      locale: schema.userTable.locale,
      isAnonymous: schema.userTable.isAnonymous,
      banned: schema.userTable.banned,
      banExpires: schema.userTable.banExpires,
    })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  const isBanned =
    person?.banned === true &&
    (!person.banExpires || person.banExpires.getTime() > Date.now());
  if (!person || person.isAnonymous || isBanned) {
    throw codedError(
      404,
      DIRECT_ADD_ERROR_CODES.userNotAddable,
      "This account cannot be added to a workspace",
    );
  }

  const [member] = await db
    .select({ id: schema.workspaceUserTable.id })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  if (member) throw alreadyMemberError();

  await assertCloudInvitationAllowed(actorUserId, person.email);

  return {
    id: person.id,
    name: person.name,
    email: person.email,
    image: person.image,
    locale: person.locale,
  };
}

export function alreadyMemberError() {
  return codedError(
    409,
    DIRECT_ADD_ERROR_CODES.alreadyMember,
    "This person is already a member of the workspace",
  );
}

export type AddedMembership = {
  memberId: string;
  joinedAt: Date;
};

// Creates the membership through Better Auth's server-side `addMember`, so its
// organization hooks run (`afterAddMember` syncs the billed seats). Better Auth
// checks that the account exists, that it is not a member yet (by email) and the
// membership limit, but nothing about the ROLE: the caller has validated it
// with `assertCanAddUser`. Project memberships and resource links an earlier
// membership of the same person left behind are dropped first, exactly like a
// fresh join through an invitation (`beforeAcceptInvitation`), so nothing is
// revived. Those rows belong to somebody who is not a member (they grant
// nothing), so dropping them before the add takes nothing away from anyone.
//
// Known limitation, shared with invitation acceptance: Better Auth's check and
// insert are not one atomic step and nothing makes (workspace, member) unique,
// so two simultaneous adds of one person can create two rows; the access rules
// fail closed on duplicates that disagree on the role.
export async function addUserToWorkspace({
  workspaceId,
  userId,
  role,
}: {
  workspaceId: string;
  userId: string;
  role: string;
}): Promise<AddedMembership> {
  await purgeLeftoversOfEarlierMembership(userId, workspaceId);
  try {
    const created = (await auth.api.addMember({
      // Better Auth types `role` as the roles of the compiled-in access control;
      // Kaneo's roles are dynamic catalog rows.
      body: { userId, role: role as never, organizationId: workspaceId },
    })) as { id: string; createdAt: Date | string } | null;
    if (!created) {
      throw codedError(500, "MEMBER_NOT_ADDED", "The member was not added");
    }
    return { memberId: created.id, joinedAt: new Date(created.createdAt) };
  } catch (error) {
    if (isAPIError(error)) {
      const body = error.body as
        | { code?: string; message?: string }
        | undefined;
      if (body?.code === "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION") {
        throw alreadyMemberError();
      }
      // Better Auth's `membershipLimit` (100 members by default, which
      // accepting an invitation is subject to as well).
      if (body?.code === "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED") {
        throw codedError(
          403,
          DIRECT_ADD_ERROR_CODES.memberLimit,
          "The workspace has reached its member limit",
        );
      }
      throw codedError(
        typeof error.statusCode === "number" ? (error.statusCode as 400) : 400,
        body?.code ?? "MEMBER_NOT_ADDED",
        body?.message ?? "The member could not be added",
      );
    }
    throw error;
  }
}

// Undoes `addUserToWorkspace` when a later step of the same request failed (the
// project membership of a person added through a project): the member row this
// request created goes away again, the seats are synced like after any other
// change of membership. Best effort, a failure is logged.
export async function undoAddUserToWorkspace({
  workspaceId,
  userId,
  memberId,
}: {
  workspaceId: string;
  userId: string;
  memberId: string;
}): Promise<void> {
  try {
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.id, memberId));
    await purgeLeftoversOfEarlierMembership(userId, workspaceId);
    void syncWorkspaceSeats(workspaceId).catch((error) => {
      console.error("Seat sync after undoing a member add failed:", error);
    });
    // Like every other removal: sockets the person opened in the short window
    // close at once instead of at the next revalidation.
    await closeUserWorkspaceConnections(userId, workspaceId).catch((error) => {
      console.error(
        "Closing the sockets after undoing a member add failed:",
        error,
      );
    });
  } catch (error) {
    console.error(
      `Undoing the add of ${userId} to workspace ${workspaceId} failed; the person is a workspace member without the project:`,
      error,
    );
  }
}

// The person learns about it: an in-app notification and, where SMTP is
// configured, an email. Runs after the membership is committed and never fails
// the request; the outcome of the email is reported to the caller. `recipient`
// is the person `assertCanAddUser` already loaded.
export async function notifyMemberAdded({
  workspaceId,
  actorUserId,
  userId,
  recipient,
  role,
}: {
  workspaceId: string;
  actorUserId: string;
  userId: string;
  recipient: { email: string; locale: string | null };
  role: string;
}): Promise<EmailDelivery> {
  let names: { inviterName: string; workspaceName: string } | null = null;
  try {
    const [[actor], [workspace]] = await Promise.all([
      db
        .select({ name: schema.userTable.name })
        .from(schema.userTable)
        .where(eq(schema.userTable.id, actorUserId))
        .limit(1),
      db
        .select({ name: schema.workspaceTable.name })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId))
        .limit(1),
    ]);
    if (actor && workspace) {
      names = { inviterName: actor.name, workspaceName: workspace.name };
    }
  } catch (error) {
    console.error(
      "Reading the data of the member added message failed:",
      error,
    );
  }
  if (!names) return EMAIL_NOT_ATTEMPTED;
  const { inviterName, workspaceName } = names;
  const { email, locale } = recipient;

  try {
    await createNotification({
      userId,
      type: "workspace_member_added",
      eventData: { workspaceId, workspaceName, inviterName, role },
      resourceId: workspaceId,
      resourceType: "workspace",
    });
  } catch (error) {
    console.error("Creating the member added notification failed:", error);
  }

  try {
    const result = await sendMemberAddedEmail(
      email,
      getMemberAddedEmailSubject(locale, { inviterName, workspaceName, role }),
      {
        workspaceName,
        inviterName,
        role,
        workspaceLink: `${getClientUrl().replace(/\/+$/, "")}/dashboard/workspace/${workspaceId}`,
        copy: getMemberAddedEmailCopy(locale),
      },
    );
    if (result?.success === false && result.reason === "SMTP_NOT_CONFIGURED") {
      return EMAIL_NOT_ATTEMPTED;
    }
    return { emailAttempted: true, emailSent: true };
  } catch (error) {
    console.error("Member added email failed:", error);
    return { emailAttempted: true, emailSent: false };
  }
}
