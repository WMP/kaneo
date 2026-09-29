import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { notificationTable } from "../../database/schema";

import { resolveUserProjectScope } from "../../utils/project-scope-filters";
import { notificationResourceAccess } from "../resource-access";

async function markNotificationAsRead(id: string, userId: string) {
  const scope = await resolveUserProjectScope(userId);
  const [notification] = await db
    .update(notificationTable)
    .set({ isRead: true })
    .where(
      and(
        eq(notificationTable.id, id),
        eq(notificationTable.userId, userId),
        notificationResourceAccess(
          userId,
          notificationTable.resourceId,
          notificationTable.resourceType,
          scope,
        ),
      ),
    )
    .returning();

  if (!notification) {
    throw new HTTPException(404, {
      message: "Notification not found",
    });
  }

  return notification;
}

export default markNotificationAsRead;
