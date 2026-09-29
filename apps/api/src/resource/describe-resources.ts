import { and, eq, inArray } from "drizzle-orm";
import db from "../database";
import { invitationTable, type resourceTable } from "../database/schema";
import { accessibleProjectIds } from "../utils/project-access";
import getWorkspaceMembers from "../workspace/controllers/get-workspace-members";
import type { ResourceViewer } from "./resource-viewer";

type ResourceRow = typeof resourceTable.$inferSelect;

export type ResourceInvitationStatus = "pending" | "expired";

export type DescribedResource = Omit<ResourceRow, "invitationId"> & {
  // True when the resource is linked to an account, whoever the caller is.
  // `userId` and `user` name the account only for a caller who may see that
  // member (the same list `GET /workspace/{id}/members` answers with); for
  // anybody else both are null and only `linked` tells.
  linked: boolean;
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  } | null;
  // The invitation sent from the resource, while it can still be accepted
  // (`pending`) or is past its expiry (`expired`). Canceled, rejected and
  // accepted invitations count as none. The invitation id is not exposed, and
  // only a caller who may invite (`ResourceViewer.canSeeInvitations`) sees the
  // state at all.
  invitation: { status: ResourceInvitationStatus; expiresAt: Date } | null;
};

// Adds what the resources UI shows next to a resource: the linked account and
// the state of the invitation sent from it. Never exposes the invitation id or
// members the caller cannot see.
export async function describeResources(
  rows: ResourceRow[],
  viewer: Pick<ResourceViewer, "userId" | "canSeeInvitations"> & {
    workspaceId: string;
  },
): Promise<DescribedResource[]> {
  const linkedIds = [
    ...new Set(rows.flatMap((row) => (row.userId ? [row.userId] : []))),
  ];
  // Only the linked accounts are looked at, with the members-list rules.
  const scope =
    linkedIds.length > 0
      ? await accessibleProjectIds(viewer.userId, viewer.workspaceId)
      : null;
  const members = await getWorkspaceMembers(
    viewer.workspaceId,
    viewer.userId,
    scope,
    { userIds: linkedIds },
  );
  const membersById = new Map(
    members.map((member) => [
      member.id,
      {
        id: member.id,
        name: member.name,
        email: member.email,
        image: member.image,
      },
    ]),
  );

  const wantsInvitations = rows.some((row) => row.invitationId && !row.userId);
  const mayShowInvitations =
    wantsInvitations && (await viewer.canSeeInvitations());
  const invitationIds = mayShowInvitations
    ? rows.flatMap((row) =>
        row.invitationId && !row.userId ? [row.invitationId] : [],
      )
    : [];
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
    const user = row.userId ? (membersById.get(row.userId) ?? null) : null;
    return {
      ...row,
      linked: row.userId !== null,
      // Not visible to this caller: no identity, not even the id.
      userId: user ? row.userId : null,
      user,
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
