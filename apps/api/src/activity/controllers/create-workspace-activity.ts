import db from "../../database";
import { activityTable } from "../../database/schema";
import { currentActorSource } from "../actor-source";

// Workspace-level activity (no task to attach to) — currently just calendar
// changes: adding/removing a holiday and editing the working-days bitmask.
// Mirrors create-activity.ts, but sets workspaceId instead of taskId.
async function createWorkspaceActivity(
  workspaceId: string,
  type: string,
  userId: string | null,
  content: string | null,
  eventData?: Record<string, unknown> | null,
) {
  const [activity] = await db
    .insert(activityTable)
    .values({
      workspaceId,
      type,
      userId,
      content,
      eventData: eventData ?? null,
      ...currentActorSource(),
    })
    .returning();
  return activity;
}

export default createWorkspaceActivity;
