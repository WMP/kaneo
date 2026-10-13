import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import type { InfraHost } from "@/fetchers/infrastructure/get-project-hosts";
import type { InfraModel } from "@/fetchers/infrastructure/get-project-models";
import useCreateProjectHost from "@/hooks/mutations/infrastructure/use-create-project-host";
import { InfraSelect } from "./infra-select";

type Props = {
  projectId: string;
  models: InfraModel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Called with the created planned host, after the dialog asked to close.
  onCreated?: (host: InfraHost) => void;
};

// Creates a planned host from a model of the pool and one of its regions.
export function NewHostDialog({
  projectId,
  models,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const { t } = useTranslation();
  const createHost = useCreateProjectHost();
  const [modelId, setModelId] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);

  const model = models.find((item) => item.id === modelId);
  const regions = model?.regions ?? [];

  const handleOpenChange = (next: boolean) => {
    if (createHost.isPending) return;
    if (!next) {
      setModelId(null);
      setRegion(null);
    }
    onOpenChange(next);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!modelId || !region || createHost.isPending) return;
    createHost.mutate(
      { projectId, modelId, region },
      {
        onSuccess: ({ hosts }) => {
          setModelId(null);
          setRegion(null);
          onOpenChange(false);
          const [host] = hosts;
          if (host) onCreated?.(host);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {t("settings:projectInfrastructure.hosts.add")}
            </DialogTitle>
            <DialogDescription>
              {models.length === 0
                ? t("settings:projectInfrastructure.hosts.noModels")
                : t("settings:projectInfrastructure.hosts.newDescription")}
            </DialogDescription>
          </DialogHeader>

          <DialogPanel className="grid gap-4">
            <div className="grid gap-2">
              <Label>
                {t("settings:projectInfrastructure.hosts.newModel")}
              </Label>
              <InfraSelect
                ariaLabel={t("settings:projectInfrastructure.hosts.newModel")}
                placeholder={t(
                  "settings:projectInfrastructure.hosts.newModelPlaceholder",
                )}
                value={modelId}
                options={models.map((item) => ({
                  value: item.id,
                  label: `${item.name} · ${item.ramGb} GB`,
                }))}
                onChange={(next) => {
                  setModelId(next);
                  const nextModel = models.find((item) => item.id === next);
                  // A model with one region needs no second choice.
                  setRegion(
                    nextModel && nextModel.regions.length === 1
                      ? nextModel.regions[0]
                      : null,
                  );
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label>
                {t("settings:projectInfrastructure.hosts.newRegion")}
              </Label>
              <InfraSelect
                ariaLabel={t("settings:projectInfrastructure.hosts.newRegion")}
                placeholder={t(
                  "settings:projectInfrastructure.hosts.newRegionPlaceholder",
                )}
                value={region}
                disabled={!model}
                options={regions.map((item) => ({ value: item, label: item }))}
                onChange={setRegion}
              />
            </div>
          </DialogPanel>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={createHost.isPending}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!modelId || !region || createHost.isPending}
            >
              {createHost.isPending
                ? t("settings:projectInfrastructure.saving")
                : t("settings:projectInfrastructure.hosts.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
