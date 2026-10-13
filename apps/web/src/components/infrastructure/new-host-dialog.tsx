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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { InfraHost } from "@/fetchers/infrastructure/get-project-hosts";
import type { InfraModel } from "@/fetchers/infrastructure/get-project-models";
import useCreateProjectHost from "@/hooks/mutations/infrastructure/use-create-project-host";
import { toast } from "@/lib/toast";
import { InfraSelect } from "./infra-select";

// Limits of `quantity` in apps/api/src/infrastructure/schema.ts.
const QUANTITY = { min: 1, max: 50 } as const;

function parseQuantity(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const quantity = Number(value.trim());
  return quantity >= QUANTITY.min && quantity <= QUANTITY.max ? quantity : null;
}

type Props = {
  projectId: string;
  models: InfraModel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Called with the created planned host, after the dialog asked to close.
  onCreated?: (host: InfraHost) => void;
  // Shows a quantity field (1 to 50) so one request adds several hosts. Without
  // it exactly one host is created.
  allowQuantity?: boolean;
};

// Creates a planned host from a model of the pool and one of its regions.
export function NewHostDialog({
  projectId,
  models,
  open,
  onOpenChange,
  onCreated,
  allowQuantity = false,
}: Props) {
  const { t } = useTranslation();
  const createHost = useCreateProjectHost();
  const [modelId, setModelId] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [quantityText, setQuantityText] = useState("1");
  const quantity = allowQuantity ? parseQuantity(quantityText) : 1;

  const model = models.find((item) => item.id === modelId);
  const regions = model?.regions ?? [];

  const handleOpenChange = (next: boolean) => {
    if (createHost.isPending) return;
    if (!next) {
      setModelId(null);
      setRegion(null);
      setQuantityText("1");
    }
    onOpenChange(next);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!modelId || !region || quantity === null || createHost.isPending)
      return;
    createHost.mutate(
      { projectId, modelId, region, ...(allowQuantity ? { quantity } : {}) },
      {
        onSuccess: ({ hosts }) => {
          setModelId(null);
          setRegion(null);
          setQuantityText("1");
          onOpenChange(false);
          if (allowQuantity) {
            toast.success(
              t("settings:projectInfrastructure.hosts.added", {
                count: hosts.length,
              }),
            );
          }
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
            {allowQuantity && (
              <div className="grid gap-2">
                <Label htmlFor="new-host-quantity">
                  {t("settings:projectInfrastructure.hosts.quantity")}
                </Label>
                <Input
                  id="new-host-quantity"
                  type="number"
                  inputMode="numeric"
                  min={QUANTITY.min}
                  max={QUANTITY.max}
                  value={quantityText}
                  onChange={(event) => setQuantityText(event.target.value)}
                  aria-invalid={quantity === null || undefined}
                  aria-describedby={
                    quantity === null ? "new-host-quantity-error" : undefined
                  }
                />
                {quantity === null && (
                  <p
                    id="new-host-quantity-error"
                    className="text-xs text-destructive-foreground"
                  >
                    {t("settings:projectInfrastructure.validation.integer", {
                      min: QUANTITY.min,
                      max: QUANTITY.max,
                    })}
                  </p>
                )}
              </div>
            )}
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
              disabled={
                !modelId || !region || quantity === null || createHost.isPending
              }
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
