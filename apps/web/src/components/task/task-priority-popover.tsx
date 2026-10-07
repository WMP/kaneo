import { Check } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  PickerList,
  PickerNoResults,
  PickerSearchInput,
} from "@/components/ui/picker-search-input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ShortcutNumber } from "@/components/ui/shortcut-number";
import { useUpdateTaskPriority } from "@/hooks/mutations/task/use-update-task-status-priority";
import { useNumberedShortcuts } from "@/hooks/use-numbered-shortcuts";
import { usePickerSearch } from "@/hooks/use-picker-search";
import { useProjectPermission } from "@/hooks/use-project-permission";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { getPriorityIcon } from "@/lib/priority";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

type TaskPriorityPopoverProps = {
  task: Task;
  children: React.ReactNode;
};

const priorityOptions = [
  { value: "no-priority" },
  { value: "low" },
  { value: "medium" },
  { value: "high" },
  { value: "urgent" },
];

const getPrioritySearchText = (priority: { value: string }) =>
  getPriorityLabel(priority.value);

export default function TaskPriorityPopover({
  task,
  children,
}: TaskPriorityPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    isSearching,
    filtered: filteredPriorityOptions,
  } = usePickerSearch(priorityOptions, getPrioritySearchText);
  const { mutateAsync: updateTaskPriority } = useUpdateTaskPriority();
  const { canUpdateTasks } = useProjectPermission(task.projectId);
  const canEdit = canUpdateTasks();

  const handlePriorityChange = useCallback(
    async (newPriority: string) => {
      try {
        await updateTaskPriority({
          ...task,
          priority: newPriority,
        });
        setOpen(false);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("tasks:popover.priority.updateError"),
        );
      }
    },
    [t, task, updateTaskPriority],
  );

  const shortcutOptions = useMemo(
    () =>
      filteredPriorityOptions.map((priority) => ({
        onSelect: () => handlePriorityChange(priority.value),
      })),
    [handlePriorityChange, filteredPriorityOptions],
  );

  useNumberedShortcuts(open, shortcutOptions);

  // Read-only role: render the trigger child as a plain element so the user
  // still sees the current priority but can't open the popover.
  if (!canEdit) return <>{children}</>;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setSearchQuery("");
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <PickerSearchInput
          value={searchQuery}
          onValueChange={setSearchQuery}
          placeholder={t("tasks:picker.search")}
          onEnter={() => {
            const first = filteredPriorityOptions[0];
            if (first) void handlePriorityChange(first.value);
          }}
        />
        <PickerList>
          {isSearching && filteredPriorityOptions.length === 0 && (
            <PickerNoResults>{t("tasks:picker.noResults")}</PickerNoResults>
          )}
          {filteredPriorityOptions.map((priority, index) => (
            <Button
              key={priority.value}
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 h-8 px-2 rounded-none first:rounded-t-md last:rounded-b-md"
              onClick={() => handlePriorityChange(priority.value)}
            >
              {getPriorityIcon(priority.value)}
              <span className="text-sm">
                {getPriorityLabel(priority.value)}
              </span>
              {task.priority === priority.value ? (
                <Check className="ml-auto h-4 w-4" />
              ) : (
                <ShortcutNumber number={index + 1} />
              )}
            </Button>
          ))}
        </PickerList>
      </PopoverContent>
    </Popover>
  );
}
