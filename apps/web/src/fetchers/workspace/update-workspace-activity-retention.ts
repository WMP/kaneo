import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

type UpdateWorkspaceActivityRetentionParams = {
  workspaceId: string;
  activityRetentionDays: number | null;
};

async function updateWorkspaceActivityRetention({
  workspaceId,
  activityRetentionDays,
}: UpdateWorkspaceActivityRetentionParams) {
  const response = await client.workspace[":workspaceId"][
    "activity-retention"
  ].$patch({
    param: { workspaceId },
    json: { activityRetentionDays },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateWorkspaceActivityRetention;
