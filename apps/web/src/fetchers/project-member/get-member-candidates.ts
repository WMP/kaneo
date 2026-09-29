import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { readProjectApiError } from "@/lib/project-member-error";

export type MemberCandidate = InferResponseType<
  (typeof client)["project"][":projectId"]["member-candidates"]["$get"],
  200
>[number];

// Workspace members who can be added to the project right now. Answers 403
// for a caller who may not add members.
async function getMemberCandidates(
  projectId: string,
): Promise<MemberCandidate[]> {
  const response = await client.project[":projectId"]["member-candidates"].$get(
    { param: { projectId } },
  );

  if (!response.ok) throw await readProjectApiError(response);

  return response.json();
}

export default getMemberCandidates;
