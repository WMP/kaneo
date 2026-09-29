import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { resourceTable, workspaceTable } from "../../database/schema";
import { describeResources } from "../describe-resources";
import { RESOURCE_ERROR_CODES, resourceError } from "../errors";
import type { ResourceKind } from "../schema";

async function createResource(
  workspaceId: string,
  viewerUserId: string,
  kind: ResourceKind,
  name: string,
  email?: string,
) {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw resourceError(
      400,
      RESOURCE_ERROR_CODES.nameRequired,
      "Name cannot be empty",
    );
  }

  const normalizedEmail = email?.trim().toLowerCase() || null;
  if (normalizedEmail && kind !== "person") {
    throw resourceError(
      400,
      RESOURCE_ERROR_CODES.emailNotAllowed,
      "Only a person can have an email address",
    );
  }

  const [workspace] = await db
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);

  if (!workspace) {
    throw resourceError(
      404,
      RESOURCE_ERROR_CODES.workspaceNotFound,
      "Workspace not found",
    );
  }

  const [created] = await db
    .insert(resourceTable)
    .values({
      workspaceId,
      kind,
      name: trimmedName,
      email: normalizedEmail,
    })
    .returning();

  if (!created) {
    throw new HTTPException(500, { message: "Failed to create resource" });
  }

  const [described] = await describeResources([created], {
    userId: viewerUserId,
    workspaceId,
  });
  if (!described) {
    throw new HTTPException(500, { message: "Failed to create resource" });
  }
  return described;
}

export default createResource;
