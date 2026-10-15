import { useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";
import { ReferenceAssigneeButton } from "./sections/reference-assignee-button";
import { ReferenceStatusButton } from "./sections/reference-status-button";
import { type RelationKind, RelationTag } from "./sections/relation-tag";
import { SectionAddButton } from "./sections/section-add-button";
import { SectionHeader } from "./sections/section-header";
import { TaskReferenceRow } from "./sections/task-reference-row";
import { useProjectSlugs } from "./sections/use-project-slugs";
import SubtaskStatusPopover from "./subtask-status-popover";
import {
  buildRelationLink,
  findParentRelation,
  unpickableTaskIds,
} from "./task-relation-link";
import TaskRelationDependencyPopover from "./task-relation-dependency-popover";
import TaskRelationPickerDialog, {
  isDependencyRelationType,
  type PickerRelationType,
  type RelationPick,
} from "./task-relation-picker";
import {
  type RelationPickerMode,
  useRelationPickerStore,
} from "./task-relation-picker-store";
import {
  isOtherProjectItem,
  type PickerTaskItem,
} from "./task-relations-cross-project";

const relationOrder: Record<RelationKind, number> = {
  blocked_by: 0,
  blocks: 1,
  related: 2,
};

// The shortcut store speaks "blockedBy"; the picker's own kind is "blocked_by".
const PICKER_KIND: Record<
  Exclude<RelationPickerMode, "parent">,
  PickerRelationType
> = {
  related: "related",
  blocks: "blocks",
  blockedBy: "blocked_by",
};

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
  const [commandOpen, setCommandOpen] = useState(false);
  // How the picker was opened: from the add button (null) or by a shortcut
  // that already knows the kind (or that the task's parent is being set).
  const [pickerMode, setPickerMode] = useState<RelationPickerMode | null>(null);
  const relationRequest = useRelationPickerStore((state) => state.request);
  const clearRelationRequest = useRelationPickerStore((state) => state.clear);

  const { data: relations = [] } = useGetTaskRelations(taskId);
  const { data: projectData } = useGetTasks(projectId, {
    refetchOnMount: false,
  });
  const { data: workspaceUsers } = useProjectMembers(projectId);
  const createRelation = useCreateTaskRelation();
  const deleteRelation = useDeleteTaskRelation(taskId);
  const { canUpdateTasks } = useProjectPermission(projectId);
  const canEdit = canUpdateTasks();
  const displayIdOf = useProjectSlugs(workspaceId);

  useEffect(() => {
    if (!relationRequest || relationRequest.taskId !== taskId) return;
    clearRelationRequest();
    if (!canEdit) return;
    setPickerMode(relationRequest.mode);
    setCommandOpen(true);
  }, [relationRequest, taskId, canEdit, clearRelationRequest]);

  const handlePickerOpenChange = (open: boolean) => {
    setCommandOpen(open);
    if (!open) setPickerMode(null);
  };

  // Memoized so its reference only changes when `relations` actually does.
  const nonSubtaskRelations = useMemo(
    () => relations.filter((rel) => rel.relationType !== "subtask"),
    [relations],
  );

  const linkedRelations = useMemo(
    () =>
      nonSubtaskRelations
        .flatMap((rel) => {
          const isSource = rel.sourceTaskId === taskId;
          const linkedTask = isSource ? rel.targetTask : rel.sourceTask;
          if (!linkedTask) return [];
          // "blocks" is directional: when the current task is the target it is
          // the one being blocked.
          const kind: RelationKind =
            rel.relationType === "blocks"
              ? isSource
                ? "blocks"
                : "blocked_by"
              : "related";
          return [
            {
              id: rel.id,
              kind,
              dependencyType: rel.dependencyType,
              lagDays: rel.lagDays,
              task: linkedTask,
            },
          ];
        })
        .sort((a, b) => relationOrder[a.kind] - relationOrder[b.kind]),
    [nonSubtaskRelations, taskId],
  );

  const excludedTaskIds = useMemo(
    () =>
      unpickableTaskIds(
        pickerMode === "parent" ? "parent" : "related",
        taskId,
        relations,
      ),
    [pickerMode, relations, taskId],
  );

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

  const reportLinkError = (error: unknown) => {
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
  };

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
      reportLinkError(error);
      return false;
    }
  };

  // A task has one parent: linking a new one replaces the previous link.
  const handleSetParent = async (pickedTask: PickerTaskItem) => {
    const previousParent = findParentRelation(taskId, relations);
    try {
      await createRelation.mutateAsync(
        buildRelationLink("parent", taskId, pickedTask.id),
      );
      if (previousParent) {
        await deleteRelation.mutateAsync(previousParent.id);
      }
      return true;
    } catch (error) {
      reportLinkError(error);
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
      <section className="flex flex-col gap-1">
        <SectionHeader
          title={t("tasks:relations.title")}
          meta={
            totalCount > 0 && (
              <span className="text-muted-foreground text-xs tabular-nums">
                {totalCount}
              </span>
            )
          }
          action={
            canEdit && (
              <SectionAddButton
                aria-label={`${t("tasks:subtasks.addAction")} ${t("tasks:relations.title")}`}
                onClick={() => setCommandOpen(true)}
              />
            )
          }
        />

        <div className="flex flex-col">
          {linkedRelations.map((item) => {
            const assignee = getAssignee(
              item.task.userId,
              item.task.assigneeName,
            );
            const taskObj = buildTaskObject(item);
            // Column ids/slugs and "final" status are specific to one
            // project's board, so a related task from another project must
            // not be rendered with the current project's column metadata (its
            // status id may not even exist there).
            const isOtherProject = isOtherProjectItem(item.task, projectId);
            const isFinalStatus =
              !isOtherProject && finalStatusSlugs.has(item.task.status);
            const statusIcon = getColumnIcon(
              item.task.status,
              isFinalStatus,
              isOtherProject
                ? undefined
                : columnIconBySlug.get(item.task.status),
            );
            const isDependency =
              item.kind === "blocks" || item.kind === "blocked_by";

            return (
              <ContextMenu key={item.id}>
                <ContextMenuTrigger asChild>
                  <TaskReferenceRow
                    status={
                      isOtherProject ? (
                        // The status columns belong to the other project's
                        // board, which isn't loaded here; rather than apply
                        // this project's columns to a task that lives
                        // elsewhere (and risk writing an invalid status), the
                        // control is read-only for cross-project items. A
                        // non-interactive `span` (not a `button`, which would
                        // be a keyboard focus-stop with no action).
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
                          className="flex size-3.5 shrink-0 cursor-default items-center justify-center text-muted-foreground [&_svg]:size-3.5"
                        >
                          {statusIcon}
                        </span>
                      ) : (
                        <SubtaskStatusPopover
                          tasks={[taskObj]}
                          projectId={projectId}
                        >
                          <ReferenceStatusButton
                            aria-label={t("tasks:status.label")}
                          >
                            {statusIcon}
                          </ReferenceStatusButton>
                        </SubtaskStatusPopover>
                      )
                    }
                    // The key (SLUG-number) comes from the relation summary
                    // when it carries one, so a cross-project task reads as
                    // belonging elsewhere rather than as a bare title.
                    displayId={
                      item.task.projectSlug && item.task.number != null
                        ? `${item.task.projectSlug}-${item.task.number}`
                        : displayIdOf(item.task.projectId, item.task.number)
                    }
                    title={item.task.title}
                    done={isFinalStatus}
                    onOpen={() =>
                      handleNavigateToTask(item.task.id, item.task.projectId)
                    }
                    tag={
                      <>
                        <RelationTag kind={item.kind} />
                        {isDependency && (
                          <TaskRelationDependencyPopover
                            relationId={item.id}
                            taskId={taskId}
                            // The edge belongs to its source task: the related
                            // task for a blocked_by row, this task for blocks.
                            projectId={
                              item.kind === "blocked_by"
                                ? item.task.projectId
                                : projectId
                            }
                            dependencyType={item.dependencyType}
                            lagDays={item.lagDays}
                          >
                            <button
                              type="button"
                              className="shrink-0 rounded border border-border/60 px-1 py-0.5 font-medium text-[10px] text-muted-foreground/80 tabular-nums outline-none transition-colors hover:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
                      </>
                    }
                    assignee={
                      <ReferenceAssigneeButton
                        tasks={[taskObj]}
                        name={assignee?.user?.name ?? item.task.assigneeName}
                        image={assignee?.user?.image}
                      />
                    }
                    actions={
                      canEdit && (
                        <button
                          type="button"
                          className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground opacity-0 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive-foreground focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRemoveRelation(item.id);
                          }}
                          aria-label={t("tasks:relations.removeRelation")}
                          title={t("tasks:relations.removeRelation")}
                        >
                          <X className="size-3.5" />
                        </button>
                      )
                    }
                  />
                </ContextMenuTrigger>

                <ContextMenuContent className="w-40">
                  <ContextMenuItem
                    onClick={() =>
                      handleNavigateToTask(item.task.id, item.task.projectId)
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

          {totalCount === 0 && (
            <p className="px-2 py-1 text-muted-foreground text-xs">
              {t("tasks:relations.empty")}
            </p>
          )}
        </div>
      </section>

      <TaskRelationPickerDialog
        open={commandOpen}
        onOpenChange={handlePickerOpenChange}
        projectId={projectId}
        workspaceId={workspaceId}
        excludedTaskIds={excludedTaskIds}
        onPick={handleLinkTask}
        initialRelationType={
          pickerMode && pickerMode !== "parent"
            ? PICKER_KIND[pickerMode]
            : undefined
        }
        parentMode={pickerMode === "parent"}
        onPickParent={handleSetParent}
      />
    </>
  );
}
