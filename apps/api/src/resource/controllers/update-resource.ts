import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { resourceTable } from "../../database/schema";
import { describeResources } from "../describe-resources";
import { RESOURCE_ERROR_CODES, resourceError } from "../errors";

// Kind is immutable after creation — changing what a resource *is* (person vs
// equipment vs material) would retroactively change how it counts in the
// workload split, so it isn't offered here.
async function updateResource(
  id: string,
  viewerUserId: string,
  name?: string,
  email?: string | null,
) {
  const [existing] = await db
    .select()
    .from(resourceTable)
    .where(eq(resourceTable.id, id))
    .limit(1);

  if (!existing) {
    throw resourceError(
      404,
      RESOURCE_ERROR_CODES.notFound,
      "Resource not found",
    );
  }

  if (name !== undefined && !name.trim()) {
    throw resourceError(
      400,
      RESOURCE_ERROR_CODES.nameRequired,
      "Name cannot be empty",
    );
  }

  const normalizedEmail =
    email === undefined ? undefined : email?.trim().toLowerCase() || null;
  const emailChanged =
    normalizedEmail !== undefined &&
    normalizedEmail !== (existing.email?.toLowerCase() ?? null);
  // Only a person can have an email. A stored address on another kind (from
  // before this rule) can stay or be cleared, but not be replaced.
  if (emailChanged && normalizedEmail && existing.kind !== "person") {
    throw resourceError(
      400,
      RESOURCE_ERROR_CODES.emailNotAllowed,
      "Only a person can have an email address",
    );
  }

  const [updated] = await db
    .update(resourceTable)
    .set({
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
      // The invitation was sent to the old address: it no longer belongs to
      // this resource (it stays valid for that address).
      ...(emailChanged ? { invitationId: null } : {}),
    })
    .where(eq(resourceTable.id, id))
    .returning();

  if (!updated) {
    throw new HTTPException(500, { message: "Failed to update resource" });
  }

  const [described] = await describeResources([updated], {
    userId: viewerUserId,
    workspaceId: updated.workspaceId,
  });
  if (!described) {
    throw new HTTPException(500, { message: "Failed to update resource" });
  }
  return described;
}

export default updateResource;
