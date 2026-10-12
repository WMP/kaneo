import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

async function deleteProjectHost({
  projectId,
  hostId,
}: {
  projectId: string;
  hostId: string;
}) {
  const response = await client.infrastructure.project[":projectId"].hosts[
    ":hostId"
  ].$delete({ param: { projectId, hostId } });
  if (!response.ok) throw await readProjectApiError(response);
  return response.json();
}

export default deleteProjectHost;
