import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workspaceHolidayTable } from "../../database/schema";
import { publishEvent } from "../../events";

async function deleteHoliday(
  workspaceId: string,
  holidayId: string,
  userId: string,
) {
  const [deleted] = await db
    .delete(workspaceHolidayTable)
    .where(
      and(
        eq(workspaceHolidayTable.id, holidayId),
        eq(workspaceHolidayTable.workspaceId, workspaceId),
      ),
    )
    .returning();

  if (!deleted) {
    throw new HTTPException(404, { message: "Holiday not found" });
  }

  // waitForHandlers: see create-holiday.ts's identical rationale.
  await publishEvent(
    "workspace.calendar.holiday_removed",
    {
      workspaceId,
      userId,
      holidayId: deleted.id,
      date: deleted.date.toISOString(),
      name: deleted.name,
      type: "holiday_removed",
    },
    { waitForHandlers: true },
  );

  return deleted;
}

export default deleteHoliday;
