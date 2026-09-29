import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type LinkResourceRequest = { id: string; userId: string };

// Links a person resource to a workspace member; its assignments in the
// projects the member can open move to their account.
async function linkResource({ id, userId }: LinkResourceRequest) {
  const response = await client.resource[":id"].link.$post({
    param: { id },
    json: { userId },
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default linkResource;
