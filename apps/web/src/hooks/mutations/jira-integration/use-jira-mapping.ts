import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  putJiraProjectMapping,
  putJiraUserMapping,
  putJiraWorkspaceMapping,
} from "@/fetchers/jira-integration/jira-mapping";
import type { JiraMappingConfig } from "@/fetchers/jira-integration/types";
import { jiraQueryKeys } from "@/hooks/queries/jira-integration/jira-query-keys";

// A mapping level is the parent of the levels below it (and part of every
// resolved mapping), so a save refreshes all mapping and resolved-mapping
// queries, not only its own.
function useInvalidateMappings() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: jiraQueryKeys.mappings }),
      queryClient.invalidateQueries({
        queryKey: jiraQueryKeys.resolvedMappings,
      }),
    ]);
}

export function usePutJiraWorkspaceMapping() {
  const invalidate = useInvalidateMappings();
  return useMutation({
    mutationFn: ({
      workspaceId,
      config,
    }: {
      workspaceId: string;
      config: JiraMappingConfig;
    }) => putJiraWorkspaceMapping(workspaceId, config),
    onSuccess: invalidate,
  });
}

export function usePutJiraProjectMapping() {
  const invalidate = useInvalidateMappings();
  return useMutation({
    mutationFn: ({
      projectId,
      config,
    }: {
      projectId: string;
      config: JiraMappingConfig;
    }) => putJiraProjectMapping(projectId, config),
    onSuccess: invalidate,
  });
}

export function usePutJiraUserMapping() {
  const invalidate = useInvalidateMappings();
  return useMutation({
    mutationFn: ({
      workspaceId,
      config,
    }: {
      workspaceId: string;
      config: JiraMappingConfig;
    }) => putJiraUserMapping(workspaceId, config),
    onSuccess: invalidate,
  });
}
