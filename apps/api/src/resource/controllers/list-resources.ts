import { and, asc, eq } from "drizzle-orm";
import db from "../../database";
import { resourceTable } from "../../database/schema";
import { describeResources } from "../describe-resources";
import type { ResourceKind } from "../schema";

async function listResources(
  workspaceId: string,
  viewerUserId: string,
  kind?: ResourceKind,
) {
  const rows = await db
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
  return describeResources(rows, { userId: viewerUserId, workspaceId });
}

export default listResources;
