import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type RemoveProjectMemberRequest = {
  projectId: string;
  userId: string;
};

// Removes a member, or leaves the project when `userId` is the caller's own.
async function removeProjectMember({
  projectId,
  userId,
}: RemoveProjectMemberRequest) {
  const response = await client.project[":projectId"].members[
    ":userId"
  ].$delete({
    param: { projectId, userId },
  });

  if (!response.ok) throw await readProjectApiError(response);

  return response.json();
}

export default removeProjectMember;
