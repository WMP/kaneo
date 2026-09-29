import type { ProjectAccess } from "../../utils/project-access";
import { assignableRolesFor } from "../../utils/role-delegation";

// Same shape as `GET /api/workspace/{id}/assignable-roles`, evaluated against
// the caller's effective statements in this project.
async function getAssignableProjectRoles(access: ProjectAccess) {
  return {
    roles: await assignableRolesFor(
      access.workspaceId,
      access.unrestricted
        ? { unrestricted: true }
        : { unrestricted: false, statements: access.statements },
    ),
  };
}

export default getAssignableProjectRoles;
