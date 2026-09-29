import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

export type AssignableRole = { role: string; isDefault: boolean };

// Roles the caller may grant when inviting a member or changing a member's
// role. The API already enforces this on write; the list only keeps the UI
// from offering choices that would be rejected.
async function getAssignableRoles(
  workspaceId: string,
): Promise<AssignableRole[]> {
  const response = await client.workspace[":workspaceId"][
    "assignable-roles"
  ].$get({
    param: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const { roles } = await response.json();
  return roles;
}

export default getAssignableRoles;
