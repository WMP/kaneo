import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

export type UnlinkResourceRequest = { id: string };

async function unlinkResource({ id }: UnlinkResourceRequest) {
  const response = await client.resource[":id"].unlink.$post({
    param: { id },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default unlinkResource;
