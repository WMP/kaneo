import { Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import type Task from "@/types/task";
import TaskActionsMenuItems, {
  type TaskActionsMenuKit,
} from "./task-actions-menu-items";

type TaskCardContext = {
  worskpaceId: string;
  projectId: string;
};

// The left-click DropdownMenu* parts, in the shape TaskActionsMenuItems
// renders its item tree with (see TaskCardContextMenuContent for the
// matching right-click ContextMenu* kit).
const dropdownKit: TaskActionsMenuKit = {
  Item: DropdownMenuItem,
  CheckboxItem: DropdownMenuCheckboxItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

type TaskActionsDropdownProps = {
  task: Task;
  taskCardContext: TaskCardContext;
  onDeleteClick: () => void;
  className?: string;
};

// A visible "more actions" trigger for the same task actions the right-click
// context menu already exposes (see TaskCardContextMenuContent). Right-click
// is undiscoverable on touch/trackpad, so this gives every card/row a
// left-click affordance without duplicating the action items themselves.
export default function TaskActionsDropdown({
  task,
  taskCardContext,
  onDeleteClick,
  className,
}: TaskActionsDropdownProps) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("tasks:contextMenu.moreActions")}
        className={cn(
          "inline-flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded border border-transparent text-muted-foreground opacity-0 outline-none transition-opacity hover:border-border/70 hover:bg-muted/55 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100 group-focus-within:opacity-100 data-popup-open:opacity-100 data-popup-open:bg-muted/55 pointer-coarse:opacity-100",
          className,
        )}
        // The card/row this trigger sits in handles its own click-to-open
        // navigation and, on the kanban card, a dnd-kit drag start — both of
        // which are wired via listeners on an ancestor element that these
        // events would otherwise bubble to.
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Ellipsis className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-46"
        align="end"
        onClick={(event) => event.stopPropagation()}
      >
        <TaskActionsMenuItems
          task={task}
          taskCardContext={taskCardContext}
          onDeleteClick={onDeleteClick}
          kit={dropdownKit}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
