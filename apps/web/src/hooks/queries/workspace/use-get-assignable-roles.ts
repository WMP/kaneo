import { skipToken, useQuery } from "@tanstack/react-query";
import getAssignableRoles from "@/fetchers/workspace/get-assignable-roles";
import { useGetActiveWorkspaceUser } from "@/hooks/queries/workspace-users/use-active-workspace-user";

// Prefix for invalidating every cached list of a workspace.
export const assignableRolesWorkspaceKey = (workspaceId: string | undefined) =>
  ["workspace-assignable-roles", workspaceId] as const;

// Keyed by the caller's role, like the capability map: what a caller may grant
// depends on their own role, so a demotion or promotion must not reuse the
// previous list.
export const assignableRolesQueryKey = (
  workspaceId: string | undefined,
  callerRole: string | undefined,
) => [...assignableRolesWorkspaceKey(workspaceId), callerRole] as const;

/**
 * Roles the current user may grant in the workspace.
 *
 * `isLoading` is true only while a request is actually pending or the caller's
 * own role is still being resolved. With no workspace the query is idle, which
 * is not loading: TanStack keeps `isPending` true for a disabled query that has
 * no data, so `isPending` would spin forever.
 */
function useGetAssignableRoles(workspaceId: string | undefined) {
  const { data: member, isLoading: isMemberLoading } =
    useGetActiveWorkspaceUser();
  const callerRole = member?.role as string | undefined;

  const query = useQuery({
    queryKey: assignableRolesQueryKey(workspaceId, callerRole),
    queryFn:
      workspaceId && callerRole
        ? () => getAssignableRoles(workspaceId)
        : skipToken,
  });

  return {
    ...query,
    isLoading: query.isLoading || (Boolean(workspaceId) && isMemberLoading),
  };
}

export default useGetAssignableRoles;
