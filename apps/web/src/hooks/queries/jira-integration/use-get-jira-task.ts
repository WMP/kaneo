import { useQuery } from "@tanstack/react-query";
import { getJiraTaskInfo } from "@/fetchers/jira-integration/jira-task";
import { jiraQueryKeys } from "./jira-query-keys";

// The Jira issue link of a task, its pending status proposal and the recent
// ones. `enabled` lets a caller wait for an active workspace connection. A
// failure is not retried: the panel simply stays out of the way.
function useGetJiraTask(
  taskId: string | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: jiraQueryKeys.task(taskId ?? ""),
    queryFn: () => getJiraTaskInfo(taskId ?? ""),
    enabled: !!taskId && enabled,
    retry: false,
  });
}

export default useGetJiraTask;
