import { and, eq } from "drizzle-orm";
import db from "../../database";
import { notificationTable } from "../../database/schema";

import { resolveUserProjectScope } from "../../utils/project-scope-filters";
import { notificationResourceAccess } from "../resource-access";
import { notificationWorkspaceFilter } from "../workspace-filter";

async function clearNotifications(
  userId: string,
  workspaceId?: string,
  onlyRead = false,
) {
  const scope = workspaceId
    ? await resolveUserProjectScope(userId, workspaceId)
    : undefined;
  await db
    .delete(notificationTable)
    .where(
      and(
        eq(notificationTable.userId, userId),
        onlyRead ? eq(notificationTable.isRead, true) : undefined,
        notificationWorkspaceFilter(workspaceId),
        scope
          ? notificationResourceAccess(
              userId,
              notificationTable.resourceId,
              notificationTable.resourceType,
              scope,
            )
          : undefined,
      ),
    );

  return { success: true };
}

export default clearNotifications;
