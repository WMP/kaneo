import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";
import type { InfraModelInput } from "./create-project-model";

export type UpdateProjectModelRequest = {
  projectId: string;
  modelId: string;
} & Partial<InfraModelInput>;

async function updateProjectModel({
  projectId,
  modelId,
  ...json
}: UpdateProjectModelRequest) {
  const response = await client.infrastructure.project[":projectId"].models[
    ":modelId"
  ].$put({ param: { projectId, modelId }, json });
  if (!response.ok) throw await readProjectApiError(response);
  return response.json();
}

export default updateProjectModel;
