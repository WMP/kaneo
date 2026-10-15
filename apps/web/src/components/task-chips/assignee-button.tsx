import { useTranslation } from "react-i18next";
import TaskAssigneePopover from "@/components/task/task-assignee-popover";
import AssigneeAvatars, {
  resolveTaskAssignees,
} from "@/components/task/assignee-avatars";
import { AssigneeAvatar } from "@/components/task/properties/assignee-avatar";
import { UnassignedAvatar } from "@/components/common/unassigned-avatar";
import { cn } from "@/lib/cn";
import type Task from "@/types/task";
import { stopCardEvents } from "./stop-card-events";

type AssigneeButtonProps = {
  task: Task;
  workspaceId: string;
  name: string | null | undefined;
  image: string | null | undefined;
  avatarClassName?: string;
  avatarFallbackClassName?: string;
};

export function AssigneeButton({
  task,
  workspaceId,
  name,
  image,
  avatarClassName,
  avatarFallbackClassName,
}: AssigneeButtonProps) {
  const { t } = useTranslation();
  // A task can have several assignees (people and resources); the primary
  // one alone is not the whole picture.
  const assignees = resolveTaskAssignees(task);
  const single = assignees.length === 1 ? assignees[0] : null;
  const isPlainUser = Boolean(single?.userId) && !single?.kind;
  const names = assignees
    .map((assignee) => assignee.name)
    .filter(Boolean)
    .join(", ");
  const label =
    assignees.length === 0
      ? t("tasks:assignee.unassigned")
      : assignees.length === 1
        ? single?.name || name || t("tasks:assignee.label")
        : names || t("tasks:assignee.label");

  return (
    <TaskAssigneePopover task={task} workspaceId={workspaceId}>
      <button
        type="button"
        aria-label={label}
        title={label}
        className="relative flex shrink-0 cursor-pointer rounded-full outline-none ring-offset-1 ring-offset-board-card transition-shadow before:absolute before:-inset-1 hover:ring-2 hover:ring-chip-border-hover focus-visible:ring-[3px] focus-visible:ring-board-card-ring data-popup-open:ring-2 data-popup-open:ring-chip-border-open"
        {...stopCardEvents}
      >
        {assignees.length === 0 ? (
          <UnassignedAvatar className={cn("size-4.5", avatarClassName)} />
        ) : isPlainUser ? (
          <AssigneeAvatar
            name={name || single?.name}
            image={image || single?.image}
            assigned
            className={avatarClassName}
            fallbackClassName={avatarFallbackClassName}
          />
        ) : (
          <AssigneeAvatars
            assignees={assignees}
            avatarClassName={cn("size-4.5", avatarClassName)}
          />
        )}
      </button>
    </TaskAssigneePopover>
  );
}
