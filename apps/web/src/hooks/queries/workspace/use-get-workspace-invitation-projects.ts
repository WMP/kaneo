import { useQuery } from "@tanstack/react-query";
import getWorkspaceInvitationProjects from "@/fetchers/workspace/get-workspace-invitation-projects";

// Under the `["workspace-invites", workspaceId]` prefix that every invitation
// mutation already invalidates.
export const workspaceInvitationProjectsKey = (
  workspaceId: string | undefined,
) => ["workspace-invites", workspaceId, "projects"] as const;

function useGetWorkspaceInvitationProjects(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceInvitationProjectsKey(workspaceId),
    queryFn: () => getWorkspaceInvitationProjects(workspaceId ?? ""),
    enabled: !!workspaceId,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export default useGetWorkspaceInvitationProjects;
