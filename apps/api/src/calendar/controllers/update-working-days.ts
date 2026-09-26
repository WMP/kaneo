import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workspaceTable } from "../../database/schema";
import { publishEvent } from "../../events";

async function updateWorkingDays(
  workspaceId: string,
  workingDays: number,
  userId: string,
) {
  const [existing] = await db
    .select({ workingDays: workspaceTable.workingDays })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);

  if (!existing) {
    throw new HTTPException(404, { message: "Workspace not found" });
  }

  const [updated] = await db
    .update(workspaceTable)
    .set({ workingDays })
    .where(eq(workspaceTable.id, workspaceId))
    .returning({ workingDays: workspaceTable.workingDays });

  if (!updated) {
    throw new HTTPException(404, { message: "Workspace not found" });
  }

  if (existing.workingDays !== updated.workingDays) {
    // waitForHandlers: see create-holiday.ts's identical rationale.
    await publishEvent(
      "workspace.calendar.working_days_updated",
      {
        workspaceId,
        userId,
        oldWorkingDays: existing.workingDays,
        newWorkingDays: updated.workingDays,
        type: "calendar_updated",
      },
      { waitForHandlers: true },
    );
  }

  return updated;
}

export default updateWorkingDays;
