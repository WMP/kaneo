import { useQuery } from "@tanstack/react-query";
import { getJiraTokenStatus } from "@/fetchers/jira-integration/jira-token";
import { jiraQueryKeys } from "./jira-query-keys";

// Whether the caller has a Jira token in this workspace, and whose it is. The
// token itself is never returned.
function useGetJiraTokenStatus(workspaceId: string | undefined) {
  return useQuery({
    queryKey: jiraQueryKeys.token(workspaceId ?? ""),
    queryFn: () => getJiraTokenStatus(workspaceId ?? ""),
    enabled: !!workspaceId,
  });
}

export default useGetJiraTokenStatus;
