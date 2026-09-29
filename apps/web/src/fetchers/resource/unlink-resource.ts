import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type UnlinkResourceRequest = { id: string };

async function unlinkResource({ id }: UnlinkResourceRequest) {
  const response = await client.resource[":id"].unlink.$post({
    param: { id },
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default unlinkResource;
