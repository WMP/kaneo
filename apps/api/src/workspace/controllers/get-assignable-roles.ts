import { getAssignableRoles } from "../../utils/role-delegation";

async function getAssignableRolesCtrl(workspaceId: string, userId: string) {
  return { roles: await getAssignableRoles(workspaceId, userId) };
}

export default getAssignableRolesCtrl;
