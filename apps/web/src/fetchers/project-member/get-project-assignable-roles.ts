import { client } from "@kaneo/libs";
import type { AssignableRole } from "@/fetchers/workspace/get-assignable-roles";
import { readProjectApiError } from "@/lib/project-member-error";

// Roles the caller may hand out as a project role in this project.
async function getProjectAssignableRoles(
  projectId: string,
): Promise<AssignableRole[]> {
  const response = await client.project[":projectId"]["assignable-roles"].$get({
    param: { projectId },
  });

  if (!response.ok) throw await readProjectApiError(response);

  const { roles } = await response.json();
  return roles;
}

export default getProjectAssignableRoles;
