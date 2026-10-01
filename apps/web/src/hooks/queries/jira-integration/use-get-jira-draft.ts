import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getJiraDraft } from "@/fetchers/jira-integration/jira-task";
import { jiraQueryKeys } from "./jira-query-keys";

// What would be sent to Jira. It is read when the send dialog opens and again
// when the person picks another project or issue type (the target then names
// both), so the rows are never served from an old cache entry and the previous
// rows stay on screen while the next draft loads.
function useGetJiraDraft(
  taskId: string,
  target: { jiraProjectKey?: string; issueTypeId?: string },
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: jiraQueryKeys.draft(
      taskId,
      target.jiraProjectKey,
      target.issueTypeId,
    ),
    queryFn: () => getJiraDraft(taskId, target),
    enabled: !!taskId && enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

export default useGetJiraDraft;
