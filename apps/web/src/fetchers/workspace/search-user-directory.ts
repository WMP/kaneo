import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { readProjectApiError } from "@/lib/project-member-error";

export type DirectoryPerson = InferResponseType<
  (typeof client)["workspace"][":workspaceId"]["user-directory"]["$get"],
  200
>[number];

// Accounts of the instance matching part of a name or email (2+ characters),
// for somebody who may add workspace members. Answers 403 with the code
// USER_DIRECTORY_DISABLED when the instance switched the directory off.
async function searchUserDirectory(
  workspaceId: string,
  q: string,
): Promise<DirectoryPerson[]> {
  const response = await client.workspace[":workspaceId"][
    "user-directory"
  ].$get({ param: { workspaceId }, query: { q } });

  if (!response.ok) throw await readProjectApiError(response);

  return response.json();
}

export default searchUserDirectory;
