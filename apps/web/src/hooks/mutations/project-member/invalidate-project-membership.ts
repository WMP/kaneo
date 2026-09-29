import type { QueryClient } from "@tanstack/react-query";
import {
  projectAssignableRolesKey,
  projectInvitationsKey,
  projectMemberCandidatesKey,
  projectMembersKey,
} from "@/lib/project-member-keys";

/**
 * Everything a change of project membership or of a project invitation can
 * make stale: the project's member, candidate, role and invitation lists, the
 * project list (who sees which project), the workspace member list and
 * pending invitations (an invitation is a workspace invitation too), and the
 * project access answer, which is keyed `["project-access", projectId]`.
 *
 * Only the list the caller is looking at (`settle`) is awaited, so a dialog
 * or a toast settles as soon as that list shows the change. Everything else
 * refetches in the background.
 */
export function invalidateProjectMembership(
  queryClient: QueryClient,
  {
    projectId,
    workspaceId,
    settle = "members",
  }: {
    projectId: string;
    workspaceId?: string;
    settle?: "members" | "invitations";
  },
): Promise<void> {
  const settleKey =
    settle === "members"
      ? projectMembersKey(projectId)
      : projectInvitationsKey(projectId);
  const background: readonly (readonly unknown[])[] = [
    settle === "members"
      ? projectInvitationsKey(projectId)
      : projectMembersKey(projectId),
    projectMemberCandidatesKey(projectId),
    projectAssignableRolesKey(projectId),
    ["projects"],
    ["workspace-users"],
    ["project-access", projectId],
    ...(workspaceId
      ? [
          ["workspace", "full", workspaceId] as const,
          ["workspace-invites", workspaceId] as const,
        ]
      : []),
  ];
  for (const queryKey of background) {
    void queryClient.invalidateQueries({ queryKey });
  }
  return queryClient.invalidateQueries({ queryKey: settleKey });
}
