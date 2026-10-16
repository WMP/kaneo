import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

async function deleteProjectModel({
  projectId,
  modelId,
}: {
  projectId: string;
  modelId: string;
}) {
  const response = await client.infrastructure.project[":projectId"].models[
    ":modelId"
  ].$delete({ param: { projectId, modelId } });
  if (!response.ok) throw await readProjectApiError(response);
  return response.json();
}

export default deleteProjectModel;
