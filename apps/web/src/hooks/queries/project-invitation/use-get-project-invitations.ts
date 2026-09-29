import { useQuery } from "@tanstack/react-query";
import getProjectInvitations from "@/fetchers/project-invitation/get-project-invitations";
import { projectInvitationsKey } from "@/lib/project-member-keys";

// Answers 403 for a caller who may neither invite nor cancel invitations; the
// members section reads that as "no invitation controls".
function useGetProjectInvitations(
  projectId: string | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: projectInvitationsKey(projectId),
    queryFn: () => getProjectInvitations(projectId ?? ""),
    enabled: !!projectId && enabled,
    // A 403 is the answer to "may I?": not reported as a failure.
    meta: { expectForbidden: true },
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export default useGetProjectInvitations;
