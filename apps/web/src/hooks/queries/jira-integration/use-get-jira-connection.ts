import { useQuery } from "@tanstack/react-query";
import { getJiraConnection } from "@/fetchers/jira-integration/jira-connection";
import { jiraQueryKeys } from "./jira-query-keys";

// The connection (or null) of a workspace. The webhook URL and secret are only
// in the response for a caller with workspace:manage_settings.
function useGetJiraConnection(workspaceId: string | undefined) {
  return useQuery({
    queryKey: jiraQueryKeys.connection(workspaceId ?? ""),
    queryFn: () => getJiraConnection(workspaceId ?? ""),
    enabled: !!workspaceId,
  });
}

export default useGetJiraConnection;
