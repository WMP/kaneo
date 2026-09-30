import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

async function fetchWorkspacePeople(workspaceId: string) {
  const response = await client.workspace[":workspaceId"].members.$get({
    param: { workspaceId },
    query: { include: "projects" },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

// One row of the workspace members table. `projects` and `fullAccess` come only
// for a caller who manages members (or has full access); `projects` is limited
// to the projects the caller can open.
export type WorkspacePerson = Awaited<
  ReturnType<typeof fetchWorkspacePeople>
>[number];

async function getWorkspacePeople(workspaceId: string) {
  return fetchWorkspacePeople(workspaceId);
}

export default getWorkspacePeople;
