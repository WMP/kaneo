import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import useCreateTaskRelation from "@/hooks/mutations/task-relation/use-create-task-relation";
import useDeleteTaskRelation from "@/hooks/mutations/task-relation/use-delete-task-relation";
import { useProjectMembers } from "@/hooks/queries/project-member/use-project-members";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import useGetTaskRelations from "@/hooks/queries/task-relation/use-get-task-relations";
import { useProjectPermission } from "@/hooks/use-project-permission";
import { getColumnIcon } from "@/lib/column";
import { findAssignee } from "@/lib/find-assignee";
import { getInitials } from "@/lib/get-initials";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";
import SubtaskAssigneePopover from "./subtask-assignee-popover";
import SubtaskStatusPopover from "./subtask-status-popover";
import TaskRelationDependencyPopover from "./task-relation-dependency-popover";
import TaskRelationPickerDialog, {
  isDependencyRelationType,
  type RelationPick,
} from "./task-relation-picker";
import { isOtherProjectItem } from "./task-relations-cross-project";

type TaskRelationsProps = {
  taskId: string;
  projectId: string;
  workspaceId: string;
};

export default function TaskRelations({
  taskId,
  projectId,
  workspaceId,
}: TaskRelationsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(true);
  const [commandOpen, setCommandOpen] = useState(false);

  const { data: relations = [] } = useGetTaskRelations(taskId);
  const { data: projectData } = useGetTasks(projectId);
  const { data: workspaceUsers } = useProjectMembers(projectId);
  const createRelation = useCreateTaskRelation();
  const deleteRelation = useDeleteTaskRelation(taskId);
  const { canUpdateTasks } = useProjectPermission(projectId);
  const canEdit = canUpdateTasks();

  // Memoized so its reference only changes when `relations` actually does —
  // otherwise every render would hand groupedRelations and
  // existingRelatedTaskIds a fresh array and defeat their own memoization.
  const nonSubtaskRelations = useMemo(
    () => relations.filter((rel) => rel.relationType !== "subtask"),
    [relations],
  );

  const groupedRelations = useMemo(() => {
    const groups: Record<
      string,
      Array<{
        id: string;
        relationType: string;
        dependencyType: string;
        lagDays: number;
        task: NonNullable<(typeof nonSubtaskRelations)[number]["sourceTask"]>;
      }>
    > = {};

    for (const rel of nonSubtaskRelations) {
      const isSource = rel.sourceTaskId === taskId;
      const linkedTask = isSource ? rel.targetTask : rel.sourceTask;
      if (!linkedTask) continue;

      // "blocks" is directional: when the current task is the target it is the
      // one being blocked, so group it under a distinct "blocked_by" key.
      const type =
        rel.relationType === "blocks" && !isSource
          ? "blocked_by"
          : rel.relationType;
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push({
        id: rel.id,
        relationType: rel.relationType,
        dependencyType: rel.dependencyType,
        lagDays: rel.lagDays,
        task: linkedTask,
      });
    }

    return groups;
  }, [nonSubtaskRelations, taskId]);

  const existingRelatedTaskIds = useMemo(() => {
    const ids = new Set(
      nonSubtaskRelations.flatMap((rel) => [
        rel.sourceTaskId,
        rel.targetTaskId,
      ]),
    );
    ids.add(taskId);
    return ids;
  }, [nonSubtaskRelations, taskId]);

  const finalStatusSlugs = useMemo(() => {
    if (!projectData) return new Set<string>();
    if ("columns" in projectData && Array.isArray(projectData.columns)) {
      return new Set(
        (projectData.columns as Array<{ id: string; isFinal?: boolean }>)
          .filter((col) => col.isFinal)
          .map((col) => col.id),
      );
    }
    return new Set<string>();
  }, [projectData]);

  const columnIconBySlug = useMemo(() => {
    const icons = new Map<string, string | null | undefined>();
    if (!projectData) return icons;
    if ("columns" in projectData && Array.isArray(projectData.columns)) {
      for (const col of projectData.columns as Array<{
        id: string;
        icon?: string | null;
      }>) {
        icons.set(col.id, col.icon);
      }
    }
    return icons;
  }, [projectData]);

  const handleLinkTask = async ({
    task: pickedTask,
    relationType,
    dependencyType,
    lagDays,
  }: RelationPick): Promise<boolean> => {
    const isDependency = isDependencyRelationType(relationType);
    try {
      await createRelation.mutateAsync({
        // "Blocked by" stores the picked task as the blocker (source) of this
        // one; the other types start from this task.
        sourceTaskId: relationType === "blocked_by" ? pickedTask.id : taskId,
        targetTaskId: relationType === "blocked_by" ? taskId : pickedTask.id,
        relationType: isDependency ? "blocks" : "related",
        ...(isDependency ? { dependencyType, lagDays } : {}),
      });
      return true;
    } catch (error) {
      // The API returns a 409 both for an exact duplicate and for a "blocks"/
      // "subtask" edge that would close a cycle; only the latter carries
      // "circular" in its message, so callers see the specific reason rather
      // than the generic fallback.
      const isCircularDependency =
        error instanceof HttpError &&
        error.status === 409 &&
        error.message.toLowerCase().includes("circular");
      toast.error(
        t(
          isCircularDependency
            ? "tasks:relations.circularDependencyError"
            : "tasks:relations.linkError",
        ),
      );
      return false;
    }
  };

  const handleRemoveRelation = (relationId: string) => {
    deleteRelation.mutate(relationId);
  };

  // Related tasks can live in another project (cross-project linking), so the
  // route must use that task's own project id rather than the project this
  // panel is rendered for, or a cross-project item opens the wrong project
  // context (or 404s).
  const handleNavigateToTask = (
    linkedTaskId: string,
    linkedTaskProjectId: string,
  ) => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
      params: {
        workspaceId,
        projectId: linkedTaskProjectId,
        taskId: linkedTaskId,
      },
    });
  };

  // A related task may live in another project, where its assignee is not a
  // member of this one: fall back to the name the relation carries.
  const getAssignee = (userId: string | null, assigneeName: string | null) =>
    findAssignee(workspaceUsers?.members, userId, { name: assigneeName });

  const buildTaskObject = (item: {
    task: NonNullable<(typeof nonSubtaskRelations)[number]["sourceTask"]>;
  }): Task => ({
    id: item.task.id,
    title: item.task.title,
    number: item.task.number,
    description: null,
    status: item.task.status,
    priority: item.task.priority,
    startDate: null,
    dueDate: null,
    progress: 0,
    isMilestone: false,
    baselineStartDate: null,
    baselineDueDate: null,
    position: null,
    createdAt: "",
    updatedAt: "",
    userId: item.task.userId,
    assigneeId: item.task.userId,
    assigneeName: item.task.assigneeName,
    assigneeImage: "",
    projectId: item.task.projectId,
  });

  const totalCount = nonSubtaskRelations.length;

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {isOpen ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                <span>{t("tasks:relations.title")}</span>
              </button>
            </CollapsibleTrigger>
            {totalCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {totalCount}
              </span>
            )}
          </div>
          {canEdit && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => setCommandOpen(true)}
            >
              <Plus className="size-3.5" />
            </Button>
          )}
        </div>

        <CollapsibleContent>
          {Object.entries(groupedRelations).map(([type, items]) => (
            <div key={type} className="mt-1.5">
              <span className="text-[11px] text-muted-foreground/70 px-2">
                {t(`tasks:relations.types.${type}`, {
                  defaultValue: type.replace(/_/g, " "),
                })}
              </span>
              <div className="flex flex-col mt-0.5">
                {items.map((item) => {
                  const assignee = getAssignee(
                    item.task.userId,
                    item.task.assigneeName,
                  );
                  const taskObj = buildTaskObject(item);
                  // Column ids/slugs and "final" status are specific to one
                  // project's board, so a related task from another project
                  // must not be rendered with the current project's column
                  // metadata (its status id may not even exist there).
                  const isOtherProject = isOtherProjectItem(
                    item.task,
                    projectId,
                  );
                  const statusIcon = getColumnIcon(
                    item.task.status,
                    !isOtherProject && finalStatusSlugs.has(item.task.status),
                    isOtherProject
                      ? undefined
                      : columnIconBySlug.get(item.task.status),
                  );
                  const isFinalStatus =
                    !isOtherProject && finalStatusSlugs.has(item.task.status);

                  return (
                    <ContextMenu key={item.id}>
                      <ContextMenuTrigger asChild>
                        <div className="group flex items-center gap-2 py-1 px-2 rounded-md hover:bg-accent/50 transition-colors cursor-default">
                          {isOtherProject ? (
                            // The status columns belong to the other project's
                            // board, which isn't loaded here; rather than apply
                            // this project's columns to a task that lives
                            // elsewhere (and risk writing an invalid status),
                            // the control is read-only for cross-project items.
                            // A non-interactive `span` (not a `button`, which
                            // would be a keyboard focus-stop with no action)
                            // — `aria-label` stands in for the visible text a
                            // sighted user gets from the native `title`
                            // tooltip.
                            <span
                              // `role="img"` so `aria-label` is a supported
                              // attribute on this otherwise-generic span.
                              role="img"
                              title={t(
                                "tasks:relations.crossProjectStatusReadOnly",
                              )}
                              aria-label={t(
                                "tasks:relations.crossProjectStatusReadOnly",
                              )}
                              className="shrink-0 flex items-center justify-center rounded p-0.5 cursor-default [&_svg]:text-muted-foreground"
                            >
                              {statusIcon}
                            </span>
                          ) : (
                            <SubtaskStatusPopover
                              tasks={[taskObj]}
                              projectId={projectId}
                            >
                              <button
                                type="button"
                                className="shrink-0 flex items-center justify-center rounded p-0.5 transition-colors outline-none [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground"
                              >
                                {statusIcon}
                              </button>
                            </SubtaskStatusPopover>
                          )}

                          <button
                            type="button"
                            className="flex flex-1 min-w-0 items-center gap-1.5 text-left outline-none"
                            onClick={() =>
                              handleNavigateToTask(
                                item.task.id,
                                item.task.projectId,
                              )
                            }
                          >
                            {/* Task key (SLUG-number), shown whenever the
                                summary carries a slug and number, so a related
                                task is identifiable at a glance — especially a
                                cross-project one, whose slug differs from this
                                board's, reads as belonging elsewhere rather
                                than as a bare title. */}
                            {item.task.projectSlug &&
                              item.task.number !== null && (
                                <span className="shrink-0 font-mono text-[11px] text-muted-foreground/80">
                                  {item.task.projectSlug}-{item.task.number}
                                </span>
                              )}
                            <span
                              className={`text-sm truncate ${isFinalStatus ? "line-through text-muted-foreground" : "text-foreground/90"}`}
                            >
                              {item.task.title}
                            </span>
                          </button>

                          {(type === "blocks" || type === "blocked_by") && (
                            <TaskRelationDependencyPopover
                              relationId={item.id}
                              taskId={taskId}
                              // The edge belongs to its source task: the related
                              // task for a blocked_by row, this task for blocks.
                              projectId={
                                type === "blocked_by"
                                  ? item.task.projectId
                                  : projectId
                              }
                              dependencyType={item.dependencyType}
                              lagDays={item.lagDays}
                            >
                              <button
                                type="button"
                                className="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground/80 border border-border/60 hover:text-foreground hover:border-border transition-colors outline-none"
                                title={t(
                                  `tasks:relations.dependency.types.${item.dependencyType}`,
                                )}
                              >
                                {t(
                                  `tasks:relations.dependency.typesShort.${item.dependencyType}`,
                                  {
                                    defaultValue:
                                      item.dependencyType.toUpperCase(),
                                  },
                                )}
                                {item.lagDays !== 0 &&
                                  t("tasks:relations.dependency.lagSuffix", {
                                    days:
                                      item.lagDays > 0
                                        ? `+${item.lagDays}`
                                        : item.lagDays,
                                  })}
                              </button>
                            </TaskRelationDependencyPopover>
                          )}

                          <SubtaskAssigneePopover tasks={[taskObj]}>
                            <button
                              type="button"
                              className="shrink-0 flex items-center justify-center rounded p-0.5 transition-colors outline-none"
                            >
                              {item.task.userId && assignee ? (
                                <Avatar className="h-5 w-5">
                                  <AvatarImage
                                    src={assignee?.user?.image ?? ""}
                                    alt={assignee?.user?.name || ""}
                                  />
                                  <AvatarFallback className="text-[9px] font-medium border border-border/30">
                                    {getInitials(assignee?.user?.name)}
                                  </AvatarFallback>
                                </Avatar>
                              ) : (
                                <div
                                  className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border/70"
                                  title={t("tasks:popover.assignee.unassigned")}
                                >
                                  <span className="text-[9px] font-medium text-muted-foreground">
                                    ?
                                  </span>
                                </div>
                              )}
                            </button>
                          </SubtaskAssigneePopover>

                          {canEdit && (
                            <button
                              type="button"
                              className="shrink-0 flex items-center justify-center rounded p-0.5 text-muted-foreground opacity-0 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveRelation(item.id);
                              }}
                              aria-label={t("tasks:relations.removeRelation")}
                              title={t("tasks:relations.removeRelation")}
                            >
                              <X className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </ContextMenuTrigger>

                      <ContextMenuContent className="w-40">
                        <ContextMenuItem
                          onClick={() =>
                            handleNavigateToTask(
                              item.task.id,
                              item.task.projectId,
                            )
                          }
                        >
                          <span>{t("tasks:relations.openTask")}</span>
                        </ContextMenuItem>
                        {canEdit && (
                          <>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              className="text-destructive"
                              onClick={() => handleRemoveRelation(item.id)}
                            >
                              <span>{t("tasks:relations.removeRelation")}</span>
                            </ContextMenuItem>
                          </>
                        )}
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              </div>
            </div>
          ))}

          {totalCount === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-1">
              {t("tasks:relations.empty")}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>

      <TaskRelationPickerDialog
        open={commandOpen}
        onOpenChange={setCommandOpen}
        projectId={projectId}
        workspaceId={workspaceId}
        excludedTaskIds={existingRelatedTaskIds}
        onPick={handleLinkTask}
      />
    </>
  );
}
