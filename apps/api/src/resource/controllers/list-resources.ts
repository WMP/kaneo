import { and, asc, eq } from "drizzle-orm";
import db from "../../database";
import { resourceTable } from "../../database/schema";
import type { ResourceKind } from "../schema";

async function listResources(workspaceId: string, kind?: ResourceKind) {
  return db
    .select()
    .from(resourceTable)
    .where(
      kind
        ? and(
            eq(resourceTable.workspaceId, workspaceId),
            eq(resourceTable.kind, kind),
          )
        : eq(resourceTable.workspaceId, workspaceId),
    )
    .orderBy(asc(resourceTable.createdAt), asc(resourceTable.id));
}

export default listResources;
