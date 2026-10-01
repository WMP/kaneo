import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import ColumnListEditor, {
  type EditableColumn,
} from "@/components/column/column-list-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useCreateColumn } from "@/hooks/mutations/column/use-create-column";
import { useDeleteColumn } from "@/hooks/mutations/column/use-delete-column";
import { useReorderColumns } from "@/hooks/mutations/column/use-reorder-columns";
import { useUpdateColumn } from "@/hooks/mutations/column/use-update-column";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { useProjectColumnsEnforcement } from "@/hooks/use-project-columns-enforcement";
import { useProjectPermission } from "@/hooks/use-project-permission";
import { toast } from "@/lib/toast";
import {
  getWorkspaceColumnErrorCode,
  getWorkspaceColumnErrorMessage,
  WORKSPACE_COLUMNS_ENFORCED,
} from "@/lib/workspace-column-error";

type ColumnEditorProps = {
  projectId: string;
};

export default function ColumnEditor({ projectId }: ColumnEditorProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: columns, isLoading: columnsLoading } = useGetColumns(projectId);
  const { mutateAsync: createColumn } = useCreateColumn();
  const { mutateAsync: updateColumn } = useUpdateColumn();
  const { mutateAsync: deleteColumn } = useDeleteColumn();
  const { mutateAsync: reorderColumns } = useReorderColumns();
  const { canUpdateProject } = useProjectPermission(projectId);
  const {
    enforced,
    isLoading: enforcementLoading,
    canManageWorkspaceColumns,
  } = useProjectColumnsEnforcement(projectId);
  // With enforcement on the columns belong to the workspace: the project list
  // is read-only for everyone, whatever their project role.
  const canEdit = canUpdateProject() && !enforced;

  // The API answers 409 WORKSPACE_COLUMNS_ENFORCED when the workspace started
  // enforcing after this page loaded; refresh the flag so the list turns
  // read-only. Other errors keep the message the API sent.
  const reportError = (error: unknown, fallbackKey: string) => {
    if (getWorkspaceColumnErrorCode(error) === WORKSPACE_COLUMNS_ENFORCED) {
      void queryClient.invalidateQueries({ queryKey: ["workspace-columns"] });
      void queryClient.invalidateQueries({ queryKey: ["columns", projectId] });
      toast.error(getWorkspaceColumnErrorMessage(error, t, fallbackKey));
      return;
    }
    toast.error(
      error instanceof Error && error.message ? error.message : t(fallbackKey),
    );
  };

  const handleCreate = async ({
    name,
    icon,
  }: {
    name: string;
    icon: string;
  }) => {
    try {
      await createColumn({ projectId, data: { name, icon } });
      toast.success(t("settings:columnEditor.toastCreated"));
      return true;
    } catch (error) {
      reportError(error, "settings:columnEditor.toastCreateError");
      return false;
    }
  };

  const handleRename = async (column: EditableColumn, name: string) => {
    try {
      await updateColumn({ id: column.id, projectId, data: { name } });
      toast.success(t("settings:columnEditor.toastRenamed"));
      return true;
    } catch (error) {
      reportError(error, "settings:columnEditor.toastRenameError");
      return false;
    }
  };

  const handleToggleFinal = async (
    column: EditableColumn,
    isFinal: boolean,
  ) => {
    try {
      await updateColumn({ id: column.id, projectId, data: { isFinal } });
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
  };

  const handleUpdateIcon = async (column: EditableColumn, icon: string) => {
    try {
      await updateColumn({ id: column.id, projectId, data: { icon } });
      toast.success(t("settings:columnEditor.toastIconUpdated"));
      return true;
    } catch (error) {
      reportError(error, "settings:columnEditor.toastUpdateError");
      return false;
    }
  };

  const handleDelete = async (column: EditableColumn) => {
    try {
      await deleteColumn({ id: column.id, projectId });
      toast.success(t("settings:columnEditor.toastDeleted"));
    } catch (error) {
      reportError(error, "settings:columnEditor.toastDeleteError");
    }
  };

  const handleReorder = async (
    updates: Array<{ id: string; position: number }>,
  ) => {
    try {
      await reorderColumns({ projectId, columns: updates });
    } catch (error) {
      reportError(error, "settings:columnEditor.toastUpdateError");
    }
  };

  return (
    <div className="space-y-3">
      {enforced && (
        <Alert variant="info">
          <Lock />
          <AlertTitle>
            {t("settings:projectWorkflow.enforced.title")}
          </AlertTitle>
          <AlertDescription>
            <p>
              {canManageWorkspaceColumns
                ? t("settings:projectWorkflow.enforced.description")
                : t("settings:projectWorkflow.enforced.descriptionNoAccess")}
            </p>
            {canManageWorkspaceColumns && (
              <div>
                <Button
                  render={<Link to="/dashboard/settings/workspace/workflow" />}
                  variant="outline"
                  size="sm"
                >
                  {t("settings:projectWorkflow.enforced.manageLink")}
                </Button>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}
      <ColumnListEditor
        columns={columns}
        isLoading={columnsLoading || enforcementLoading}
        canEdit={canEdit}
        onCreate={handleCreate}
        onRename={handleRename}
        onToggleFinal={handleToggleFinal}
        onUpdateIcon={handleUpdateIcon}
        onDelete={(column) => void handleDelete(column)}
        onReorder={handleReorder}
      />
    </div>
  );
}
