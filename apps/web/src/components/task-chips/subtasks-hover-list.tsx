import { useTranslation } from "react-i18next";
import { AssigneeAvatar } from "@/components/task/properties/assignee-avatar";
import { useProjectSlugs } from "@/components/task/sections/use-project-slugs";
import CircularProgress from "@/components/ui/circular-progress";
import useGetTaskRelations from "@/hooks/queries/task-relation/use-get-task-relations";
import { useProjectMembers } from "@/hooks/queries/project-member/use-project-members";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import { findAssignee } from "@/lib/find-assignee";
import type Task from "@/types/task";

type SubtasksHoverListProps = {
  taskId: string;
  projectId: string;
  workspaceId: string;
  onOpenTask: (task: Pick<Task, "id" | "projectId">) => void;
};

export function SubtasksHoverList({
  taskId,
  projectId,
  workspaceId,
  onOpenTask,
}: SubtasksHoverListProps) {
  const { t } = useTranslation();
  const { data: relations = [], isLoading } = useGetTaskRelations(taskId);
  const displayIdOf = useProjectSlugs(workspaceId);
  // The people of the parent task's project, never the whole workspace list.
  const { data: projectMembers } = useProjectMembers(projectId);

  const subtasks = relations.flatMap((relation) =>
    relation.relationType === "subtask" &&
    relation.sourceTaskId === taskId &&
    relation.targetTask
      ? [relation.targetTask]
      : [],
  );
  const completed = subtasks.filter((subtask) => subtask.isCompleted).length;

  return (
    <div className="flex w-72 max-w-[calc(100vw-2rem)] flex-col">
      <div className="flex h-9 items-center gap-2 border-border border-b px-3">
        <CircularProgress
          completed={completed}
          total={subtasks.length}
          size={14}
        />
        <span className="font-medium text-[13px] text-foreground">
          {t("tasks:subtasks.title")}
        </span>
        <span className="truncate text-muted-foreground text-xs">
          {t("tasks:subtasks.progress", {
            completed,
            total: subtasks.length,
          })}
        </span>
      </div>
      <div className="flex flex-col p-1">
        {isLoading ? (
          <p className="px-2 py-2 text-muted-foreground text-xs">
            {t("common:empty.loading")}
          </p>
        ) : (
          subtasks.map((subtask) => (
            <button
              key={subtask.id}
              type="button"
              onClick={() => onOpenTask(subtask)}
              className="flex h-8.5 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5">
                {getColumnIcon(subtask.status, subtask.isCompleted)}
              </span>
              <span className="w-13 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                {displayIdOf(subtask.projectId, subtask.number)}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[13px]",
                  subtask.isCompleted
                    ? "text-muted-foreground line-through"
                    : "text-foreground",
                )}
              >
                {subtask.title}
              </span>
              <AssigneeAvatar
                name={subtask.assigneeName}
                image={
                  findAssignee(projectMembers?.members, subtask.userId, {
                    name: subtask.assigneeName,
                  })?.user.image
                }
                assigned={Boolean(subtask.userId)}
              />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
