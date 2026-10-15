import { useMemo } from "react";
import useGetWorkspaces from "@/hooks/queries/workspace/use-get-workspaces";
import { useWorkspacesWithPermission } from "@/hooks/queries/workspace/use-workspaces-with-permission";
import { useProjectPermission } from "@/hooks/use-project-permission";
import type { ProjectWithTasks } from "@/types/project";

const PROJECT_MOVE_TARGET = {
  project: ["create"],
  workspace: ["manage_settings"],
};

export function useProjectMoveTargets(
  project: ProjectWithTasks | undefined,
  isCurrentProject: boolean,
) {
  const { data: workspaces } = useGetWorkspaces();
  const moveCandidates = useMemo(
    () => (workspaces ?? []).filter((item) => item.id !== project?.workspaceId),
    [workspaces, project?.workspaceId],
  );
  const moveCandidateIds = useMemo(
    () => moveCandidates.map((item) => item.id),
    [moveCandidates],
  );
  const { allowed: canMoveInto, isError: moveTargetsFailed } =
    useWorkspacesWithPermission(moveCandidateIds, PROJECT_MOVE_TARGET);
  const moveTargets = useMemo(
    () => moveCandidates.filter((item) => canMoveInto.has(item.id)),
    [moveCandidates, canMoveInto],
  );
  // Moving takes the project out of its workspace: the API requires `update`
  // and `delete` in the caller's effective access IN THIS PROJECT (project role
  // for a project member), and `project:create` plus full access in the target
  // workspace (the caller's workspace role there, checked above).
  const {
    canUpdateProject,
    canDeleteProject,
    isCheckingPermissions: isCheckingProjectPermissions,
  } = useProjectPermission(project?.id);
  const canMoveFromSource =
    !isCheckingProjectPermissions && canUpdateProject() && canDeleteProject();
  const canShowMove =
    canMoveFromSource &&
    isCurrentProject &&
    (moveTargets.length > 0 || moveTargetsFailed);

  return { moveTargets, moveTargetsFailed, canShowMove };
}
