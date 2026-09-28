import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

export type UpdateResourceRequest = {
  id: string;
  name?: string;
  // null clears a stored email; omit to leave it unchanged.
  email?: string | null;
};

async function updateResource({ id, name, email }: UpdateResourceRequest) {
  const response = await client.resource[":id"].$patch({
    param: { id },
    json: { name, email },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateResource;
