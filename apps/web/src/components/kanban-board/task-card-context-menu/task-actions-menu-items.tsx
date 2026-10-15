import {
  Archive,
  CircleDot,
  Clock,
  Copy,
  LinkIcon,
  Trash2,
  UserRound,
} from "lucide-react";
import type { ComponentType, MouseEvent, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PriorityGlyph } from "@/components/task-chips/priority-glyph";
import type getProjects from "@/fetchers/project/get-projects";
import { useDuplicateTask } from "@/hooks/mutations/task/use-duplicate-task";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useUpdateTaskAssignee } from "@/hooks/mutations/task/use-update-task-assignee";
import { useUpdateTaskDescription } from "@/hooks/mutations/task/use-update-task-description";
import { useUpdateTaskStatus } from "@/hooks/mutations/task/use-update-task-status";
import { useUpdateTaskPriority } from "@/hooks/mutations/task/use-update-task-status-priority";
import { useUpdateTaskTitle } from "@/hooks/mutations/task/use-update-task-title";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { useProjectMembers } from "@/hooks/queries/project-member/use-project-members";
import { useProjectPermission } from "@/hooks/use-project-permission";
import { getColumnIcon } from "@/lib/column";
import { generateLink } from "@/lib/generate-link";
import { getInitials } from "@/lib/get-initials";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { getPriorityIcon } from "@/lib/priority";
import { getTaskPath } from "@/lib/task-link";
import { toast } from "@/lib/toast";
import useProjectStore from "@/store/project";
import type Task from "@/types/task";
import { DueDateSubmenu } from "./due-date-submenu";

type TaskCardContext = {
  worskpaceId: string;
  workspaceSlug?: string | null;
  projectId: string;
};

type MenuItemKitProps = {
  className?: string;
  inset?: boolean;
  onClick?: (event: MouseEvent) => void;
  children?: ReactNode;
};

type MenuCheckboxItemKitProps = {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  closeOnClick?: boolean;
  className?: string;
  children?: ReactNode;
};

type MenuSubKitProps = {
  children?: ReactNode;
};

type MenuSubTriggerKitProps = {
  className?: string;
  inset?: boolean;
  children?: ReactNode;
};

type MenuSubContentKitProps = {
  className?: string;
  children?: ReactNode;
};

// The primitive components the item tree below is rendered with. Both the
// right-click ContextMenu* parts (`@/components/ui/context-menu`) and the
// left-click DropdownMenu* parts (`@/components/ui/menu`) wrap the same
// underlying Base UI menu primitives and share this shape, so this single
// item tree renders correctly, with identical behavior, under either kit.
export type TaskActionsMenuKit = {
  Item: ComponentType<MenuItemKitProps>;
  CheckboxItem: ComponentType<MenuCheckboxItemKitProps>;
  Separator: ComponentType<Record<string, never>>;
  Sub: ComponentType<MenuSubKitProps>;
  SubTrigger: ComponentType<MenuSubTriggerKitProps>;
  SubContent: ComponentType<MenuSubContentKitProps>;
};

type TaskActionsMenuItemsProps = {
  task: Task;
  taskCardContext: TaskCardContext;
  onDeleteClick: () => void;
  kit: TaskActionsMenuKit;
};

// Renders only the task actions (Copy link, Priority/Status/Due
// date/Assignee submenus, Duplicate, Archive, Mark as planned, Delete) —
// not the outer Content/Popup wrapper, so both the ContextMenu and the
// left-click dropdown can host the same tree without duplicating the
// hooks/handlers behind it.
export default function TaskActionsMenuItems({
  task,
  taskCardContext,
  onDeleteClick,
  kit,
}: TaskActionsMenuItemsProps) {
  const { Item, CheckboxItem, Separator, Sub, SubTrigger, SubContent } = kit;
  const { t } = useTranslation();
  const { project } = useProjectStore();
  const queryClient = useQueryClient();
  const { data: columnsData = [] } = useGetColumns(task.projectId);
  // Prefer the active store project's columns only when it IS this task's own
  // project. This menu is now shared by list/backlog/subtask rows, not just
  // the active board, so a task from another project must fall back to the
  // columns fetched for its own projectId rather than offering (and writing)
  // the active project's status slugs. Keyed on task.projectId (authoritative)
  // rather than the container's taskCardContext.projectId.
  const columns =
    project?.id === task.projectId &&
    project?.columns &&
    project.columns.length > 0
      ? project.columns.map((col) => ({
          slug: col.id,
          name: col.name,
          icon: col.icon,
          isFinal: col.isFinal,
        }))
      : columnsData.map((col) => ({
          slug: col.slug,
          name: col.name,
          icon: col.icon,
          isFinal: col.isFinal,
        }));
  const { data: workspaceUsers } = useProjectMembers(task.projectId);
  const { mutateAsync: updateTask } = useUpdateTask();
  const { mutateAsync: updateTaskPriority } = useUpdateTaskPriority();
  const { mutateAsync: updateTaskStatus } = useUpdateTaskStatus();
  const { mutateAsync: updateTaskAssignee } = useUpdateTaskAssignee();
  const { mutateAsync: updateTaskTitle } = useUpdateTaskTitle();
  const { mutateAsync: updateTaskDescription } = useUpdateTaskDescription();
  const { mutate: duplicateTask } = useDuplicateTask();
  const { canCreateTasks, canUpdateTasks, canDeleteTasks, canAssignTasks } =
    useProjectPermission(task.projectId);
  const canCreate = canCreateTasks();
  const canEdit = canUpdateTasks();
  const canDelete = canDeleteTasks();
  const canAssign = canAssignTasks();

  const usersOptions = useMemo(() => {
    return workspaceUsers?.members?.map((member) => ({
      label: member?.user?.name ?? member.userId,
      value: member.userId,
      image: member?.user?.image ?? "",
      name: member?.user?.name ?? "",
    }));
  }, [workspaceUsers]);

  const handleCopyTaskLink = async () => {
    const path = getTaskPath({
      workspaceId: taskCardContext.worskpaceId,
      workspace: {
        id: taskCardContext.worskpaceId,
        slug: taskCardContext.workspaceSlug,
      },
      projectId: taskCardContext.projectId,
      workspaceProjects: queryClient.getQueryData<
        Awaited<ReturnType<typeof getProjects>>
      >(["projects", taskCardContext.worskpaceId]),
      taskId: task.id,
      taskNumber: task.number,
      title: task.title,
    });
    const taskLink = generateLink(path);

    // navigator.clipboard is undefined on a non-secure (plain HTTP) origin — a
    // supported self-hosted single-instance deployment (see AGENTS.md) — and
    // writeText can also reject on a permission denial. Guard and await it so a
    // failure reports an error instead of throwing and falsely toasting success.
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("clipboard-unavailable");
      }
      await navigator.clipboard.writeText(taskLink);
      toast.success(t("tasks:contextMenu.copyLinkSuccess"));
    } catch {
      toast.error(t("tasks:contextMenu.copyLinkError"));
    }
  };

  const handleDuplicateTask = () => {
    duplicateTask({
      taskId: task.id,
      title: t("tasks:duplicate.titleSuffix", { title: task.title }),
    });
  };

  const handleChange = async (field: keyof Task, value: string | Date) => {
    try {
      switch (field) {
        case "priority":
          await updateTaskPriority({ ...task, priority: value as string });
          break;
        case "status":
          await updateTaskStatus({ ...task, status: value as string });
          break;
        case "userId":
          await updateTaskAssignee({ ...task, userId: value as string });
          break;
        case "title":
          await updateTaskTitle({ ...task, title: value as string });
          break;
        case "description":
          await updateTaskDescription({
            ...task,
            description: value as string,
          });
          break;
        default:
          await updateTask({
            ...task,
            [field]: value,
          });
      }
      // Only on success — a `finally` here would fire the success toast even
      // after the catch below already reported the failure, showing two
      // contradictory toasts for one failed update.
      toast.success(t("tasks:update.success"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tasks:update.error"),
      );
    }
  };

  return (
    <>
      <Item className="[&>svg]:mx-0" onClick={handleCopyTaskLink}>
        <LinkIcon className="size-3.5 text-muted-foreground" />
        <span>{t("tasks:contextMenu.copyLink")}</span>
      </Item>

      {(canEdit || canAssign) && <Separator />}

      {canEdit && (
        <Sub>
          <SubTrigger className="gap-2">
            <PriorityGlyph priority="high" />
            <span>{t("tasks:priority.label")}</span>
          </SubTrigger>
          <SubContent className="w-48">
            <CheckboxItem
              key="no-priority"
              checked={task.priority === "no-priority"}
              onCheckedChange={() => handleChange("priority", "no-priority")}
              closeOnClick
              className="[&_svg]:text-muted-foreground"
            >
              {getPriorityIcon("no-priority")}
              <span>{getPriorityLabel("no-priority")}</span>
            </CheckboxItem>
            {["low", "medium", "high", "urgent"].map((priority) => (
              <CheckboxItem
                key={priority}
                checked={task.priority === priority}
                onCheckedChange={() => handleChange("priority", priority)}
                closeOnClick
                className="[&_svg]:text-muted-foreground"
              >
                {getPriorityIcon(priority)}
                <span className="capitalize">{getPriorityLabel(priority)}</span>
              </CheckboxItem>
            ))}
          </SubContent>
        </Sub>
      )}

      {canEdit && (
        <Sub>
          <SubTrigger>
            <CircleDot className="size-3.5 text-muted-foreground" />
            <span>{t("tasks:status.label")}</span>
          </SubTrigger>
          <SubContent className="w-48">
            {columns.map((col) => (
              <CheckboxItem
                key={col.slug}
                checked={task.status === col.slug}
                onCheckedChange={() => handleChange("status", col.slug)}
                closeOnClick
                className="[&_svg]:text-muted-foreground"
              >
                {getColumnIcon(col.slug, col.isFinal, col.icon)}
                <span>{col.name}</span>
              </CheckboxItem>
            ))}
          </SubContent>
        </Sub>
      )}

      {canEdit && <DueDateSubmenu task={task} kit={kit} />}

      {canAssign && usersOptions && (
        <Sub>
          <SubTrigger>
            <UserRound className="size-3.5 text-muted-foreground" />
            <span>{t("tasks:assignee.label")}</span>
          </SubTrigger>
          <SubContent className="w-48">
            <CheckboxItem
              checked={!task.userId}
              onCheckedChange={() => handleChange("userId", "")}
              closeOnClick
            >
              <div
                className="w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center"
                title={t("tasks:assignee.unassigned")}
              >
                <span className="text-[10px] font-medium text-muted-foreground">
                  ?
                </span>{" "}
              </div>
              {t("tasks:assignee.unassigned")}
            </CheckboxItem>
            {usersOptions.map((user) => (
              <CheckboxItem
                key={user.value}
                checked={task.userId === user.value}
                onCheckedChange={() => handleChange("userId", user.value ?? "")}
                closeOnClick
              >
                <Avatar className="h-6 w-6">
                  <AvatarImage src={user.image ?? ""} alt={user.name || ""} />
                  <AvatarFallback className="text-xs font-medium border border-border/30">
                    {getInitials(user.name)}
                  </AvatarFallback>
                </Avatar>

                {user.label}
              </CheckboxItem>
            ))}
          </SubContent>
        </Sub>
      )}

      {(canCreate || canEdit || canDelete) && (
        <>
          {(canCreate || canEdit) && (
            <>
              <Separator />

              {canCreate && (
                <Item className="[&>svg]:mx-0" onClick={handleDuplicateTask}>
                  <Copy className="size-3.5 text-muted-foreground" />
                  <span>{t("tasks:actions.duplicate")}</span>
                </Item>
              )}

              {canEdit && (
                <>
                  <Item
                    className="[&>svg]:mx-0"
                    onClick={() => handleChange("status", "archived")}
                  >
                    <Archive className="size-3.5 text-muted-foreground" />
                    <span>{t("tasks:actions.archive")}</span>
                  </Item>
                  {task.status !== "planned" && (
                    <Item
                      className="[&>svg]:mx-0"
                      onClick={() => handleChange("status", "planned")}
                    >
                      <Clock className="size-3.5 text-muted-foreground" />
                      <span>{t("tasks:actions.markAsPlanned")}</span>
                    </Item>
                  )}
                </>
              )}
            </>
          )}

          {canDelete && (
            <>
              <Separator />

              <Item
                className="text-destructive [&>svg]:mx-0"
                onClick={(e) => {
                  e.preventDefault();
                  setTimeout(() => {
                    onDeleteClick();
                  }, 0);
                }}
              >
                <Trash2 className="size-3.5" />
                <span>{t("tasks:actions.delete")}</span>
              </Item>
            </>
          )}
        </>
      )}
    </>
  );
}
