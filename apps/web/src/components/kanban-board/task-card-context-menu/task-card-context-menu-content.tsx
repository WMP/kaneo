import {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import type Task from "@/types/task";
import TaskActionsMenuItems, {
  type TaskActionsMenuKit,
} from "./task-actions-menu-items";

type TaskCardContext = {
  worskpaceId: string;
  projectId: string;
};

type TaskCardContextMenuContentProps = {
  task: Task;
  taskCardContext: TaskCardContext;
  onDeleteClick: () => void;
};

// The right-click ContextMenu* parts, in the shape TaskActionsMenuItems
// renders its item tree with (see TaskActionsDropdown for the matching
// left-click DropdownMenu* kit).
const contextMenuKit: TaskActionsMenuKit = {
  Item: ContextMenuItem,
  CheckboxItem: ContextMenuCheckboxItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

export default function TaskCardContextMenuContent({
  task,
  taskCardContext,
  onDeleteClick,
}: TaskCardContextMenuContentProps) {
  return (
    <ContextMenuContent className="w-46">
      <TaskActionsMenuItems
        task={task}
        taskCardContext={taskCardContext}
        onDeleteClick={onDeleteClick}
        kit={contextMenuKit}
      />
    </ContextMenuContent>
  );
}
