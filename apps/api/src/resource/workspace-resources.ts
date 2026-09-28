import { and, eq, inArray } from "drizzle-orm";
import db, { schema } from "../database";

/**
 * Which of the given resource ids belong to this workspace. Mirrors
 * `filterAssignableUsers` in `utils/assert-assignable-user.ts` (filter, not
 * throw) so a caller can either drop invalid ids or turn the gap into its own
 * 403/404.
 */
export async function filterWorkspaceResources(
  resourceIds: string[],
  workspaceId: string,
): Promise<Set<string>> {
  if (resourceIds.length === 0) {
    return new Set();
  }

  const rows = await db
    .select({ id: schema.resourceTable.id })
    .from(schema.resourceTable)
    .where(
      and(
        inArray(schema.resourceTable.id, resourceIds),
        eq(schema.resourceTable.workspaceId, workspaceId),
      ),
    );

  return new Set(rows.map((row) => row.id));
}
