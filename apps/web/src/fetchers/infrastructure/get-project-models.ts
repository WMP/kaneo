import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

async function getProjectModels(projectId: string) {
  const response = await client.infrastructure.project[
    ":projectId"
  ].models.$get({ param: { projectId } });
  if (!response.ok) throw await readProjectApiError(response);
  return response.json();
}

export type InfraModel = Awaited<ReturnType<typeof getProjectModels>>[number];

export default getProjectModels;
