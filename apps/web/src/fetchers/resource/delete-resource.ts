import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type DeleteResourceRequest = InferRequestType<
  (typeof client)["resource"][":id"]["$delete"]
>["param"];

async function deleteResource({ id }: DeleteResourceRequest) {
  const response = await client.resource[":id"].$delete({ param: { id } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteResource;
