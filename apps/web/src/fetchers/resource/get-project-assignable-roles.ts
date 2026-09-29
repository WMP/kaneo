import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

export type AssignableProjectRole = { role: string; isDefault: boolean };

// Roles the caller may grant as a project role in one project: those whose
// permissions the caller also holds THERE. The API enforces it on write; the
// list keeps the invite dialog from offering choices that would be rejected.
async function getProjectAssignableRoles(
  projectId: string,
): Promise<AssignableProjectRole[]> {
  const response = await client.project[":projectId"]["assignable-roles"].$get({
    param: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const { roles } = await response.json();
  return roles;
}

export default getProjectAssignableRoles;
