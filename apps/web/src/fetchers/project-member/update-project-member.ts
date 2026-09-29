import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type UpdateProjectMemberRequest = {
  projectId: string;
  userId: string;
  role: string;
};

async function updateProjectMember({
  projectId,
  userId,
  role,
}: UpdateProjectMemberRequest) {
  const response = await client.project[":projectId"].members[":userId"].$patch(
    {
      param: { projectId, userId },
      json: { role },
    },
  );

  if (!response.ok) throw await readProjectApiError(response);

  return response.json();
}

export default updateProjectMember;
