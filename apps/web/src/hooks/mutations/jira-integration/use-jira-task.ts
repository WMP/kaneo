import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  acceptJiraProposal,
  refreshJiraTask,
  rejectJiraProposal,
  sendTaskToJira,
  unlinkJiraTask,
} from "@/fetchers/jira-integration/jira-task";
import type { JiraSendRequest } from "@/fetchers/jira-integration/types";
import { jiraQueryKeys } from "@/hooks/queries/jira-integration/jira-query-keys";

// Everything a task shows about Jira: the link and proposals, the task itself
// (a status change), its activity feed, and the draft behind the send dialog.
function useInvalidateTask() {
  const queryClient = useQueryClient();
  return (taskId: string, projectId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: jiraQueryKeys.task(taskId) }),
      queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
      queryClient.invalidateQueries({ queryKey: ["activities", taskId] }),
      queryClient.invalidateQueries({ queryKey: jiraQueryKeys.drafts }),
      // Accepting a proposal changes the task's status, so the boards follow.
      ...(projectId
        ? [queryClient.invalidateQueries({ queryKey: ["tasks", projectId] })]
        : []),
    ]);
}

// A failed call may still have changed something on the server (an issue that
// was created but could not be linked, a proposal someone else resolved), so
// the Jira state of the task is read again either way.
export function useSendTaskToJira() {
  const invalidate = useInvalidateTask();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: JiraSendRequest }) =>
      sendTaskToJira(taskId, data),
    onSettled: (_, __, { taskId }) => invalidate(taskId),
  });
}

export function useRefreshJiraTask() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateTask();
  return useMutation({
    mutationFn: (taskId: string) => refreshJiraTask(taskId),
    onSuccess: (result, taskId) => {
      // The answer already is the new state; show it before the refetch.
      queryClient.setQueryData(jiraQueryKeys.task(taskId), result.info);
    },
    onSettled: (_, __, taskId) => invalidate(taskId),
  });
}

export function useUnlinkJiraTask() {
  const invalidate = useInvalidateTask();
  return useMutation({
    mutationFn: (taskId: string) => unlinkJiraTask(taskId),
    onSettled: (_, __, taskId) => invalidate(taskId),
  });
}

export function useAcceptJiraProposal() {
  const invalidate = useInvalidateTask();
  return useMutation({
    mutationFn: ({
      proposalId,
      status,
    }: {
      proposalId: string;
      taskId: string;
      projectId: string;
      status?: string;
    }) => acceptJiraProposal(proposalId, status),
    onSettled: (_, __, { taskId, projectId }) => invalidate(taskId, projectId),
  });
}

export function useRejectJiraProposal() {
  const invalidate = useInvalidateTask();
  return useMutation({
    mutationFn: ({ proposalId }: { proposalId: string; taskId: string }) =>
      rejectJiraProposal(proposalId),
    onSettled: (_, __, { taskId }) => invalidate(taskId),
  });
}
