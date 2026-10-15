import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { userTable, workspaceUserTable } from "../../database/schema";
import { unlinkUserResources } from "../../resource/link-resource";
import { removeUserProjectMemberships } from "../../utils/project-access";
import { handleMemberAdded } from "../../workspace-members/handle-member-added";
import { isAssignableWorkspaceRole } from "../is-assignable-workspace-role";
import { lockWorkspace } from "../lock-workspace";
import listWorkspaceMembers from "./list-workspace-members";

async function addWorkspaceMember(request: {
  workspaceId: string;
  userId: string;
  role: string;
}) {
  const { workspaceId, userId, role } = request;

  await db.transaction(async (tx) => {
    const members = await lockWorkspace(tx, workspaceId);
    const [user] = await tx
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    if (!user) {
      throw new HTTPException(404, { message: "User not found" });
    }
    if (members.some((member) => member.userId === userId)) {
      throw new HTTPException(409, {
        message: "This user is already a member of the workspace",
      });
    }
    if (!(await isAssignableWorkspaceRole(tx, workspaceId, role))) {
      throw new HTTPException(400, {
        message:
          "Unknown role. To make someone the owner, add them and then transfer ownership",
      });
    }

    // A fresh join must not revive project memberships an earlier membership
    // left behind (the same rule as an accepted invitation or a direct add).
    await removeUserProjectMemberships(userId, workspaceId, tx);
    await tx
      .insert(workspaceUserTable)
      .values({ workspaceId, userId, role, joinedAt: new Date() });
  });

  await unlinkUserResources(userId, workspaceId).catch((error) => {
    console.error("Unlinking the resources of a new member failed:", error);
  });
  await handleMemberAdded(workspaceId);
  return listWorkspaceMembers(workspaceId);
}

export default addWorkspaceMember;
