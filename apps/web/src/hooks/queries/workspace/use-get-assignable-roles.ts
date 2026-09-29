import { skipToken, useQuery } from "@tanstack/react-query";
import getAssignableRoles from "@/fetchers/workspace/get-assignable-roles";

export const assignableRolesQueryKey = (workspaceId: string | undefined) =>
  ["workspace-assignable-roles", workspaceId] as const;

function useGetAssignableRoles(workspaceId: string | undefined) {
  return useQuery({
    queryKey: assignableRolesQueryKey(workspaceId),
    queryFn: workspaceId ? () => getAssignableRoles(workspaceId) : skipToken,
  });
}

export default useGetAssignableRoles;
