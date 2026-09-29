import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import db from "../../database";
import { resourceTable } from "../../database/schema";
import { createInvitationForProjects } from "../../project-invitation/controllers/create-project-invitation";
import { assertInvitationPermission } from "../../project-invitation/delegation";
import {
  PROJECT_ACCESS_DENIED_MESSAGE,
  resolveProjectAccess,
} from "../../utils/project-access";
import { RESOURCE_ERROR_CODES, resourceError } from "../errors";

// "Invite" on a person resource: one invitation to the chosen projects, sent to
// the resource's email address, and the resource remembers it. Everything that
// decides what the invitation may grant is the project invitation core
// (`createInvitationForProjects`): the workspace role within the inviter's own
// role, each project role within the inviter's effective statements in THAT
// project, `invitation:create` in each project (evaluated on the caller's
// project statements, like the project invitation route), the cloud gates, the
// refusal of an existing workspace member, the per-email lock and the email.
//
// Acceptance links the resource and moves its assignments (see
// `linkInvitedResources`).
async function inviteResource({
  c,
  resourceId,
  workspaceId,
  actorUserId,
  workspaceRole,
  projects,
}: {
  c: Context;
  resourceId: string;
  workspaceId: string;
  actorUserId: string;
  workspaceRole: string;
  projects: { projectId: string; role: string }[];
}) {
  const projectIds = projects.map((project) => project.projectId);
  if (new Set(projectIds).size !== projectIds.length) {
    throw resourceError(
      400,
      RESOURCE_ERROR_CODES.duplicateProject,
      "A project can only be listed once",
    );
  }

  const [resource] = await db
    .select()
    .from(resourceTable)
    .where(
      and(
        eq(resourceTable.id, resourceId),
        eq(resourceTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!resource) {
    throw resourceError(
      404,
      RESOURCE_ERROR_CODES.notFound,
      "Resource not found",
    );
  }
  if (resource.kind !== "person") {
    throw resourceError(
      400,
      RESOURCE_ERROR_CODES.notPerson,
      "Only a person resource can be invited",
    );
  }
  if (resource.userId) {
    throw resourceError(
      409,
      RESOURCE_ERROR_CODES.alreadyLinked,
      "This resource is already linked to a member",
    );
  }
  const email = resource.email?.trim().toLowerCase();
  if (!email) {
    throw resourceError(
      400,
      RESOURCE_ERROR_CODES.noEmail,
      "Add an email address to the resource first",
    );
  }

  // The caller's access to EACH project, and their right to invite there. A
  // project of another workspace answers like a project without access.
  const grants = [];
  for (const { projectId, role } of projects) {
    const access = await resolveProjectAccess(actorUserId, projectId);
    if (!access || access.workspaceId !== workspaceId) {
      throw resourceError(
        403,
        "PROJECT_ACCESS_DENIED",
        PROJECT_ACCESS_DENIED_MESSAGE,
      );
    }
    assertInvitationPermission(c, access, "create");
    grants.push({ access, projectRole: role });
  }

  const result = await createInvitationForProjects({
    c,
    workspaceId,
    actorUserId,
    email,
    workspaceRole,
    grants,
    inTransaction: async (tx, invitation) => {
      // Re-read under a row lock: the resource must still be the one that was
      // checked (not linked meanwhile, same address), or nothing is stored.
      const [current] = await tx
        .select({
          email: resourceTable.email,
          userId: resourceTable.userId,
        })
        .from(resourceTable)
        .where(eq(resourceTable.id, resourceId))
        .for("update");
      if (
        !current ||
        current.userId ||
        current.email?.trim().toLowerCase() !== invitation.email
      ) {
        throw resourceError(
          409,
          RESOURCE_ERROR_CODES.changed,
          "The resource changed, please retry",
        );
      }
      await tx
        .update(resourceTable)
        .set({ invitationId: invitation.id })
        .where(eq(resourceTable.id, resourceId));
    },
  });

  return {
    id: result.invitation.id,
    created: result.created,
    email: result.email,
    workspaceRole,
    projects: projects.map((project) => ({
      projectId: project.projectId,
      role: project.role,
    })),
    expiresAt: result.invitation.expiresAt,
    ...result.delivery,
  };
}

export default inviteResource;
