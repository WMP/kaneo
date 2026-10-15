import { HTTPException } from "hono/http-exception";
import {
  PROJECT_ACCESS_DENIED_MESSAGE,
  resolveProjectAccessMap,
} from "../utils/project-access";

// Upstream signature; the decision is the fork's (see README.md).
export async function assertProjectAccess(
  userId: string,
  projectIds: string | readonly string[],
): Promise<void> {
  const ids = [
    ...new Set(typeof projectIds === "string" ? [projectIds] : projectIds),
  ];
  if (ids.length === 0) return;
  const accesses = await resolveProjectAccessMap(userId, ids);
  if (accesses.size !== ids.length) {
    throw new HTTPException(403, { message: PROJECT_ACCESS_DENIED_MESSAGE });
  }
}
