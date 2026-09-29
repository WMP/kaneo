import { useQuery } from "@tanstack/react-query";
import getProjectInvitations from "@/fetchers/project-invitation/get-project-invitations";
import { projectInvitationsKey } from "@/lib/project-member-keys";

// Answers 403 for a caller who may neither invite nor cancel invitations; the
// members section reads that as "no invitation controls".
function useGetProjectInvitations(projectId: string | undefined) {
  return useQuery({
    queryKey: projectInvitationsKey(projectId),
    queryFn: () => getProjectInvitations(projectId ?? ""),
    enabled: !!projectId,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export default useGetProjectInvitations;
