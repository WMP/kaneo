import useGetProject from "@/hooks/queries/project/use-get-project";
import { useGetWorkspaceColumns } from "@/hooks/queries/workspace-column/use-get-workspace-columns";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

/**
 * Whether the workspace of a project enforces its columns (every project then
 * has exactly the workspace columns and cannot change them), and whether the
 * caller may open the workspace page that changes them. The API refuses
 * project column changes either way; this only drives the UI.
 */
export function useProjectColumnsEnforcement(projectId: string) {
  const { workspace, canUpdateProjects } = useWorkspacePermission();
  const { data: project, isLoading: projectLoading } = useGetProject({
    id: projectId,
    workspaceId: workspace?.id ?? "",
  });
  const workspaceId = project?.workspaceId ?? "";
  const { data: workspaceColumns, isLoading: columnsLoading } =
    useGetWorkspaceColumns(workspaceId);

  return {
    enforced: workspaceColumns?.enforced === true,
    isLoading: projectLoading || columnsLoading,
    // The workspace page works on the active workspace.
    canManageWorkspaceColumns:
      Boolean(workspaceId) &&
      workspace?.id === workspaceId &&
      canUpdateProjects(),
  };
}
