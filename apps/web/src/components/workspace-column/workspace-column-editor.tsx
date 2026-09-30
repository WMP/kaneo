import { useState } from "react";
import { useTranslation } from "react-i18next";
import ColumnListEditor, {
  type EditableColumn,
} from "@/components/column/column-list-editor";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { useCreateWorkspaceColumn } from "@/hooks/mutations/workspace-column/use-create-workspace-column";
import { useDeleteWorkspaceColumn } from "@/hooks/mutations/workspace-column/use-delete-workspace-column";
import { useReorderWorkspaceColumns } from "@/hooks/mutations/workspace-column/use-reorder-workspace-columns";
import { useUpdateWorkspaceColumn } from "@/hooks/mutations/workspace-column/use-update-workspace-column";
import { toast } from "@/lib/toast";
import {
  getWorkspaceColumnErrorCode,
  getWorkspaceColumnErrorMessage,
  WORKSPACE_COLUMN_NOT_EMPTY,
} from "@/lib/workspace-column-error";
import ColumnSelect from "./column-select";

type WorkspaceColumnEditorProps = {
  workspaceId: string;
  columns: EditableColumn[] | undefined;
  enforced: boolean;
  isLoading: boolean;
  canEdit: boolean;
};

export default function WorkspaceColumnEditor({
  workspaceId,
  columns,
  enforced,
  isLoading,
  canEdit,
}: WorkspaceColumnEditorProps) {
  const { t } = useTranslation();
  const { mutateAsync: createColumn } = useCreateWorkspaceColumn();
  const { mutateAsync: updateColumn } = useUpdateWorkspaceColumn();
  const { mutateAsync: deleteColumn, isPending: deleting } =
    useDeleteWorkspaceColumn();
  const { mutateAsync: reorderColumns } = useReorderWorkspaceColumns();

  const [columnToDelete, setColumnToDelete] = useState<EditableColumn | null>(
    null,
  );
  const [moveTasksTo, setMoveTasksTo] = useState<string | undefined>();
  // True once the API said tasks still use the column, even outside enforcement.
  const [needsTarget, setNeedsTarget] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reportError = (error: unknown, fallbackKey: string) => {
    toast.error(getWorkspaceColumnErrorMessage(error, t, fallbackKey));
  };

  const otherColumns = (columns ?? []).filter(
    (column) => column.id !== columnToDelete?.id,
  );
  // With enforcement on, deleting removes the column from every project, so
  // the tasks in it need a destination. The person always picks one there (the
  // neighbour is preselected); without enforcement projects keep their columns.
  const asksForTarget = (enforced || needsTarget) && otherColumns.length > 0;
  const effectiveTarget = asksForTarget
    ? otherColumns.some((column) => column.id === moveTasksTo)
      ? moveTasksTo
      : otherColumns[0]?.id
    : undefined;

  const openDelete = (column: EditableColumn) => {
    setColumnToDelete(column);
    setMoveTasksTo(undefined);
    setNeedsTarget(false);
    setDeleteError(null);
  };

  const closeDelete = () => {
    if (deleting) return;
    setColumnToDelete(null);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!columnToDelete) return;
    setDeleteError(null);
    try {
      await deleteColumn({
        workspaceId,
        columnId: columnToDelete.id,
        moveTasksTo: effectiveTarget,
      });
      toast.success(t("settings:columnEditor.toastDeleted"));
      setColumnToDelete(null);
    } catch (error) {
      if (getWorkspaceColumnErrorCode(error) === WORKSPACE_COLUMN_NOT_EMPTY) {
        // Tasks still use the column: ask where they go instead of failing.
        setNeedsTarget(true);
      }
      setDeleteError(
        getWorkspaceColumnErrorMessage(
          error,
          t,
          "settings:columnEditor.toastDeleteError",
        ),
      );
    }
  };

  return (
    <>
      <ColumnListEditor
        columns={columns}
        isLoading={isLoading}
        canEdit={canEdit}
        onCreate={async ({ name, icon }) => {
          try {
            await createColumn({ workspaceId, data: { name, icon } });
            toast.success(t("settings:columnEditor.toastCreated"));
            return true;
          } catch (error) {
            reportError(error, "settings:columnEditor.toastCreateError");
            return false;
          }
        }}
        onRename={async (column, name) => {
          try {
            await updateColumn({
              workspaceId,
              columnId: column.id,
              data: { name },
            });
            toast.success(t("settings:columnEditor.toastRenamed"));
            return true;
          } catch (error) {
            reportError(error, "settings:columnEditor.toastRenameError");
            return false;
          }
        }}
        onToggleFinal={async (column, isFinal) => {
          try {
            await updateColumn({
              workspaceId,
              columnId: column.id,
              data: { isFinal },
            });
            toast.success(
              isFinal
                ? t("settings:columnEditor.toastFinalOn")
                : t("settings:columnEditor.toastFinalOff"),
            );
            return true;
          } catch (error) {
            reportError(error, "settings:columnEditor.toastUpdateError");
            return false;
          }
        }}
        onUpdateIcon={async (column, icon) => {
          try {
            await updateColumn({
              workspaceId,
              columnId: column.id,
              data: { icon },
            });
            toast.success(t("settings:columnEditor.toastIconUpdated"));
            return true;
          } catch (error) {
            reportError(error, "settings:columnEditor.toastUpdateError");
            return false;
          }
        }}
        onDelete={openDelete}
        onReorder={async (updates) => {
          try {
            await reorderColumns({ workspaceId, columns: updates });
          } catch (error) {
            reportError(error, "settings:columnEditor.toastUpdateError");
          }
        }}
      />

      <Dialog
        open={columnToDelete !== null}
        onOpenChange={(open) => {
          if (!open) closeDelete();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settings:workspaceWorkflow.deleteDialog.title", {
                name: columnToDelete?.name ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {enforced
                ? t(
                    "settings:workspaceWorkflow.deleteDialog.descriptionEnforced",
                  )
                : t("settings:workspaceWorkflow.deleteDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            {needsTarget && (
              <Alert variant="warning">
                <AlertDescription>
                  {t("settings:workspaceWorkflow.deleteDialog.needsTarget")}
                </AlertDescription>
              </Alert>
            )}
            {asksForTarget && (
              <div className="space-y-1.5">
                <Label htmlFor="workspace-column-move-tasks-to">
                  {t("settings:workspaceWorkflow.deleteDialog.moveTasksTo")}
                </Label>
                <ColumnSelect
                  id="workspace-column-move-tasks-to"
                  columns={otherColumns}
                  value={effectiveTarget}
                  onChange={setMoveTasksTo}
                />
              </div>
            )}
            {deleteError && (
              <Alert variant="error">
                <AlertDescription>{deleteError}</AlertDescription>
              </Alert>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={closeDelete}
              disabled={deleting}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void confirmDelete()}
              disabled={deleting}
            >
              {deleting
                ? t("common:actions.deleting")
                : t("settings:workspaceWorkflow.deleteDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
