import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

export type LinkResourceRequest = { id: string; userId: string };

// Links a person resource to a workspace member; its assignments in the
// projects the member can open move to their account.
async function linkResource({ id, userId }: LinkResourceRequest) {
  const response = await client.resource[":id"].link.$post({
    param: { id },
    json: { userId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default linkResource;
