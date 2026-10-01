import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type SetEnforcementRequest = {
  workspaceId: string;
  enforced: boolean;
  fallbackColumnId?: string;
};

async function setEnforcement({
  workspaceId,
  enforced,
  fallbackColumnId,
}: SetEnforcementRequest) {
  const response = await client["workspace-column"][
    ":workspaceId"
  ].enforcement.$put({
    param: { workspaceId },
    json: { enforced, fallbackColumnId },
  });

  if (!response.ok) {
    throw await readProjectApiError(response);
  }

  return response.json();
}

export default setEnforcement;
