import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type CreateProjectHostRequest = {
  projectId: string;
  modelId: string;
  region: string;
  label?: string;
  quantity?: number;
};

async function createProjectHost({
  projectId,
  ...json
}: CreateProjectHostRequest) {
  const response = await client.infrastructure.project[
    ":projectId"
  ].hosts.$post({ param: { projectId }, json });
  if (!response.ok) throw await readProjectApiError(response);
  return response.json();
}

export default createProjectHost;
