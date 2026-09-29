import { useQueries } from "@tanstack/react-query";
import getProjectAssignableRoles, {
  type AssignableProjectRole,
} from "@/fetchers/resource/get-project-assignable-roles";

export type ProjectRolesState = {
  isLoading: boolean;
  isError: boolean;
  /** Undefined until the list arrived (or when it failed without cached data). */
  roles: AssignableProjectRole[] | undefined;
};

// The project roles the caller may grant in each of the given projects, one
// query per project (the list depends on the caller's role IN that project).
// Returns a map by project id. Disabled while `enabled` is false.
function useProjectAssignableRoles(
  projectIds: string[],
  enabled: boolean,
): Record<string, ProjectRolesState> {
  const queries = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: ["project-assignable-roles", projectId],
      queryFn: () => getProjectAssignableRoles(projectId),
      enabled,
      staleTime: 0,
    })),
  });

  const byProject: Record<string, ProjectRolesState> = {};
  projectIds.forEach((projectId, index) => {
    const query = queries[index];
    byProject[projectId] = {
      isLoading: Boolean(query?.isLoading),
      isError: Boolean(query?.isError),
      roles: query?.data,
    };
  });
  return byProject;
}

export default useProjectAssignableRoles;
