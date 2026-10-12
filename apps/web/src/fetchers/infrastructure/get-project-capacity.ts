import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

async function getProjectCapacity(projectId: string) {
  const response = await client.infrastructure.project[
    ":projectId"
  ].capacity.$get({ param: { projectId } });
  if (!response.ok) throw await readProjectApiError(response);
  return response.json();
}

export type ProjectCapacity = Awaited<ReturnType<typeof getProjectCapacity>>;
export type ProjectCapacityWarning = ProjectCapacity["warnings"][number];
export type ProjectHostCapacity = ProjectCapacity["hosts"][number];

export default getProjectCapacity;
