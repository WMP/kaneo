import { Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_WORKING_DAYS } from "@/components/gantt/gantt-working-calendar";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { anchoredToastManager } from "@/components/ui/toast";
import useCreateHoliday from "@/hooks/mutations/calendar/use-create-holiday";
import useDeleteHoliday from "@/hooks/mutations/calendar/use-delete-holiday";
import useUpdateWorkingDays from "@/hooks/mutations/calendar/use-update-working-days";
import useGetCalendar from "@/hooks/queries/calendar/use-get-calendar";
import { formatDate } from "@/lib/format";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";

type WorkspaceCalendarSectionProps = {
  workspaceId: string | undefined;
  canEdit: boolean;
};

// The working calendar the Gantt schedule uses: which weekdays count as working
// days and the workspace's holidays.
export function WorkspaceCalendarSection({
  workspaceId,
  canEdit,
}: WorkspaceCalendarSectionProps) {
  const { t } = useTranslation();
  const { data: calendar, isLoading } = useGetCalendar(workspaceId);
  const updateWorkingDays = useUpdateWorkingDays();
  const createHoliday = useCreateHoliday();
  const deleteHoliday = useDeleteHoliday();
  const workingDays = calendar?.workingDays ?? DEFAULT_WORKING_DAYS;
  const holidays = calendar?.holidays ?? [];
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayName, setNewHolidayName] = useState("");
  const [holidayError, setHolidayError] = useState("");
  // The regular (fixed, bottom-right) toast can land right on top of this same
  // "Add holiday" button, which sits at the end of its own row: a plain toast
  // confirming the very click that just happened, covering the control that
  // triggered it. Anchoring this one success toast to the button itself keeps
  // it next to the action instead.
  const addHolidayButtonRef = useRef<HTMLButtonElement>(null);

  const handleToggleWorkingDay = useCallback(
    (bit: number, checked: boolean) => {
      if (!workspaceId) return;
      const nextWorkingDays = checked
        ? workingDays | (1 << bit)
        : workingDays & ~(1 << bit);

      updateWorkingDays
        .mutateAsync({ workspaceId, workingDays: nextWorkingDays })
        .then(() => {
          toast.success(
            t("settings:workspaceCalendar.toastWorkingDaysUpdated"),
          );
        })
        .catch((error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : t("settings:workspaceCalendar.toastWorkingDaysUpdateError"),
          );
        });
    },
    [workspaceId, workingDays, updateWorkingDays, t],
  );

  const handleAddHoliday = useCallback(async () => {
    if (!workspaceId) return;

    if (!newHolidayDate) {
      setHolidayError(t("settings:workspaceCalendar.dateRequired"));
      return;
    }

    const trimmedName = newHolidayName.trim();
    if (!trimmedName) {
      setHolidayError(t("settings:workspaceCalendar.holidayNameRequired"));
      return;
    }

    try {
      await createHoliday.mutateAsync({
        workspaceId,
        date: newHolidayDate,
        name: trimmedName,
      });
      anchoredToastManager.add({
        title: t("settings:workspaceCalendar.toastHolidayCreated"),
        type: "success",
        positionerProps: {
          anchor: addHolidayButtonRef.current,
          side: "top",
        },
      });
      setNewHolidayDate("");
      setNewHolidayName("");
      setHolidayError("");
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        toast.error(t("settings:workspaceCalendar.toastHolidayDuplicateError"));
        return;
      }
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:workspaceCalendar.toastHolidayCreateError"),
      );
    }
  }, [workspaceId, newHolidayDate, newHolidayName, createHoliday, t]);

  const handleDeleteHoliday = useCallback(
    async (holidayId: string) => {
      if (!workspaceId) return;

      try {
        await deleteHoliday.mutateAsync({ workspaceId, holidayId });
        toast.success(t("settings:workspaceCalendar.toastHolidayDeleted"));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("settings:workspaceCalendar.toastHolidayDeleteError"),
        );
      }
    },
    [workspaceId, deleteHoliday, t],
  );

  return (
    <>
      <SettingsSection
        title={t("settings:workspaceCalendar.title")}
        description={t("settings:workspaceCalendar.subtitle")}
      >
        <SettingsCard>
          <SettingsRow
            stack
            title={t("settings:workspaceCalendar.workingDaysTitle")}
            description={t("settings:workspaceCalendar.workingDaysSubtitle")}
          >
            <div className="flex flex-wrap gap-4">
              {[0, 1, 2, 3, 4, 5, 6].map((bit) => {
                const checked = (workingDays & (1 << bit)) !== 0;
                return (
                  <label
                    key={bit}
                    className="flex items-center gap-2 text-sm"
                    htmlFor={`working-day-${bit}`}
                  >
                    <Checkbox
                      id={`working-day-${bit}`}
                      checked={checked}
                      disabled={!canEdit || updateWorkingDays.isPending}
                      onCheckedChange={(value) =>
                        handleToggleWorkingDay(bit, value)
                      }
                    />
                    {t(`settings:workspaceCalendar.day_${bit}`)}
                  </label>
                );
              })}
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t("settings:workspaceCalendar.holidaysTitle")}
        description={t("settings:workspaceCalendar.holidaysSubtitle")}
      >
        {canEdit ? (
          <SettingsCard>
            <div className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-end">
              <div className="space-y-1">
                <Label
                  htmlFor="new-holiday-date"
                  className="text-xs text-muted-foreground"
                >
                  {t("settings:workspaceCalendar.dateLabel")}
                </Label>
                <Input
                  id="new-holiday-date"
                  type="date"
                  size="sm"
                  className="w-full sm:w-44"
                  value={newHolidayDate}
                  onChange={(event) => {
                    setNewHolidayDate(event.target.value);
                    setHolidayError("");
                  }}
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label
                  htmlFor="new-holiday-name"
                  className="text-xs text-muted-foreground"
                >
                  {t("settings:workspaceCalendar.nameLabel")}
                </Label>
                <Input
                  id="new-holiday-name"
                  size="sm"
                  className="w-full"
                  placeholder={t("settings:workspaceCalendar.namePlaceholder")}
                  value={newHolidayName}
                  onChange={(event) => {
                    setNewHolidayName(event.target.value);
                    setHolidayError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !createHoliday.isPending) {
                      void handleAddHoliday();
                    }
                  }}
                />
              </div>
              <Button
                ref={addHolidayButtonRef}
                type="button"
                size="sm"
                disabled={createHoliday.isPending}
                onClick={handleAddHoliday}
              >
                {t("settings:workspaceCalendar.addHoliday")}
              </Button>
            </div>
          </SettingsCard>
        ) : null}
        {holidayError ? (
          <p role="alert" className="text-sm text-destructive">
            {holidayError}
          </p>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            {t("settings:workspaceCalendar.loading")}
          </p>
        ) : holidays.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("settings:workspaceCalendar.empty")}
          </p>
        ) : (
          <SettingsCard>
            {holidays.map((holiday) => (
              <SettingsRow
                key={holiday.id}
                title={holiday.name}
                description={formatDate(holiday.date, { timeZone: "UTC" })}
              >
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("settings:workspaceCalendar.deleteHoliday")}
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    disabled={deleteHoliday.isPending}
                    onClick={() => handleDeleteHoliday(holiday.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : null}
              </SettingsRow>
            ))}
          </SettingsCard>
        )}
      </SettingsSection>
    </>
  );
}
