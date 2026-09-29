import { skipToken, useQuery } from "@tanstack/react-query";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import getAssignableRoles from "@/fetchers/workspace/get-assignable-roles";

// Prefix for invalidating every cached list of a workspace.
export const assignableRolesWorkspaceKey = (workspaceId: string | undefined) =>
  ["workspace-assignable-roles", workspaceId] as const;

// What a caller may grant depends on who they are, so the list is keyed by
// workspace and user. The caller's role is deliberately not part of the key: it
// is only cheaply known for the ACTIVE workspace, while the members page works
// on the route's workspace. Changes that alter the list (workspace roles
// created, edited or deleted, ownership transferred) invalidate the workspace
// prefix key explicitly.
export const assignableRolesQueryKey = (
  workspaceId: string | undefined,
  userId: string | undefined,
) => [...assignableRolesWorkspaceKey(workspaceId), userId] as const;

/**
 * Roles the current user may grant in the given workspace.
 *
 * `isLoading` is true while a request is pending or the session is still
 * resolving, and false for an idle query (no workspace, signed out). TanStack
 * keeps `isPending` true for a disabled query that has no data, so `isPending`
 * would spin forever there.
 */
function useGetAssignableRoles(workspaceId: string | undefined) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const userId = user?.id;

  const query = useQuery({
    queryKey: assignableRolesQueryKey(workspaceId, userId),
    queryFn:
      workspaceId && userId ? () => getAssignableRoles(workspaceId) : skipToken,
    // Keep showing the previous list while a new key loads (for example when
    // the session refreshes) so every Select does not flicker to a badge. Never
    // carry a list over to a different workspace.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === workspaceId ? previousData : undefined,
  });

  return {
    ...query,
    isLoading: query.isLoading || (Boolean(workspaceId) && isAuthLoading),
  };
}

export default useGetAssignableRoles;
