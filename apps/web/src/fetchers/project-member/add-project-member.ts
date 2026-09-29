import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type AddProjectMemberRequest = {
  projectId: string;
  userId: string;
  role: string;
};

async function addProjectMember({
  projectId,
  userId,
  role,
}: AddProjectMemberRequest) {
  const response = await client.project[":projectId"].members.$post({
    param: { projectId },
    json: { userId, role },
  });

  if (!response.ok) throw await readProjectApiError(response);

  return response.json();
}

export default addProjectMember;
