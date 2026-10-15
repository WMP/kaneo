import { and, eq } from "drizzle-orm";
import db from "../../database";
import { notificationTable } from "../../database/schema";

import { resolveUserProjectScope } from "../../utils/project-scope-filters";
import { notificationResourceAccess } from "../resource-access";
import { notificationWorkspaceFilter } from "../workspace-filter";

async function markAllNotificationsAsRead(
  userId: string,
  workspaceId?: string,
) {
  const scope = workspaceId
    ? await resolveUserProjectScope(userId, workspaceId)
    : undefined;
  await db
    .update(notificationTable)
    .set({ isRead: true })
    .where(
      and(
        eq(notificationTable.userId, userId),
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

export default markAllNotificationsAsRead;
