import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

async function getProjectStorageClusters(projectId: string) {
  const response = await client.infrastructure.project[":projectId"][
    "storage-clusters"
  ].$get({ param: { projectId } });
  if (!response.ok) throw await readProjectApiError(response);
  return response.json();
}

export type InfraStorageClusterSummary = Awaited<
  ReturnType<typeof getProjectStorageClusters>
>[number];

export default getProjectStorageClusters;
