import { useQuery } from "@tanstack/react-query";
import {
  listJiraComponents,
  listJiraCreateFields,
  listJiraIssueTypes,
  listJiraProjects,
  listJiraStatuses,
  searchJiraUsers,
} from "@/fetchers/jira-integration/jira-meta";
import { jiraQueryKeys } from "./jira-query-keys";

// Jira metadata is read with the caller's own token and only feeds pickers, so
// a failure (no token, a rejected token, Jira down) is not retried: the picker
// falls back to a typed value. `enabled` lets a caller wait for a connected
// token and for the ids the request needs.
const META_STALE_TIME = 5 * 60 * 1000;

type MetaOptions = { enabled?: boolean };

export function useJiraProjects(
  workspaceId: string | undefined,
  { enabled = true }: MetaOptions = {},
) {
  return useQuery({
    queryKey: [...jiraQueryKeys.meta(workspaceId ?? ""), "projects"],
    queryFn: () => listJiraProjects(workspaceId ?? ""),
    enabled: !!workspaceId && enabled,
    retry: false,
    staleTime: META_STALE_TIME,
  });
}

export function useJiraIssueTypes(
  workspaceId: string | undefined,
  projectKey: string | null | undefined,
  { enabled = true }: MetaOptions = {},
) {
  return useQuery({
    queryKey: [
      ...jiraQueryKeys.meta(workspaceId ?? ""),
      "issue-types",
      projectKey ?? "",
    ],
    queryFn: () => listJiraIssueTypes(workspaceId ?? "", projectKey ?? ""),
    enabled: !!workspaceId && !!projectKey && enabled,
    retry: false,
    staleTime: META_STALE_TIME,
  });
}

export function useJiraCreateFields(
  workspaceId: string | undefined,
  projectKey: string | null | undefined,
  issueTypeId: string | null | undefined,
  { enabled = true }: MetaOptions = {},
) {
  return useQuery({
    queryKey: [
      ...jiraQueryKeys.meta(workspaceId ?? ""),
      "fields",
      projectKey ?? "",
      issueTypeId ?? "",
    ],
    queryFn: () =>
      listJiraCreateFields(
        workspaceId ?? "",
        projectKey ?? "",
        issueTypeId ?? "",
      ),
    enabled: !!workspaceId && !!projectKey && !!issueTypeId && enabled,
    retry: false,
    staleTime: META_STALE_TIME,
  });
}

export function useJiraStatuses(
  workspaceId: string | undefined,
  projectKey: string | null | undefined,
  { enabled = true }: MetaOptions = {},
) {
  return useQuery({
    queryKey: [
      ...jiraQueryKeys.meta(workspaceId ?? ""),
      "statuses",
      projectKey ?? "",
    ],
    queryFn: () => listJiraStatuses(workspaceId ?? "", projectKey ?? ""),
    enabled: !!workspaceId && !!projectKey && enabled,
    retry: false,
    staleTime: META_STALE_TIME,
  });
}

export function useJiraComponents(
  workspaceId: string | undefined,
  projectKey: string | null | undefined,
  { enabled = true }: MetaOptions = {},
) {
  return useQuery({
    queryKey: [
      ...jiraQueryKeys.meta(workspaceId ?? ""),
      "components",
      projectKey ?? "",
    ],
    queryFn: () => listJiraComponents(workspaceId ?? "", projectKey ?? ""),
    enabled: !!workspaceId && !!projectKey && enabled,
    retry: false,
    staleTime: META_STALE_TIME,
  });
}

export function useJiraUserSearch(
  workspaceId: string | undefined,
  query: string,
  projectKey: string | null | undefined,
  { enabled = true }: MetaOptions = {},
) {
  return useQuery({
    queryKey: [
      ...jiraQueryKeys.meta(workspaceId ?? ""),
      "users",
      projectKey ?? "",
      query,
    ],
    queryFn: () =>
      searchJiraUsers(workspaceId ?? "", query, projectKey ?? undefined),
    enabled: !!workspaceId && query.trim().length >= 2 && enabled,
    retry: false,
    staleTime: 60 * 1000,
  });
}
