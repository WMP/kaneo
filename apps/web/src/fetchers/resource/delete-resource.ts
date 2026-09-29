import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";
import { readProjectApiError } from "@/lib/project-member-error";

export type DeleteResourceRequest = InferRequestType<
  (typeof client)["resource"][":id"]["$delete"]
>["param"];

async function deleteResource({ id }: DeleteResourceRequest) {
  const response = await client.resource[":id"].$delete({ param: { id } });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default deleteResource;
