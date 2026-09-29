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
 */
export function invalidateProjectMembership(
  queryClient: QueryClient,
  { projectId, workspaceId }: { projectId: string; workspaceId?: string },
) {
  const keys: readonly (readonly unknown[])[] = [
    projectMembersKey(projectId),
    projectMemberCandidatesKey(projectId),
    projectAssignableRolesKey(projectId),
    projectInvitationsKey(projectId),
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
  return Promise.all(
    keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}
