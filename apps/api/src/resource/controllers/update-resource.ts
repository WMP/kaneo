import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { resourceTable } from "../../database/schema";

// Kind is immutable after creation — changing what a resource *is* (person vs
// equipment vs material) would retroactively change how it counts in the
// workload split, so it isn't offered here.
async function updateResource(
  id: string,
  name?: string,
  email?: string | null,
) {
  const [existing] = await db
    .select()
    .from(resourceTable)
    .where(eq(resourceTable.id, id))
    .limit(1);

  if (!existing) {
    throw new HTTPException(404, { message: "Resource not found" });
  }

  if (name !== undefined && !name.trim()) {
    throw new HTTPException(400, { message: "Name cannot be empty" });
  }

  const [updated] = await db
    .update(resourceTable)
    .set({
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(email !== undefined ? { email: email?.trim() || null } : {}),
    })
    .where(eq(resourceTable.id, id))
    .returning();

  if (!updated) {
    throw new HTTPException(500, { message: "Failed to update resource" });
  }

  return updated;
}

export default updateResource;
