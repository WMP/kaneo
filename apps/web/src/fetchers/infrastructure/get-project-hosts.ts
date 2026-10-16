import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

async function getProjectHosts(projectId: string) {
  const response = await client.infrastructure.project[":projectId"].hosts.$get(
    {
      param: { projectId },
    },
  );
  if (!response.ok) throw await readProjectApiError(response);
  return response.json();
}

export type InfraHost = Awaited<ReturnType<typeof getProjectHosts>>[number];

export default getProjectHosts;
