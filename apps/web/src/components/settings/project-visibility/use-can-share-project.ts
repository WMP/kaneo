import { useProjectPermission } from "@/hooks/use-project-permission";

// Whether the caller may change the project's public visibility, answered by
// the API for this project (its role grants `share` inside the project).
export function useCanShareProject(projectId: string | undefined) {
  const { canShareProject } = useProjectPermission(projectId);
  return canShareProject();
}
