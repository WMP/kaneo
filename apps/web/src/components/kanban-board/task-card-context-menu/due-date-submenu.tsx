import { isBefore, isSameDay, startOfDay } from "date-fns";
import { Calendar, CalendarDays, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MonthGrid } from "@/components/common/date-picker/month-grid";
import {
  formatPickerDay,
  QUICK_DATE_LABEL_KEYS,
} from "@/components/common/date-picker/quick-date-labels";
import { getQuickDates } from "@/components/common/date-picker/quick-dates";
import { useUpdateTaskDueDate } from "@/hooks/mutations/task/use-update-task-due-date";
import { toast } from "@/lib/toast";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type Task from "@/types/task";
import type { TaskActionsMenuKit } from "./task-actions-menu-items";

// Renders with the menu kit of its host (right-click ContextMenu or the
// visible kebab DropdownMenu), like the rest of the shared task actions.
export function DueDateSubmenu({
  task,
  kit,
}: {
  task: Task;
  kit: TaskActionsMenuKit;
}) {
  const { Item, CheckboxItem, Separator, Sub, SubTrigger, SubContent } = kit;
  const { t } = useTranslation();
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const { mutateAsync: updateTaskDueDate } = useUpdateTaskDueDate();
  const value = task.dueDate ? new Date(task.dueDate) : null;
  const start = task.startDate ? new Date(task.startDate) : undefined;
  const quickDates = getQuickDates(new Date(), weekStartsOn).filter(
    (item) => !start || !isBefore(item.date, startOfDay(start)),
  );

  const setDueDate = async (date: Date | null) => {
    try {
      await updateTaskDueDate({
        ...task,
        dueDate: date?.toISOString() ?? null,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tasks:dueDate.updateError"),
      );
    }
  };

  return (
    <Sub>
      <SubTrigger>
        <Calendar className="size-3.5 text-muted-foreground" />
        <span>{t("tasks:dueDate.label")}</span>
      </SubTrigger>
      <SubContent className="w-60">
        {quickDates.map((item) => (
          <CheckboxItem
            key={item.id}
            checked={value ? isSameDay(value, item.date) : false}
            onCheckedChange={() => setDueDate(item.date)}
            closeOnClick
          >
            <Calendar className="size-3.5 text-muted-foreground" />
            <span className="flex-1 whitespace-nowrap">
              {t(QUICK_DATE_LABEL_KEYS[item.id])}
            </span>
            <span className="whitespace-nowrap text-muted-foreground text-xs">
              {formatPickerDay(item.date)}
            </span>
          </CheckboxItem>
        ))}
        <Separator />
        <Sub>
          <SubTrigger inset>
            <CalendarDays className="size-3.5 text-muted-foreground" />
            <span>{t("tasks:datePicker.pickDate")}</span>
          </SubTrigger>
          <SubContent className="w-65 p-0">
            <MonthGrid
              value={value}
              onSelect={setDueDate}
              disabled={start ? [{ before: start }] : []}
              marked={start}
              autoFocus={false}
            />
          </SubContent>
        </Sub>
        {value && (
          <Item inset className="[&>svg]:mx-0" onClick={() => setDueDate(null)}>
            <X className="size-3.5 text-muted-foreground" />
            <span>{t("tasks:dueDate.clear")}</span>
          </Item>
        )}
        {start && (
          <>
            <Separator />
            <p className="py-1.5 ps-8 pe-2 text-muted-foreground text-xs">
              {t("tasks:datePicker.startsOn", {
                date: formatPickerDay(start),
              })}
            </p>
          </>
        )}
      </SubContent>
    </Sub>
  );
}
