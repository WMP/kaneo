import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import useGetLabelsByTask from "@/hooks/queries/label/use-get-labels-by-task";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useProjectMembers } from "@/hooks/queries/project-member/use-project-members";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { useProjectPermission } from "@/hooks/use-project-permission";
import { getDueDateStatus, isTaskCompleted } from "@/lib/due-date-status";
import { findAssignee } from "@/lib/find-assignee";
import { getStatusDisplayLabel } from "@/lib/i18n/domain";

export function useTaskProperties(
  taskId: string,
  projectId: string,
  workspaceId: string,
) {
  const { data: task } = useGetTask(taskId);
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { data: columns = [] } = useGetColumns(projectId);
  // The people of this project only: the API rejects anybody else.
  const { data: projectPeople } = useProjectMembers(projectId);
  const { data: labels = [] } = useGetLabelsByTask(taskId);
  const { data: workspaceProjects = [] } = useGetProjects({ workspaceId });
  // What the signed-in user may do in this task's project; the API decides, the
  // rail only shows the values read-only instead of opening pickers that fail.
  const permission = useProjectPermission(projectId);
  const checking = permission.isCheckingPermissions;

  const statusColumn = columns.find(
    (column) => column.slug === task?.status || column.id === task?.status,
  );

  return {
    task,
    project,
    labels,
    status: {
      label: getStatusDisplayLabel(task?.status ?? "", statusColumn?.name),
      isFinal: statusColumn?.isFinal ?? false,
      icon: statusColumn?.icon,
    },
    // An assignee who left the project is missing from the member list: fall
    // back to the name and image the task itself carries.
    assignee: findAssignee(projectPeople?.members, task?.userId, {
      name: task?.assigneeName,
      image: task?.assignees?.find((entry) => entry.userId === task.userId)
        ?.image,
    }),
    dueStatus: getDueDateStatus(
      task?.dueDate ?? null,
      isTaskCompleted(task?.status ?? "", columns),
    ),
    canMoveTask:
      Boolean(task) &&
      workspaceProjects.some((project) => project.id !== task?.projectId),
    can: {
      update: checking || permission.canUpdateTasks(),
      assign: checking || permission.canAssignTasks(),
      labels: checking || permission.canAttachLabels(),
    },
  };
}
