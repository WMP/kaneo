import { and, eq, inArray } from "drizzle-orm";
import db from "../database";
import { invitationTable, type resourceTable } from "../database/schema";
import { accessibleProjectIds } from "../utils/project-access";
import getWorkspaceMembers from "../workspace/controllers/get-workspace-members";

type ResourceRow = typeof resourceTable.$inferSelect;

export type ResourceInvitationStatus = "pending" | "expired";

export type DescribedResource = Omit<ResourceRow, "invitationId"> & {
  // The linked account, when the caller may see that member (the same list
  // `GET /workspace/{id}/members` answers with). `userId` is set for every
  // linked resource; `user` is null for a caller who cannot see the member.
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  } | null;
  // The invitation sent from the resource, while it can still be accepted
  // (`pending`) or is past its expiry (`expired`). Canceled, rejected and
  // accepted invitations count as none. The invitation id is not exposed.
  invitation: { status: ResourceInvitationStatus; expiresAt: Date } | null;
};

// Adds what the resources UI shows next to a resource: the linked account and
// the state of the invitation sent from it. Never exposes the invitation id or
// members the caller cannot see.
export async function describeResources(
  rows: ResourceRow[],
  viewer: { userId: string; workspaceId: string },
): Promise<DescribedResource[]> {
  const linkedIds = rows.flatMap((row) => (row.userId ? [row.userId] : []));
  const membersById = new Map<
    string,
    { id: string; name: string; email: string; image: string | null }
  >();
  if (linkedIds.length > 0) {
    const scope = await accessibleProjectIds(viewer.userId, viewer.workspaceId);
    const members = await getWorkspaceMembers(
      viewer.workspaceId,
      viewer.userId,
      scope,
    );
    for (const member of members) {
      if (linkedIds.includes(member.id)) {
        membersById.set(member.id, {
          id: member.id,
          name: member.name,
          email: member.email,
          image: member.image,
        });
      }
    }
  }

  const invitationIds = rows.flatMap((row) =>
    row.invitationId && !row.userId ? [row.invitationId] : [],
  );
  const invitationsById = new Map<
    string,
    { status: string; expiresAt: Date }
  >();
  if (invitationIds.length > 0) {
    const invitations = await db
      .select({
        id: invitationTable.id,
        status: invitationTable.status,
        expiresAt: invitationTable.expiresAt,
      })
      .from(invitationTable)
      .where(
        and(
          inArray(invitationTable.id, invitationIds),
          eq(invitationTable.workspaceId, viewer.workspaceId),
        ),
      );
    for (const invitation of invitations) {
      invitationsById.set(invitation.id, invitation);
    }
  }

  const now = Date.now();
  return rows.map(({ invitationId, ...row }) => {
    const invitation = invitationId
      ? invitationsById.get(invitationId)
      : undefined;
    return {
      ...row,
      user: row.userId ? (membersById.get(row.userId) ?? null) : null,
      invitation:
        invitation && invitation.status === "pending" && !row.userId
          ? {
              status:
                invitation.expiresAt.getTime() > now
                  ? ("pending" as const)
                  : ("expired" as const),
              expiresAt: invitation.expiresAt,
            }
          : null,
    };
  });
}
