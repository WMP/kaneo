import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type UpdateProjectHostRequest = {
  projectId: string;
  hostId: string;
  label?: string;
  region?: string;
  zone?: string | null;
};

async function updateProjectHost({
  projectId,
  hostId,
  ...json
}: UpdateProjectHostRequest) {
  const response = await client.infrastructure.project[":projectId"].hosts[
    ":hostId"
  ].$put({ param: { projectId, hostId }, json });
  if (!response.ok) throw await readProjectApiError(response);
  return response.json();
}

export default updateProjectHost;
