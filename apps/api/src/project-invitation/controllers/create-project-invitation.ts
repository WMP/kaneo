import { and, asc, count, eq, gt, sql } from "drizzle-orm";
import type { Context } from "hono";
import db, { schema } from "../../database";
import type { ProjectAccess } from "../../utils/project-access";
import { assertCloudInvitationAllowed } from "../cloud-gates";
import { newInvitationExpiry, PENDING_INVITATION_LIMIT } from "../constants";
import {
  assertCanManageProjectRole,
  assertInvitableProjectRole,
  assertInvitableWorkspaceRole,
  INVITATION_ERROR_CODES,
  invitationError,
} from "../delegation";
import {
  deliverInvitationEmail,
  EMAIL_NOT_ATTEMPTED,
  type EmailDelivery,
} from "../deliver-email";
import { upsertInvitationProject } from "../invitation-projects";
import { assertMayExtendInvitation, canInviteToWorkspace } from "../origin";
import { lockInvitationEmail } from "../queries";

type Created = {
  id: string;
  email: string;
  workspaceRole: string;
  projectRole: string;
  projectId: string;
  expiresAt: Date;
} & EmailDelivery;

// One project of an invitation and the role it grants there. `access` is the
// CALLER's access to that project: the delegation checks run against it.
export type InvitationProjectGrant = {
  access: ProjectAccess;
  projectRole: string;
};

export type InvitationRow = typeof schema.invitationTable.$inferSelect;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function isWorkspaceMemberEmail(
  workspaceId: string,
  email: string,
): Promise<boolean> {
  const [member] = await db
    .select({ id: schema.workspaceUserTable.id })
    .from(schema.workspaceUserTable)
    .innerJoin(
      schema.userTable,
      eq(schema.workspaceUserTable.userId, schema.userTable.id),
    )
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        sql`lower(${schema.userTable.email}) = ${email}`,
      ),
    )
    .limit(1);
  return Boolean(member);
}

// The shared core of every invitation that grants projects: the project
// invitation route and "Invite" on a resource. It applies the cloud gates, the
// role delegation for the workspace role and for EACH project role, the
// refusal of somebody who already is a workspace member, the per-email advisory
// lock, extending a live invitation of the same workspace role, the pending
// limit, the `project` origin row, the project rows and the email.
//
// The `access` of every grant is the caller's access to a project of
// `workspaceId`. `inTransaction` runs in the same transaction after the rows are
// written, so a caller can store its own link to the invitation and have it
// roll back together with the invitation.
export async function createInvitationForProjects({
  c,
  workspaceId,
  actorUserId,
  email: rawEmail,
  workspaceRole,
  grants,
  inTransaction,
}: {
  c: Context;
  workspaceId: string;
  actorUserId: string;
  email: string;
  workspaceRole: string;
  grants: InvitationProjectGrant[];
  inTransaction?: (
    tx: Transaction,
    invitation: InvitationRow,
    created: boolean,
  ) => Promise<void>;
}): Promise<{
  created: boolean;
  invitation: InvitationRow;
  delivery: EmailDelivery;
  email: string;
}> {
  const [first] = grants;
  if (!first) throw new Error("An invitation needs at least one project");
  if (grants.some((grant) => grant.access.workspaceId !== workspaceId)) {
    throw new Error("A project of another workspace cannot be invited to");
  }
  const email = rawEmail.trim().toLowerCase();

  await assertCloudInvitationAllowed(actorUserId, email);
  await assertInvitableWorkspaceRole(first.access, actorUserId, workspaceRole);
  for (const grant of grants) {
    await assertInvitableProjectRole(grant.access, grant.projectRole);
  }

  if (await isWorkspaceMemberEmail(workspaceId, email)) {
    throw invitationError(
      409,
      INVITATION_ERROR_CODES.alreadyMember,
      "This person is already a member of the workspace; add them to the project instead",
    );
  }

  const mayInviteToWorkspace = await canInviteToWorkspace(c);

  const result = await db.transaction(async (tx) => {
    // Two invitations for one email at once would both pass the checks below.
    await lockInvitationEmail(tx, workspaceId, email);

    // Same selection as Better Auth's `findPendingInvitation`: workspace,
    // lower-cased email, pending and not expired. Locked `FOR UPDATE`, and the
    // conditions are evaluated again once the lock is granted: the trigger of
    // migration 0057 cancels a project-origin invitation by updating its row
    // (a project deleted or moved), so a row canceled while we waited drops out
    // and a new invitation is created below instead.
    const live = await tx
      .select()
      .from(schema.invitationTable)
      .where(
        and(
          eq(schema.invitationTable.workspaceId, workspaceId),
          eq(schema.invitationTable.email, email),
          eq(schema.invitationTable.status, "pending"),
          gt(schema.invitationTable.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(schema.invitationTable.createdAt))
      .for("update");

    if (live.length > 0) {
      const existing = live.find(
        (invitation) => invitation.role === workspaceRole,
      );
      if (!existing) {
        throw invitationError(
          409,
          INVITATION_ERROR_CODES.roleConflict,
          "A pending invitation for this email already exists with a different workspace role",
        );
      }
      // Only an invitation made through these routes may be extended by
      // somebody who cannot make workspace invitations.
      await assertMayExtendInvitation(tx, existing.id, mayInviteToWorkspace);
      for (const { access, projectRole } of grants) {
        const [row] = await tx
          .select({ role: schema.invitationProjectTable.role })
          .from(schema.invitationProjectTable)
          .where(
            and(
              eq(schema.invitationProjectTable.invitationId, existing.id),
              eq(schema.invitationProjectTable.projectId, access.projectId),
            ),
          )
          .limit(1);
        // Re-roling somebody else's grant needs reach over what it holds today.
        if (row && row.role !== projectRole) {
          await assertCanManageProjectRole(access, row.role, tx);
        }
        await upsertInvitationProject(tx, {
          invitationId: existing.id,
          workspaceId,
          projectId: access.projectId,
          role: projectRole,
        });
      }
      await inTransaction?.(tx, existing, false);
      return { created: false, invitation: existing };
    }

    const [pending] = await tx
      .select({ value: count() })
      .from(schema.invitationTable)
      .where(
        and(
          eq(schema.invitationTable.workspaceId, workspaceId),
          eq(schema.invitationTable.status, "pending"),
          gt(schema.invitationTable.expiresAt, new Date()),
        ),
      );
    if ((pending?.value ?? 0) >= PENDING_INVITATION_LIMIT) {
      throw invitationError(
        403,
        INVITATION_ERROR_CODES.limitReached,
        "Invitation limit reached",
      );
    }

    const [invitation] = await tx
      .insert(schema.invitationTable)
      .values({
        workspaceId,
        email,
        role: workspaceRole,
        status: "pending",
        expiresAt: newInvitationExpiry(),
        inviterId: actorUserId,
      })
      .returning();
    if (!invitation) throw new Error("Failed to create the invitation");
    await tx
      .insert(schema.invitationOriginTable)
      .values({ invitationId: invitation.id, source: "project" });
    for (const { access, projectRole } of grants) {
      await upsertInvitationProject(tx, {
        invitationId: invitation.id,
        workspaceId,
        projectId: access.projectId,
        role: projectRole,
      });
    }
    await inTransaction?.(tx, invitation, true);
    return { created: true, invitation };
  });

  // Outside the transaction: a slow or failing relay must not hold locks or
  // roll back an invitation that exists. Adding a project to an invitation
  // that was already mailed does not send a second email; the accept page
  // lists its projects.
  const delivery = result.created
    ? await deliverInvitationEmail({
        invitationId: result.invitation.id,
        email,
        workspaceId,
        inviterUserId: actorUserId,
      })
    : EMAIL_NOT_ATTEMPTED;

  return {
    created: result.created,
    invitation: result.invitation,
    delivery,
    email,
  };
}

async function createProjectInvitation({
  c,
  access,
  actorUserId,
  email,
  workspaceRole,
  projectRole,
}: {
  c: Context;
  access: ProjectAccess;
  actorUserId: string;
  email: string;
  workspaceRole: string;
  projectRole: string;
}): Promise<{ created: boolean; invitation: Created }> {
  const result = await createInvitationForProjects({
    c,
    workspaceId: access.workspaceId,
    actorUserId,
    email,
    workspaceRole,
    grants: [{ access, projectRole }],
  });

  return {
    created: result.created,
    invitation: {
      id: result.invitation.id,
      email: result.email,
      workspaceRole,
      projectRole,
      projectId: access.projectId,
      expiresAt: result.invitation.expiresAt,
      ...result.delivery,
    },
  };
}

export default createProjectInvitation;
