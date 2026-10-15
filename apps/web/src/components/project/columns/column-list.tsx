import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AddColumnRow } from "@/components/project/columns/add-column-row";
import { ColumnListHeader } from "@/components/project/columns/column-list-header";
import { ColumnListSkeleton } from "@/components/project/columns/column-list-skeleton";
import { EnforcedColumnsAlert } from "@/components/project/columns/enforced-columns-alert";
import { ColumnRow } from "@/components/project/columns/column-row";
import type { ProjectColumn } from "@/components/project/columns/types";
import { errorMessage } from "@/components/project/error-message";
import { toPositions } from "@/components/project/sortable/apply-order";
import { SortableList } from "@/components/project/sortable/sortable-list";
import { useSortableOrder } from "@/components/project/sortable/use-sortable-order";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { SettingsCard } from "@/components/settings/settings-card";
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

type ColumnListProps = {
  projectId: string;
};

const NO_COLUMNS: ProjectColumn[] = [];

export function ColumnList({ projectId }: ColumnListProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: columns = NO_COLUMNS, isLoading: columnsLoading } =
    useGetColumns(projectId);
  const { mutateAsync: createColumn } = useCreateColumn();
  const { mutateAsync: updateColumn } = useUpdateColumn();
  const { mutateAsync: deleteColumn, isPending: deleting } = useDeleteColumn();
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
  const [pendingDelete, setPendingDelete] = useState<ProjectColumn | null>(
    null,
  );

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
    toast.error(errorMessage(error, t(fallbackKey)));
  };

  const { ordered, move } = useSortableOrder(columns, async (next) => {
    try {
      await reorderColumns({ projectId, columns: toPositions(next) });
    } catch (error) {
      reportError(error, "settings:columnEditor.reorderError");
    }
  });

  const update = async (
    id: string,
    data: { name?: string; icon?: string; isFinal?: boolean },
    fallbackKey: string,
  ) => {
    try {
      await updateColumn({ id, projectId, data });
      return true;
    } catch (error) {
      reportError(error, fallbackKey);
      return false;
    }
  };

  const create = async (data: { name: string; icon: string }) => {
    try {
      await createColumn({ projectId, data });
      return true;
    } catch (error) {
      reportError(error, "settings:columnEditor.toastCreateError");
      return false;
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteColumn({ id: pendingDelete.id, projectId });
      setPendingDelete(null);
    } catch (error) {
      reportError(error, "settings:columnEditor.toastDeleteError");
    }
  };

  if (columnsLoading || enforcementLoading) return <ColumnListSkeleton />;

  return (
    <>
      {enforced ? (
        <EnforcedColumnsAlert
          canManageWorkspaceColumns={canManageWorkspaceColumns}
        />
      ) : null}
      <SettingsCard>
        <ColumnListHeader />
        <SortableList ids={ordered.map((column) => column.id)} onMove={move}>
          {ordered.map((column) => (
            <ColumnRow
              key={column.id}
              column={column}
              canEdit={canEdit}
              onRename={(name) =>
                update(
                  column.id,
                  { name },
                  "settings:columnEditor.toastRenameError",
                )
              }
              onChangeIcon={(icon) =>
                void update(
                  column.id,
                  { icon },
                  "settings:columnEditor.toastUpdateError",
                )
              }
              onToggleFinal={async (isFinal) => {
                await update(
                  column.id,
                  { isFinal },
                  "settings:columnEditor.toastUpdateError",
                );
              }}
              onDelete={() => setPendingDelete(column)}
            />
          ))}
        </SortableList>
        {canEdit ? <AddColumnRow onCreate={create} /> : null}
      </SettingsCard>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t("settings:columnEditor.deleteTitle", {
          name: pendingDelete?.name ?? "",
        })}
        description={t("settings:columnEditor.deleteDescription")}
        confirmLabel={t("settings:columnEditor.deleteConfirm")}
        pendingLabel={t("common:actions.deleting")}
        pending={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
