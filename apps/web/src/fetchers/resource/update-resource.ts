import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

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
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default updateResource;
