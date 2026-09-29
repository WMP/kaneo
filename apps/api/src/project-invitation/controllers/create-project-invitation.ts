import { and, asc, count, eq, gt, sql } from "drizzle-orm";
import db, { schema } from "../../database";
import type { ProjectAccess } from "../../utils/project-access";
import { assertCloudInvitationAllowed } from "../cloud-gates";
import { newInvitationExpiry, PENDING_INVITATION_LIMIT } from "../constants";
import {
  assertCanManageProjectRole,
  assertInvitableProjectRole,
  assertInvitableWorkspaceRole,
  hasWorkspaceInvitationCreate,
  INVITATION_ERROR_CODES,
  invitationError,
} from "../delegation";
import {
  deliverInvitationEmail,
  EMAIL_NOT_ATTEMPTED,
  type EmailDelivery,
} from "../deliver-email";
import { upsertInvitationProject } from "../invitation-projects";
import { lockInvitationEmail } from "../queries";

type Created = {
  id: string;
  email: string;
  workspaceRole: string;
  projectRole: string;
  projectId: string;
  expiresAt: Date;
} & EmailDelivery;

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

async function createProjectInvitation({
  access,
  actorUserId,
  email: rawEmail,
  workspaceRole,
  projectRole,
}: {
  access: ProjectAccess;
  actorUserId: string;
  email: string;
  workspaceRole: string;
  projectRole: string;
}): Promise<{ created: boolean; invitation: Created }> {
  const { workspaceId, projectId } = access;
  const email = rawEmail.trim().toLowerCase();

  await assertCloudInvitationAllowed(actorUserId, email);
  await assertInvitableWorkspaceRole(access, actorUserId, workspaceRole);
  await assertInvitableProjectRole(access, projectRole);

  if (await isWorkspaceMemberEmail(workspaceId, email)) {
    throw invitationError(
      409,
      INVITATION_ERROR_CODES.alreadyMember,
      "This person is already a member of the workspace; add them to the project instead",
    );
  }

  const result = await db.transaction(async (tx) => {
    // Two invitations for one email at once would both pass the checks below.
    await lockInvitationEmail(tx, workspaceId, email);

    // Same selection as Better Auth's `findPendingInvitation`: workspace,
    // lower-cased email, pending and not expired.
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
      .orderBy(asc(schema.invitationTable.createdAt));

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
      const [row] = await tx
        .select({ role: schema.invitationProjectTable.role })
        .from(schema.invitationProjectTable)
        .where(
          and(
            eq(schema.invitationProjectTable.invitationId, existing.id),
            eq(schema.invitationProjectTable.projectId, projectId),
          ),
        )
        .limit(1);
      // Only an invitation made through these routes may be extended by
      // somebody who cannot make workspace invitations.
      const [origin] = await tx
        .select({ source: schema.invitationOriginTable.source })
        .from(schema.invitationOriginTable)
        .where(eq(schema.invitationOriginTable.invitationId, existing.id))
        .limit(1);
      if (
        origin?.source !== "project" &&
        !(await hasWorkspaceInvitationCreate(access, actorUserId))
      ) {
        throw invitationError(
          409,
          INVITATION_ERROR_CODES.workspaceInvitationExists,
          "A workspace invitation for this email already exists; ask somebody who can invite to the workspace to add this project to it",
        );
      }
      // Re-roling somebody else's grant needs reach over what it holds today.
      if (row && row.role !== projectRole) {
        await assertCanManageProjectRole(access, row.role);
      }
      await upsertInvitationProject(tx, {
        invitationId: existing.id,
        workspaceId,
        projectId,
        role: projectRole,
      });
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
    await upsertInvitationProject(tx, {
      invitationId: invitation.id,
      workspaceId,
      projectId,
      role: projectRole,
    });
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
    invitation: {
      id: result.invitation.id,
      email,
      workspaceRole,
      projectRole,
      projectId,
      expiresAt: result.invitation.expiresAt,
      ...delivery,
    },
  };
}

export default createProjectInvitation;
