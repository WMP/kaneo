import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

async function getEnforcementPreview({
  workspaceId,
  fallbackColumnId,
}: {
  workspaceId: string;
  fallbackColumnId?: string;
}) {
  const response = await client["workspace-column"][":workspaceId"][
    "enforcement-preview"
  ].$get({
    param: { workspaceId },
    query: fallbackColumnId ? { fallbackColumnId } : {},
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default getEnforcementPreview;
