import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workspaceHolidayTable } from "../../database/schema";
import { publishEvent } from "../../events";
// Holidays are date-only, normalized to UTC midnight so they compare equal
// regardless of the server or caller's local time zone — the shared helper
// used for task startDate/dueDate/constraintDate does exactly this.
import { normalizeToUtcMidnight } from "../../utils/validate-dates";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function createHoliday(
  workspaceId: string,
  date: string,
  name: string,
  userId: string,
) {
  const normalizedDate = normalizeToUtcMidnight(date, "holiday date");

  const [existing] = await db
    .select({ id: workspaceHolidayTable.id })
    .from(workspaceHolidayTable)
    .where(
      and(
        eq(workspaceHolidayTable.workspaceId, workspaceId),
        eq(workspaceHolidayTable.date, normalizedDate),
      ),
    )
    .limit(1);

  if (existing) {
    throw new HTTPException(409, {
      message: "A holiday already exists on this date",
    });
  }

  try {
    const [created] = await db
      .insert(workspaceHolidayTable)
      .values({ workspaceId, date: normalizedDate, name })
      .returning();

    if (!created) {
      throw new HTTPException(500, { message: "Failed to create holiday" });
    }

    // waitForHandlers: this is audit history for a workspace-level change,
    // not best-effort — see update-task.ts's identical rationale for
    // "task.updated". Without it, the activity row could still be writing
    // when this request returns.
    await publishEvent(
      "workspace.calendar.holiday_added",
      {
        workspaceId,
        userId,
        holidayId: created.id,
        date: created.date.toISOString(),
        name: created.name,
        type: "holiday_added",
      },
      { waitForHandlers: true },
    );

    return created;
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    // The select above only narrows the race window; the unique constraint
    // on (workspaceId, date) is the actual guard against a concurrent create.
    if (isUniqueViolation(error)) {
      throw new HTTPException(409, {
        message: "A holiday already exists on this date",
      });
    }
    throw error;
  }
}

export default createHoliday;
