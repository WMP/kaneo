import { skipToken, useQuery } from "@tanstack/react-query";
import getWorkspaceActivityRetention from "@/fetchers/workspace/get-workspace-activity-retention";

function useGetWorkspaceActivityRetention(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["workspace-activity-retention", workspaceId],
    queryFn: workspaceId
      ? () => getWorkspaceActivityRetention(workspaceId)
      : skipToken,
  });
}

export default useGetWorkspaceActivityRetention;
