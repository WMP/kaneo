import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  deleteJiraToken,
  putJiraToken,
} from "@/fetchers/jira-integration/jira-token";
import type { PutJiraTokenRequest } from "@/fetchers/jira-integration/types";
import { jiraQueryKeys } from "@/hooks/queries/jira-integration/jira-query-keys";

// A token change decides whether the metadata pickers can be read at all, so
// the token status and every cached metadata response of the workspace are
// refreshed.
function useInvalidateToken() {
  const queryClient = useQueryClient();
  return (workspaceId: string) =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: jiraQueryKeys.token(workspaceId),
      }),
      queryClient.invalidateQueries({
        queryKey: jiraQueryKeys.meta(workspaceId),
      }),
    ]);
}

export function usePutJiraToken() {
  const invalidate = useInvalidateToken();
  return useMutation({
    mutationFn: ({
      workspaceId,
      data,
    }: {
      workspaceId: string;
      data: PutJiraTokenRequest;
    }) => putJiraToken(workspaceId, data),
    onSuccess: (_, { workspaceId }) => invalidate(workspaceId),
    // A rejected token may still have updated lastError on the server.
    onError: (_, { workspaceId }) => invalidate(workspaceId),
  });
}

export function useDeleteJiraToken() {
  const invalidate = useInvalidateToken();
  return useMutation({
    mutationFn: (workspaceId: string) => deleteJiraToken(workspaceId),
    onSuccess: (_, workspaceId) => invalidate(workspaceId),
  });
}
