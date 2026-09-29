import { useQuery } from "@tanstack/react-query";
import getProjectAssignableRoles from "@/fetchers/project-member/get-project-assignable-roles";
import { projectAssignableRolesKey } from "@/lib/project-member-keys";

/**
 * Roles the current user may hand out as a project role in this project. What
 * a caller may grant depends on their own role there, which can change without
 * this client hearing about it, so every mount reads it again.
 */
function useGetProjectAssignableRoles(
  projectId: string | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: projectAssignableRolesKey(projectId),
    queryFn: () => getProjectAssignableRoles(projectId ?? ""),
    enabled: !!projectId && enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export default useGetProjectAssignableRoles;
