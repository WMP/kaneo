import { useQuery } from "@tanstack/react-query";
import getProjectMembers from "@/fetchers/project-member/get-project-members";

export const projectMembersQueryKey = (projectId: string) =>
  ["project-members", projectId] as const;

// People who can reach a project (project members and full-access users, no
// inactive rows). Feeds assignee pickers and comment mentions in project views.
// Pass an empty id outside a project: the query stays disabled.
export function useProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: projectMembersQueryKey(projectId ?? ""),
    queryFn: () => getProjectMembers(projectId ?? ""),
    enabled: !!projectId,
    staleTime: 60 * 1000,
  });
}
