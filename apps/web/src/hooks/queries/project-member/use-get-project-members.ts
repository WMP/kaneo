import { useQuery } from "@tanstack/react-query";
import getProjectMembers from "@/fetchers/project-member/get-project-members";
import { projectMembersKey } from "@/lib/project-member-keys";

function useGetProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: projectMembersKey(projectId),
    queryFn: () => getProjectMembers(projectId ?? ""),
    enabled: !!projectId,
    // A 403 turns the section into its no-access state: not a failure.
    meta: { expectForbidden: true },
    // Members change elsewhere (another admin, a leave, an accepted
    // invitation), so every visit of the settings page reads the list again.
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export default useGetProjectMembers;
