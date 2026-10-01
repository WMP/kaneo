import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

// People the caller may see in a workspace: everybody for a caller with full
// access or who manages members, otherwise themselves, the full-access members
// and the members they share a project with. Shaped like the Better Auth member
// list the activity views already read (`user` holds the profile).
async function getWorkspaceMembers(workspaceId: string) {
  const response = await client.workspace[":workspaceId"].members.$get({
    param: { workspaceId },
    query: {},
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const rows = await response.json();
  return rows.map((row) => ({
    id: row.id,
    userId: row.id,
    role: row.role,
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      image: row.image,
    },
  }));
}

export default getWorkspaceMembers;
