import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

async function getProjectRegions(projectId: string) {
  const response = await client.infrastructure.project[
    ":projectId"
  ].regions.$get({ param: { projectId } });
  if (!response.ok) throw await readProjectApiError(response);
  return response.json();
}

export type InfraRegionSummary = Awaited<
  ReturnType<typeof getProjectRegions>
>[number];

export default getProjectRegions;
