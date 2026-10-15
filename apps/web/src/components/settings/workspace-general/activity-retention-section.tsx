import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsNote } from "@/components/settings/settings-note";
import { SettingsRow } from "@/components/settings/settings-row";
import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import useUpdateWorkspaceActivityRetention from "@/hooks/mutations/workspace/use-update-workspace-activity-retention";
import useGetWorkspaceActivityRetention from "@/hooks/queries/workspace/use-get-workspace-activity-retention";
import { toast } from "@/lib/toast";

type ActivityRetentionSectionProps = {
  workspaceId: string | undefined;
  canEdit: boolean;
};

function toInput(days: number | null | undefined) {
  return days ? String(days) : "";
}

// How long the workspace keeps its activity log; empty keeps it forever.
export function ActivityRetentionSection({
  workspaceId,
  canEdit,
}: ActivityRetentionSectionProps) {
  const { t } = useTranslation();
  const { data: activityRetention } =
    useGetWorkspaceActivityRetention(workspaceId);
  const { mutateAsync: updateActivityRetention, isPending: isSaving } =
    useUpdateWorkspaceActivityRetention();
  const [daysInput, setDaysInput] = useState("");

  useEffect(() => {
    setDaysInput(toInput(activityRetention?.activityRetentionDays));
  }, [activityRetention]);

  const dirty = toInput(activityRetention?.activityRetentionDays) !== daysInput;

  const handleSave = async () => {
    if (!workspaceId) return;

    const trimmed = daysInput.trim();
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
        workspaceId,
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
  };

  return (
    <SettingsSection
      title={t("settings:workspaceGeneral.activityRetention.title")}
      description={t("settings:workspaceGeneral.activityRetention.subtitle")}
    >
      <SettingsCard>
        <SettingsRow
          stack
          title={t("settings:workspaceGeneral.activityRetention.label")}
          description={
            daysInput.trim() === ""
              ? t("settings:workspaceGeneral.activityRetention.keepForever")
              : t("settings:workspaceGeneral.activityRetention.unit")
          }
        >
          <Input
            type="number"
            inputMode="numeric"
            size="sm"
            min={0}
            max={3650}
            step={1}
            className="w-full sm:w-32"
            placeholder={t(
              "settings:workspaceGeneral.activityRetention.placeholder",
            )}
            disabled={!canEdit}
            value={daysInput}
            onChange={(event) => setDaysInput(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            disabled={!canEdit || !dirty || isSaving}
            onClick={handleSave}
          >
            {t("settings:workspaceGeneral.activityRetention.saveButton")}
          </Button>
        </SettingsRow>
      </SettingsCard>
      <SettingsNote>
        {t("settings:workspaceGeneral.activityRetention.notEnforcedNotice")}
      </SettingsNote>
    </SettingsSection>
  );
}
