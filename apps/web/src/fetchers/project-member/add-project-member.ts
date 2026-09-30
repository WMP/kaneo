import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type AddProjectMemberRequest = {
  projectId: string;
  userId: string;
  role: string;
  /**
   * Only for an account that is not a workspace member yet: the workspace role
   * it gets, so it joins the workspace and the project in one step.
   */
  workspaceRole?: string;
};

async function addProjectMember({
  projectId,
  userId,
  role,
  workspaceRole,
}: AddProjectMemberRequest) {
  const response = await client.project[":projectId"].members.$post({
    param: { projectId },
    json: { userId, role, ...(workspaceRole ? { workspaceRole } : {}) },
  });

  if (!response.ok) throw await readProjectApiError(response);

  return response.json();
}

export default addProjectMember;
