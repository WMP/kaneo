import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InfraModel } from "@/fetchers/infrastructure/get-project-models";
import useDeleteProjectModel from "@/hooks/mutations/infrastructure/use-delete-project-model";
import { ModelDialog } from "./model-dialog";

type Props = {
  projectId: string;
  models: InfraModel[];
  canManage: boolean;
};

export function ModelsTable({ projectId, models, canManage }: Props) {
  const { t } = useTranslation();
  const deleteModel = useDeleteProjectModel();
  const [dialog, setDialog] = useState<{ model: InfraModel | null } | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<InfraModel | null>(null);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    deleteModel.mutate(
      { projectId, modelId: pendingDelete.id },
      { onSettled: () => setPendingDelete(null) },
    );
  };

  return (
    <section className="space-y-3" aria-labelledby="infra-models-title">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 id="infra-models-title" className="text-base font-semibold">
            {t("settings:projectInfrastructure.models.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("settings:projectInfrastructure.models.description")}
          </p>
        </div>
        {canManage && (
          <Button
            type="button"
            size="sm"
            className="gap-1"
            onClick={() => setDialog({ model: null })}
          >
            <Plus className="size-4" />
            {t("settings:projectInfrastructure.models.add")}
          </Button>
        )}
      </div>

      {models.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings:projectInfrastructure.models.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("settings:projectInfrastructure.models.columns.name")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.models.columns.family")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.models.columns.provider")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.models.columns.ram")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.models.columns.vcpu")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.models.columns.localDisk")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.models.columns.regions")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.models.columns.leadTime")}
                </TableHead>
                <TableHead>
                  {t("settings:projectInfrastructure.models.columns.reserve")}
                </TableHead>
                {canManage && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((model) => (
                <TableRow key={model.id}>
                  <TableCell className="font-medium">{model.name}</TableCell>
                  <TableCell>{model.family ?? "–"}</TableCell>
                  <TableCell>
                    {t(
                      `settings:projectInfrastructure.providers.${model.provider}`,
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{model.ramGb}</TableCell>
                  <TableCell className="tabular-nums">{model.vcpu}</TableCell>
                  <TableCell className="tabular-nums">
                    {model.storageGb}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {model.regions.map((region) => (
                        <Badge key={region} variant="outline">
                          {region}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {model.leadTimeDays}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {model.hypervisorReserveGb}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t(
                            "settings:projectInfrastructure.models.editAction",
                            { name: model.name },
                          )}
                          onClick={() => setDialog({ model })}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t(
                            "settings:projectInfrastructure.models.deleteAction",
                            { name: model.name },
                          )}
                          onClick={() => setPendingDelete(model)}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canManage && dialog && (
        <ModelDialog
          key={dialog.model?.id ?? "new"}
          projectId={projectId}
          model={dialog.model}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteModel.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:projectInfrastructure.models.deleteTitle", {
                name: pendingDelete?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:projectInfrastructure.models.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="outline" />}
              disabled={deleteModel.isPending}
            >
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteModel.isPending}
            >
              {t("common:actions.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
