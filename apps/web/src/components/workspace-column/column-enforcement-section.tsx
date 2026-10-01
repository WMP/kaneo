import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSetEnforcement } from "@/hooks/mutations/workspace-column/use-set-enforcement";
import { useEnforcementPreview } from "@/hooks/queries/workspace-column/use-enforcement-preview";
import { toast } from "@/lib/toast";
import { getWorkspaceColumnErrorMessage } from "@/lib/workspace-column-error";
import ColumnSelect from "./column-select";

type ColumnEnforcementSectionProps = {
  workspaceId: string;
  /** The workspace columns ordered by position. */
  columns: Array<{ id: string; name: string }>;
  enforced: boolean;
  /** workspace:manage_settings. */
  canManage: boolean;
};

export default function ColumnEnforcementSection({
  workspaceId,
  columns,
  enforced,
  canManage,
}: ColumnEnforcementSectionProps) {
  const { t } = useTranslation();
  const { mutateAsync: setEnforcement, isPending } = useSetEnforcement();
  const [enableOpen, setEnableOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [fallbackId, setFallbackId] = useState<string | undefined>();

  const hasColumns = columns.length > 0;
  // Enforcing needs at least one column; turning it off is always possible.
  const switchDisabled = !canManage || isPending || (!enforced && !hasColumns);
  const fallbackColumnId = columns.some((column) => column.id === fallbackId)
    ? fallbackId
    : columns[0]?.id;

  const preview = useEnforcementPreview({
    workspaceId,
    fallbackColumnId,
    enabled: enableOpen,
  });
  const previewData = preview.data;
  const changedProjects =
    previewData?.projects.filter((project) => project.changed) ?? [];

  const handleSwitch = (checked: boolean) => {
    if (checked) {
      setFallbackId(undefined);
      setEnableOpen(true);
    } else {
      setDisableOpen(true);
    }
  };

  const confirmEnable = async () => {
    if (!fallbackColumnId) return;
    try {
      await setEnforcement({
        workspaceId,
        enforced: true,
        fallbackColumnId,
      });
      toast.success(t("settings:workspaceWorkflow.enforcement.enabledToast"));
      setEnableOpen(false);
    } catch (error) {
      toast.error(
        getWorkspaceColumnErrorMessage(
          error,
          t,
          "settings:workspaceWorkflow.enforcement.enableError",
        ),
      );
    }
  };

  const confirmDisable = async () => {
    try {
      await setEnforcement({ workspaceId, enforced: false });
      toast.success(t("settings:workspaceWorkflow.enforcement.disabledToast"));
      setDisableOpen(false);
    } catch (error) {
      toast.error(
        getWorkspaceColumnErrorMessage(
          error,
          t,
          "settings:workspaceWorkflow.enforcement.disableError",
        ),
      );
    }
  };

  const hint = !canManage
    ? t("settings:workspaceWorkflow.enforcement.noPermission")
    : !enforced && !hasColumns
      ? t("settings:workspaceWorkflow.enforcement.noColumnsHint")
      : null;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-sidebar p-3">
        <div className="space-y-1">
          <Label htmlFor="workspace-columns-enforce" className="text-sm">
            {t("settings:workspaceWorkflow.enforcement.switchLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("settings:workspaceWorkflow.enforcement.description")}
          </p>
          {hint && (
            <p
              id="workspace-columns-enforce-hint"
              className="text-xs text-muted-foreground"
            >
              {hint}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {enforced
              ? t("settings:workspaceWorkflow.enforcement.statusOn")
              : t("settings:workspaceWorkflow.enforcement.statusOff")}
          </span>
          <Switch
            id="workspace-columns-enforce"
            checked={enforced}
            disabled={switchDisabled}
            aria-describedby={
              hint ? "workspace-columns-enforce-hint" : undefined
            }
            onCheckedChange={handleSwitch}
          />
        </div>
      </div>

      <Dialog
        open={enableOpen}
        onOpenChange={(open) => {
          if (!open && isPending) return;
          setEnableOpen(open);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {t("settings:workspaceWorkflow.enableDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("settings:workspaceWorkflow.enableDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="workspace-columns-fallback">
                {t("settings:workspaceWorkflow.enableDialog.fallbackLabel")}
              </Label>
              <ColumnSelect
                id="workspace-columns-fallback"
                columns={columns}
                value={fallbackColumnId}
                onChange={setFallbackId}
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                {t("settings:workspaceWorkflow.enableDialog.fallbackHelp")}
              </p>
            </div>

            {preview.isLoading || preview.isFetching ? (
              <p className="text-sm text-muted-foreground" role="status">
                {t("settings:workspaceWorkflow.enableDialog.previewLoading")}
              </p>
            ) : preview.isError ? (
              <Alert variant="error">
                <AlertDescription>
                  <p>
                    {getWorkspaceColumnErrorMessage(
                      preview.error,
                      t,
                      "settings:workspaceWorkflow.enableDialog.previewError",
                    )}
                  </p>
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void preview.refetch()}
                    >
                      {t("settings:workspaceWorkflow.retry")}
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : previewData ? (
              <div className="space-y-3">
                {previewData.totals.workflowRulesDeleted > 0 && (
                  <Alert variant="warning">
                    <AlertTriangle />
                    <AlertTitle>
                      {t(
                        "settings:workspaceWorkflow.enableDialog.rulesWarningTitle",
                      )}
                    </AlertTitle>
                    <AlertDescription>
                      {t(
                        "settings:workspaceWorkflow.enableDialog.rulesWarningDescription",
                        { rules: previewData.totals.workflowRulesDeleted },
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                {changedProjects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("settings:workspaceWorkflow.enableDialog.noChanges")}
                  </p>
                ) : (
                  <>
                    <p className="text-sm font-medium">
                      {t("settings:workspaceWorkflow.enableDialog.summary", {
                        changed: previewData.totals.projectsChanged,
                        total: previewData.totals.projects,
                      })}
                    </p>
                    <ul
                      className="max-h-64 space-y-2 overflow-y-auto"
                      aria-label={t(
                        "settings:workspaceWorkflow.enableDialog.projectsAria",
                      )}
                    >
                      {changedProjects.map((project) => (
                        <li
                          key={project.projectId}
                          className="rounded-md border border-border p-2.5 text-sm"
                        >
                          <p className="font-medium">{project.projectName}</p>
                          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                            <li>
                              {t(
                                "settings:workspaceWorkflow.enableDialog.columnsCreated",
                                { created: project.create.length },
                              )}
                            </li>
                            <li>
                              {t(
                                "settings:workspaceWorkflow.enableDialog.columnsRemoved",
                                { removed: project.remove.length },
                              )}
                            </li>
                            <li>
                              {t(
                                "settings:workspaceWorkflow.enableDialog.columnsUpdated",
                                { updated: project.update.length },
                              )}
                            </li>
                            <li>
                              {t(
                                "settings:workspaceWorkflow.enableDialog.tasksMoved",
                                { moved: project.tasksMoved },
                              )}
                            </li>
                            <li
                              className={
                                project.workflowRulesDeleted > 0
                                  ? "font-medium text-destructive"
                                  : undefined
                              }
                            >
                              {t(
                                "settings:workspaceWorkflow.enableDialog.rulesDeleted",
                                { rules: project.workflowRulesDeleted },
                              )}
                            </li>
                          </ul>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      {t(
                        "settings:workspaceWorkflow.enableDialog.movedTasksNote",
                      )}
                    </p>
                  </>
                )}
              </div>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEnableOpen(false)}
              disabled={isPending}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => void confirmEnable()}
              disabled={
                isPending ||
                preview.isFetching ||
                !previewData ||
                !fallbackColumnId
              }
            >
              {isPending
                ? t("settings:workspaceWorkflow.enableDialog.confirming")
                : t("settings:workspaceWorkflow.enableDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={disableOpen}
        onOpenChange={(open) => {
          if (!open && isPending) return;
          setDisableOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:workspaceWorkflow.disableDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:workspaceWorkflow.disableDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" size="sm" disabled={isPending} />
              }
            >
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => void confirmDisable()}
            >
              {t("settings:workspaceWorkflow.disableDialog.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
