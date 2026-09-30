import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  deleteJiraConnection,
  putJiraConnection,
  rotateJiraWebhookSecret,
} from "@/fetchers/jira-integration/jira-connection";
import type { PutJiraConnectionRequest } from "@/fetchers/jira-integration/types";
import { jiraQueryKeys } from "@/hooks/queries/jira-integration/jira-query-keys";

export function usePutJiraConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workspaceId,
      data,
    }: {
      workspaceId: string;
      data: PutJiraConnectionRequest;
    }) => putJiraConnection(workspaceId, data),
    // Changing the base URL or the deployment removes every stored user token
    // on the server, so the token status and metadata are stale as well.
    onSuccess: (_, { workspaceId }) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: jiraQueryKeys.all,
          predicate: (query) => query.queryKey.includes(workspaceId),
        }),
        // Task-level keys carry no workspace id: a turned-off or re-pointed
        // connection changes every link and draft read from it.
        queryClient.invalidateQueries({ queryKey: jiraQueryKeys.tasks }),
        queryClient.invalidateQueries({ queryKey: jiraQueryKeys.drafts }),
      ]),
  });
}

export function useRotateJiraWebhookSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workspaceId: string) => rotateJiraWebhookSecret(workspaceId),
    onSuccess: (_, workspaceId) =>
      queryClient.invalidateQueries({
        queryKey: jiraQueryKeys.connection(workspaceId),
      }),
  });
}

// Deleting the connection also removes every token, link and proposal, so the
// whole Jira cache is dropped.
export function useDeleteJiraConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workspaceId: string) => deleteJiraConnection(workspaceId),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: jiraQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: jiraQueryKeys.tasks }),
        queryClient.invalidateQueries({ queryKey: jiraQueryKeys.drafts }),
      ]),
  });
}
