import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workspaceUserTable } from "../../database/schema";
import { isOwnerRole } from "../../utils/project-access";
import { closeUserWorkspaceConnections } from "../../ws";
import { lockWorkspace } from "../lock-workspace";
import listWorkspaceMembers from "./list-workspace-members";

async function transferWorkspaceOwnership(request: {
  workspaceId: string;
  userId: string;
}) {
  const { workspaceId, userId } = request;

  const affectedUserIds = await db.transaction(async (tx) => {
    const members = await lockWorkspace(tx, workspaceId);
    const target = members.find((candidate) => candidate.userId === userId);
    if (!target) {
      throw new HTTPException(404, { message: "Member not found" });
    }
    const otherOwners = members
      .filter((candidate) => isOwnerRole(candidate.role))
      .map((owner) => owner.userId)
      .filter((ownerId) => ownerId !== userId);
    if (isOwnerRole(target.role) && otherOwners.length === 0) {
      throw new HTTPException(400, {
        message: "This member is already the workspace owner",
      });
    }

    if (otherOwners.length > 0) {
      await tx
        .update(workspaceUserTable)
        .set({ role: "admin" })
        .where(
          and(
            eq(workspaceUserTable.workspaceId, workspaceId),
            inArray(workspaceUserTable.userId, otherOwners),
          ),
        );
    }
    await tx
      .update(workspaceUserTable)
      .set({ role: "owner" })
      .where(
        and(
          eq(workspaceUserTable.workspaceId, workspaceId),
          eq(workspaceUserTable.userId, userId),
        ),
      );
    return [userId, ...otherOwners];
  });

  // The new owner and the demoted owners change their workspace role, so their
  // open project sockets are closed and reconnect with fresh access.
  await Promise.all(
    affectedUserIds.map((affectedUserId) =>
      closeUserWorkspaceConnections(affectedUserId, workspaceId).catch(
        (error) => {
          console.error("Closing the sockets after a transfer failed:", error);
        },
      ),
    ),
  );
  return listWorkspaceMembers(workspaceId);
}

export default transferWorkspaceOwnership;
