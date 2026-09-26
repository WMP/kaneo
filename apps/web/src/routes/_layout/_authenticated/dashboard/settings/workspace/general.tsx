import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { DEFAULT_WORKING_DAYS } from "@/components/gantt/gantt-working-calendar";
import PageTitle from "@/components/page-title";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { anchoredToastManager } from "@/components/ui/toast";
import useCreateHoliday from "@/hooks/mutations/calendar/use-create-holiday";
import useDeleteHoliday from "@/hooks/mutations/calendar/use-delete-holiday";
import useUpdateWorkingDays from "@/hooks/mutations/calendar/use-update-working-days";
import useDeleteWorkspace from "@/hooks/mutations/workspace/use-delete-workspace";
import useTransferWorkspaceOwnership from "@/hooks/mutations/workspace/use-transfer-workspace-ownership";
import useUpdateWorkspace from "@/hooks/mutations/workspace/use-update-workspace";
import useUpdateWorkspaceActivityRetention from "@/hooks/mutations/workspace/use-update-workspace-activity-retention";
import useGetCalendar from "@/hooks/queries/calendar/use-get-calendar";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useGetFullWorkspace from "@/hooks/queries/workspace/use-get-full-workspace";
import useGetWorkspaceActivityRetention from "@/hooks/queries/workspace/use-get-workspace-activity-retention";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/general",
)({
  component: RouteComponent,
});

type WorkspaceFormValues = {
  name: string;
  description?: string;
};

type NormalizedWorkspaceValues = {
  name: string;
  description: string;
};

function normalizeWorkspaceValues(
  data: WorkspaceFormValues,
): NormalizedWorkspaceValues {
  return {
    name: data.name.trim(),
    description: (data.description ?? "").trim(),
  };
}

/** Better Auth persists description as an organization additional field (DB column), not only inside metadata. */
function getWorkspaceDescription(
  workspace:
    | { description?: string | null; metadata?: unknown }
    | null
    | undefined,
): string {
  if (!workspace) return "";
  if (typeof workspace.description === "string") {
    return workspace.description;
  }
  if (
    typeof workspace.metadata === "object" &&
    workspace.metadata &&
    "description" in workspace.metadata
  ) {
    return String(
      (workspace.metadata as { description?: unknown }).description ?? "",
    );
  }
  return "";
}

function RouteComponent() {
  const { t } = useTranslation();
  const workspaceSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(1, t("settings:workspaceGeneral.validation.nameRequired"))
          .min(2, t("settings:workspaceGeneral.validation.nameShort")),
        description: z.string().optional(),
      }),
    [t],
  );

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const queuedSaveRef = useRef<WorkspaceFormValues | null>(null);
  const lastSavedRef = useRef<NormalizedWorkspaceValues | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [selectedNewOwnerId, setSelectedNewOwnerId] = useState<string>("");

  const { user: currentUser } = useAuth();
  const { data: workspace } = useActiveWorkspace();
  const { data: fullWorkspace } = useGetFullWorkspace({
    workspaceId: workspace?.id,
  });
  const { mutateAsync: updateWorkspace } = useUpdateWorkspace();
  const { mutateAsync: deleteWorkspace, isPending: isDeleting } =
    useDeleteWorkspace();
  const { mutateAsync: transferOwnership, isPending: isTransferring } =
    useTransferWorkspaceOwnership();
  const { canManageWorkspace, canDeleteWorkspace, isOwner } =
    useWorkspacePermission();
  const canEdit = canManageWorkspace();
  const canDelete = canDeleteWorkspace();
  const workspaceDescription = getWorkspaceDescription(workspace);

  const { data: calendar, isLoading: isCalendarLoading } = useGetCalendar(
    workspace?.id,
  );
  const updateWorkingDays = useUpdateWorkingDays();
  const createHoliday = useCreateHoliday();
  const deleteHoliday = useDeleteHoliday();
  const workingDays = calendar?.workingDays ?? DEFAULT_WORKING_DAYS;
  const holidays = calendar?.holidays ?? [];
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayName, setNewHolidayName] = useState("");
  const [holidayError, setHolidayError] = useState("");
  // The regular (fixed, bottom-right) toast can land right on top of this
  // same "Add holiday" button, which sits at the end of its own row — a
  // plain toast confirming the very click that just happened, covering the
  // control that triggered it. Anchoring this one success toast to the
  // button itself (see handleAddHoliday) keeps it next to the action
  // instead.
  const addHolidayButtonRef = useRef<HTMLButtonElement>(null);
  const { data: activityRetention } = useGetWorkspaceActivityRetention(
    workspace?.id,
  );
  const { mutateAsync: updateActivityRetention, isPending: isSavingRetention } =
    useUpdateWorkspaceActivityRetention();
  const [retentionDaysInput, setRetentionDaysInput] = useState("");

  useEffect(() => {
    setRetentionDaysInput(
      activityRetention?.activityRetentionDays
        ? String(activityRetention.activityRetentionDays)
        : "",
    );
  }, [activityRetention]);

  const retentionDirty =
    (activityRetention?.activityRetentionDays
      ? String(activityRetention.activityRetentionDays)
      : "") !== retentionDaysInput;

  const handleSaveRetention = useCallback(async () => {
    if (!workspace?.id) return;

    const trimmed = retentionDaysInput.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);

    if (
      parsed !== null &&
      (!Number.isInteger(parsed) || parsed < 0 || parsed > 3650)
    ) {
      toast.error(
        t("settings:workspaceGeneral.activityRetention.toastUpdateError"),
      );
      return;
    }

    try {
      await updateActivityRetention({
        workspaceId: workspace.id,
        activityRetentionDays: parsed,
      });
      toast.success(
        t("settings:workspaceGeneral.activityRetention.toastUpdated"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:workspaceGeneral.activityRetention.toastUpdateError"),
      );
    }
  }, [workspace?.id, retentionDaysInput, updateActivityRetention, t]);

  // Ownership transfer is owner-only. Eligible recipients are any current
  // member who isn't the owner themselves.
  const members = fullWorkspace?.members ?? [];
  const currentOwnerMember = members.find((m) => m.role === "owner");
  const eligibleNewOwners = members.filter(
    (m) => m.role !== "owner" && m.userId !== currentUser?.id,
  );
  const selectedMember = eligibleNewOwners.find(
    (m) => m.id === selectedNewOwnerId,
  );

  const workspaceForm = useForm<WorkspaceFormValues>({
    resolver: standardSchemaResolver(workspaceSchema),
    mode: "onChange",
    defaultValues: {
      name: workspace?.name || "",
      description: workspaceDescription,
    },
  });

  useEffect(() => {
    if (!workspace) return;

    const nextValues = {
      name: workspace.name || "",
      description: workspaceDescription,
    };
    lastSavedRef.current = normalizeWorkspaceValues(nextValues);

    if (!workspaceForm.formState.isDirty) {
      workspaceForm.reset(nextValues);
    }
  }, [workspace, workspaceDescription, workspaceForm]);

  const saveWorkspace = useCallback(
    async (data: WorkspaceFormValues) => {
      if (!workspace?.id) return;

      const normalizedData = normalizeWorkspaceValues(data);
      const nameChanged = lastSavedRef.current?.name !== normalizedData.name;
      const descriptionChanged =
        lastSavedRef.current?.description !== normalizedData.description;
      const hasChanges = nameChanged || descriptionChanged;

      if (!hasChanges) return;

      if (isSavingRef.current) {
        queuedSaveRef.current = data;
        return;
      }

      isSavingRef.current = true;

      try {
        const updatePayload: {
          workspaceId: string;
          name?: string;
          description?: string;
        } = {
          workspaceId: workspace.id,
        };

        if (nameChanged) {
          updatePayload.name = normalizedData.name;
        }

        if (descriptionChanged) {
          updatePayload.description = normalizedData.description;
        }

        await updateWorkspace(updatePayload);

        workspaceForm.reset(normalizedData, { keepDirty: false });
        lastSavedRef.current = normalizedData;
        queuedSaveRef.current = null;

        await queryClient.invalidateQueries({
          queryKey: ["active-organization"],
        });
        toast.success(t("settings:workspaceGeneral.toastUpdated"));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("settings:workspaceGeneral.toastUpdateError"),
        );
      } finally {
        isSavingRef.current = false;

        if (queuedSaveRef.current) {
          const queuedData = queuedSaveRef.current;
          queuedSaveRef.current = null;
          await saveWorkspace(queuedData);
        }
      }
    },
    [workspace, updateWorkspace, queryClient, workspaceForm, t],
  );

  const handleTransferOwnership = useCallback(async () => {
    if (!workspace?.id || !currentOwnerMember || !selectedMember) return;

    try {
      await transferOwnership({
        workspaceId: workspace.id,
        newOwnerMemberId: selectedMember.id,
        currentOwnerMemberId: currentOwnerMember.id,
      });
      toast.success(
        t("settings:workspaceGeneral.transferOwnership.toastSuccess", {
          defaultValue: "Ownership transferred",
        }),
      );
      setIsTransferModalOpen(false);
      setSelectedNewOwnerId("");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:workspaceGeneral.transferOwnership.toastError", {
              defaultValue: "Failed to transfer ownership",
            }),
      );
    }
  }, [workspace?.id, currentOwnerMember, selectedMember, transferOwnership, t]);

  const handleDeleteWorkspace = useCallback(async () => {
    if (!workspace?.id) return;

    try {
      await deleteWorkspace({ workspaceId: workspace.id });
      toast.success(t("settings:workspaceGeneral.toastDeleted"));

      // Invalidate all workspace-related queries
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      await queryClient.invalidateQueries({
        queryKey: ["active-organization"],
      });

      navigate({ to: "/dashboard" });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:workspaceGeneral.toastDeleteError"),
      );
    }
  }, [workspace?.id, deleteWorkspace, queryClient, navigate, t]);

  const handleToggleWorkingDay = useCallback(
    (bit: number, checked: boolean) => {
      if (!workspace?.id) return;
      const nextWorkingDays = checked
        ? workingDays | (1 << bit)
        : workingDays & ~(1 << bit);

      updateWorkingDays
        .mutateAsync({
          workspaceId: workspace.id,
          workingDays: nextWorkingDays,
        })
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
    [workspace?.id, workingDays, updateWorkingDays, t],
  );

  const handleAddHoliday = useCallback(async () => {
    if (!workspace?.id) return;

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
        workspaceId: workspace.id,
        date: newHolidayDate,
        name: trimmedName,
      });
      // Anchored to the button itself (see addHolidayButtonRef above)
      // rather than the app's usual fixed bottom-right toast() helper, so it
      // never covers the very button someone just clicked.
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
  }, [workspace?.id, newHolidayDate, newHolidayName, createHoliday, t]);

  const handleDeleteHoliday = useCallback(
    async (holidayId: string) => {
      if (!workspace?.id) return;

      try {
        await deleteHoliday.mutateAsync({
          workspaceId: workspace.id,
          holidayId,
        });
        toast.success(t("settings:workspaceCalendar.toastHolidayDeleted"));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("settings:workspaceCalendar.toastHolidayDeleteError"),
        );
      }
    },
    [workspace?.id, deleteHoliday, t],
  );

  const debouncedSave = useCallback(
    (data: WorkspaceFormValues) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      debounceTimeoutRef.current = setTimeout(() => {
        saveWorkspace(data);
      }, 1000);
    },
    [saveWorkspace],
  );

  useEffect(() => {
    if (!canEdit) return;
    const subscription = workspaceForm.watch(() => {
      if (workspaceForm.formState.isDirty && workspaceForm.formState.isValid) {
        debouncedSave(workspaceForm.getValues());
      }
    });

    return () => subscription.unsubscribe();
  }, [workspaceForm, debouncedSave, canEdit]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      <PageTitle title={t("settings:workspaceGeneral.pageTitle")} />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:workspaceGeneral.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:workspaceGeneral.subtitle")}
          </p>
        </div>

        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-md font-medium">
              {t("settings:workspaceGeneral.workspaceInfoTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("settings:workspaceGeneral.workspaceInfoSubtitle")}
            </p>
          </div>

          <div className="space-y-4 border border-border rounded-md p-4 bg-sidebar">
            <Form {...workspaceForm}>
              <form className="space-y-4">
                <FormField
                  control={workspaceForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm font-medium">
                            {t("settings:workspaceGeneral.nameLabel")}
                          </FormLabel>
                          <p className="text-xs text-muted-foreground">
                            {t("settings:workspaceGeneral.nameHint")}
                          </p>
                        </div>
                        <FormControl>
                          <Input
                            className="w-full sm:w-64"
                            placeholder={t(
                              "settings:workspaceGeneral.namePlaceholder",
                            )}
                            disabled={!canEdit}
                            {...field}
                          />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator />

                <FormField
                  control={workspaceForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm font-medium">
                            {t("settings:workspaceGeneral.descriptionLabel")}
                          </FormLabel>
                          <p className="text-xs text-muted-foreground">
                            {t("settings:workspaceGeneral.descriptionHint")}
                          </p>
                        </div>
                        <FormControl>
                          <Input
                            className="w-full sm:w-64"
                            placeholder={t(
                              "settings:workspaceGeneral.descriptionPlaceholder",
                            )}
                            disabled={!canEdit}
                            {...field}
                          />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </form>
            </Form>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-md font-medium">
              {t("settings:workspaceCalendar.title")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("settings:workspaceCalendar.subtitle")}
            </p>
          </div>

          <div className="space-y-4 border border-border rounded-md p-4 bg-sidebar">
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t("settings:workspaceCalendar.workingDaysTitle")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("settings:workspaceCalendar.workingDaysSubtitle")}
              </p>
            </div>
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
          </div>

          <div className="space-y-4 border border-border rounded-md p-4 bg-sidebar">
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t("settings:workspaceCalendar.holidaysTitle")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("settings:workspaceCalendar.holidaysSubtitle")}
              </p>
            </div>

            {canEdit && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
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
                    className="w-full sm:w-44"
                    value={newHolidayDate}
                    onChange={(e) => {
                      setNewHolidayDate(e.target.value);
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
                    className="w-full"
                    placeholder={t(
                      "settings:workspaceCalendar.namePlaceholder",
                    )}
                    value={newHolidayName}
                    onChange={(e) => {
                      setNewHolidayName(e.target.value);
                      setHolidayError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !createHoliday.isPending) {
                        handleAddHoliday();
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
            )}
            {holidayError && (
              <p className="text-sm text-destructive">{holidayError}</p>
            )}

            {isCalendarLoading ? (
              <p className="text-sm text-muted-foreground">
                {t("settings:workspaceCalendar.loading")}
              </p>
            ) : holidays.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("settings:workspaceCalendar.empty")}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {holidays.map((holiday) => (
                  <div
                    key={holiday.id}
                    className="flex items-center justify-between py-2 px-1"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-sm text-muted-foreground shrink-0">
                        {new Date(holiday.date).toLocaleDateString(undefined, {
                          timeZone: "UTC",
                        })}
                      </span>
                      <span className="text-sm truncate">{holiday.name}</span>
                    </div>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t(
                          "settings:workspaceCalendar.deleteHoliday",
                        )}
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        disabled={deleteHoliday.isPending}
                        onClick={() => handleDeleteHoliday(holiday.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-md font-medium">
              {t("settings:workspaceGeneral.activityRetention.title")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("settings:workspaceGeneral.activityRetention.subtitle")}
            </p>
          </div>

          <div className="space-y-4 border border-border rounded-md p-4 bg-sidebar">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {t("settings:workspaceGeneral.activityRetention.label")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {retentionDaysInput.trim() === ""
                    ? t(
                        "settings:workspaceGeneral.activityRetention.keepForever",
                      )
                    : t("settings:workspaceGeneral.activityRetention.unit")}
                </p>
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={3650}
                  step={1}
                  className="w-full sm:w-32"
                  placeholder={t(
                    "settings:workspaceGeneral.activityRetention.placeholder",
                  )}
                  disabled={!canEdit}
                  value={retentionDaysInput}
                  onChange={(event) =>
                    setRetentionDaysInput(event.target.value)
                  }
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!canEdit || !retentionDirty || isSavingRetention}
                  onClick={handleSaveRetention}
                >
                  {t("settings:workspaceGeneral.activityRetention.saveButton")}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                "settings:workspaceGeneral.activityRetention.notEnforcedNotice",
              )}
            </p>
          </div>
        </div>

        {isOwner ? (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-md font-medium">
                {t("settings:workspaceGeneral.transferOwnership.title", {
                  defaultValue: "Transfer ownership",
                })}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("settings:workspaceGeneral.transferOwnership.subtitle", {
                  defaultValue:
                    "Hand this workspace over to another member. You'll be demoted to admin and lose owner-only abilities.",
                })}
              </p>
            </div>

            <div className="space-y-4 border border-border rounded-md p-4 bg-sidebar">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-sm font-medium">
                    {t(
                      "settings:workspaceGeneral.transferOwnership.pickerLabel",
                      { defaultValue: "New owner" },
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {eligibleNewOwners.length === 0
                      ? t(
                          "settings:workspaceGeneral.transferOwnership.noEligibleMembers",
                          {
                            defaultValue:
                              "Invite at least one other member before you can transfer ownership.",
                          },
                        )
                      : t(
                          "settings:workspaceGeneral.transferOwnership.pickerHint",
                          {
                            defaultValue:
                              "They become the sole owner of this workspace.",
                          },
                        )}
                  </p>
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <Select
                    value={selectedNewOwnerId}
                    onValueChange={(value) => {
                      if (typeof value === "string") {
                        setSelectedNewOwnerId(value);
                      }
                    }}
                    disabled={eligibleNewOwners.length === 0}
                  >
                    <SelectTrigger size="sm" className="w-full sm:w-56">
                      <SelectValue
                        placeholder={t(
                          "settings:workspaceGeneral.transferOwnership.pickerPlaceholder",
                          { defaultValue: "Select a member" },
                        )}
                      >
                        {selectedMember
                          ? selectedMember.user.name ||
                            selectedMember.user.email
                          : null}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleNewOwners.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.user.name} ({m.user.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={!selectedNewOwnerId || isTransferring}
                    onClick={() => setIsTransferModalOpen(true)}
                  >
                    {t("settings:workspaceGeneral.transferOwnership.button", {
                      defaultValue: "Transfer",
                    })}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {canDelete && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-md font-medium">
                {t("settings:workspaceGeneral.dangerZone")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("settings:workspaceGeneral.dangerZoneSubtitle")}
              </p>
            </div>

            <div className="space-y-4 border border-border rounded-md p-4 bg-sidebar">
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    {t("settings:workspaceGeneral.deleteWorkspace")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("settings:workspaceGeneral.deleteWorkspaceDescription")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive transition-colors"
                  type="button"
                  onClick={() => setIsDeleteModalOpen(true)}
                >
                  {t("settings:workspaceGeneral.deleteWorkspace")}
                </Button>
              </div>
            </div>
          </div>
        )}

        <AlertDialog
          open={isTransferModalOpen}
          onOpenChange={setIsTransferModalOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("settings:workspaceGeneral.transferOwnership.dialogTitle", {
                  defaultValue: "Transfer ownership?",
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  "settings:workspaceGeneral.transferOwnership.dialogDescription",
                  {
                    defaultValue:
                      "{{name}} will become the sole owner of {{workspace}}. You'll keep admin access but lose owner-only abilities like deleting the workspace or transferring it again.",
                    name:
                      selectedMember?.user.name ||
                      selectedMember?.user.email ||
                      "",
                    workspace: workspace?.name ?? "",
                  },
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isTransferring}
                  />
                }
              >
                {t("common:actions.cancel")}
              </AlertDialogClose>
              <AlertDialogClose
                render={
                  <Button
                    size="sm"
                    disabled={isTransferring}
                    onClick={handleTransferOwnership}
                  />
                }
              >
                {isTransferring
                  ? t(
                      "settings:workspaceGeneral.transferOwnership.transferring",
                      { defaultValue: "Transferring…" },
                    )
                  : t("settings:workspaceGeneral.transferOwnership.confirm", {
                      defaultValue: "Transfer ownership",
                    })}
              </AlertDialogClose>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={isDeleteModalOpen}
          onOpenChange={setIsDeleteModalOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("settings:workspaceGeneral.deleteModalTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("settings:workspaceGeneral.deleteModalDescription", {
                  name: workspace?.name ?? "",
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" size="sm" />}>
                {t("common:actions.cancel")}
              </AlertDialogClose>
              <AlertDialogClose
                render={
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={isDeleting}
                    onClick={handleDeleteWorkspace}
                  />
                }
              >
                {isDeleting
                  ? t("common:actions.deleting")
                  : t("settings:workspaceGeneral.deleteModalConfirm")}
              </AlertDialogClose>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );
}
