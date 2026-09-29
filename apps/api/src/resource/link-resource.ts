import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import db from "../database";
import { resourceTable } from "../database/schema";
import {
  accessibleProjectIds,
  workspaceMemberStanding,
} from "../utils/project-access";
import { RESOURCE_ERROR_CODES, resourceError } from "./errors";
import {
  type MovedAssignment,
  moveResourceAssignmentsToUser,
  publishMovedAssignments,
} from "./transfer-assignments";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Links resources to an account, inside the caller's transaction: sets
// `ganttpro_user_id`, clears the pending invitation and moves the assignments
// the account can reach (`moveResourceAssignmentsToUser`). A resource that is
// linked already is left alone, apart from its invitation link.
export async function linkResourcesToUser(
  tx: Transaction,
  {
    workspaceId,
    resourceIds,
    userId,
    projectScope,
  }: {
    workspaceId: string;
    resourceIds: string[];
    userId: string;
    projectScope: string[] | null;
  },
): Promise<MovedAssignment[]> {
  if (resourceIds.length === 0) return [];

  const linked = await tx
    .update(resourceTable)
    .set({ userId, invitationId: null })
    .where(
      and(
        inArray(resourceTable.id, resourceIds),
        eq(resourceTable.workspaceId, workspaceId),
        eq(resourceTable.kind, "person"),
        isNull(resourceTable.userId),
      ),
    )
    .returning({ id: resourceTable.id });
  await tx
    .update(resourceTable)
    .set({ invitationId: null })
    .where(inArray(resourceTable.id, resourceIds));

  return moveResourceAssignmentsToUser(tx, {
    workspaceId,
    resourceIds: linked.map((row) => row.id),
    userId,
    projectScope,
  });
}

// The resources an invitation was sent from ("Invite" on a resource), for the
// acceptance hook. Runs inside the acceptance transaction, after the project
// memberships were written, so a failure rolls both back together and the
// existing revert of the acceptance applies.
export async function linkInvitedResources(
  tx: Transaction,
  {
    invitationId,
    workspaceId,
    userId,
    projectScope,
  }: {
    invitationId: string;
    workspaceId: string;
    userId: string;
    // The projects the accepting person can open now: their new memberships,
    // or `null` for a full-access person (every project of the workspace).
    projectScope: string[] | null;
  },
): Promise<MovedAssignment[]> {
  const resources = await tx
    .select({ id: resourceTable.id })
    .from(resourceTable)
    .where(
      and(
        eq(resourceTable.invitationId, invitationId),
        eq(resourceTable.workspaceId, workspaceId),
      ),
    )
    .for("update");
  return linkResourcesToUser(tx, {
    workspaceId,
    resourceIds: resources.map((row) => row.id),
    userId,
    projectScope,
  });
}

// "Link to member": the same link and the same transfer for somebody who is a
// workspace member already (an invitation cannot be accepted by a member).
export async function linkResourceToMember({
  resourceId,
  workspaceId,
  userId,
  actorUserId,
}: {
  resourceId: string;
  workspaceId: string;
  userId: string;
  actorUserId: string;
}) {
  // A member of this workspace with an unambiguous role (the same reading of
  // "is a member" as the access rule).
  if (!(await workspaceMemberStanding(userId, workspaceId))) {
    throw resourceError(
      400,
      RESOURCE_ERROR_CODES.notMember,
      "The user is not a member of this workspace",
    );
  }
  const projectScope = await accessibleProjectIds(userId, workspaceId);

  const { resource, moves } = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(resourceTable)
      .where(
        and(
          eq(resourceTable.id, resourceId),
          eq(resourceTable.workspaceId, workspaceId),
        ),
      )
      .for("update");
    if (!current) {
      throw resourceError(404, "RESOURCE_NOT_FOUND", "Resource not found");
    }
    if (current.kind !== "person") {
      throw resourceError(
        400,
        RESOURCE_ERROR_CODES.notPerson,
        "Only a person resource can be linked to a member",
      );
    }
    if (current.userId) {
      throw resourceError(
        409,
        RESOURCE_ERROR_CODES.alreadyLinked,
        "This resource is already linked to a member",
      );
    }
    const moves = await linkResourcesToUser(tx, {
      workspaceId,
      resourceIds: [resourceId],
      userId,
      projectScope,
    });
    const [resource] = await tx
      .select()
      .from(resourceTable)
      .where(eq(resourceTable.id, resourceId));
    if (!resource) throw new Error("The linked resource disappeared");
    return { resource, moves };
  });

  await publishMovedAssignments({ moves, userId, actorUserId });
  return { resource, movedTaskCount: moves.length };
}

// Removes the link. Assignments that were moved to the account stay with it
// (they are ordinary user assignments now); the resource keeps whatever it
// still had and gets its own workload row again.
export async function unlinkResource({
  resourceId,
  workspaceId,
}: {
  resourceId: string;
  workspaceId: string;
}) {
  const [updated] = await db
    .update(resourceTable)
    .set({ userId: null })
    .where(
      and(
        eq(resourceTable.id, resourceId),
        eq(resourceTable.workspaceId, workspaceId),
        isNotNull(resourceTable.userId),
      ),
    )
    .returning();
  if (!updated) {
    throw resourceError(
      409,
      RESOURCE_ERROR_CODES.notLinked,
      "This resource is not linked to a member",
    );
  }
  return updated;
}
