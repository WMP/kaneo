import { useQuery } from "@tanstack/react-query";
import {
  getJiraProjectMapping,
  getJiraResolvedMapping,
  getJiraUserMapping,
  getJiraWorkspaceMapping,
} from "@/fetchers/jira-integration/jira-mapping";
import { jiraQueryKeys } from "./jira-query-keys";

export function useGetJiraWorkspaceMapping(workspaceId: string | undefined) {
  return useQuery({
    queryKey: jiraQueryKeys.workspaceMapping(workspaceId ?? ""),
    queryFn: () => getJiraWorkspaceMapping(workspaceId ?? ""),
    enabled: !!workspaceId,
  });
}

export function useGetJiraProjectMapping(projectId: string | undefined) {
  return useQuery({
    queryKey: jiraQueryKeys.projectMapping(projectId ?? ""),
    queryFn: () => getJiraProjectMapping(projectId ?? ""),
    enabled: !!projectId,
  });
}

export function useGetJiraUserMapping(workspaceId: string | undefined) {
  return useQuery({
    queryKey: jiraQueryKeys.userMapping(workspaceId ?? ""),
    queryFn: () => getJiraUserMapping(workspaceId ?? ""),
    enabled: !!workspaceId,
  });
}

// What applies to the caller's sends from a project: default, workspace,
// project and the caller's own level merged, every value with its origin.
export function useGetJiraResolvedMapping(projectId: string | undefined) {
  return useQuery({
    queryKey: jiraQueryKeys.resolvedMapping(projectId ?? ""),
    queryFn: () => getJiraResolvedMapping(projectId ?? ""),
    enabled: !!projectId,
  });
}
