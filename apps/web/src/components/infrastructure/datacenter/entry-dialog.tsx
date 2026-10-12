import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { CreateStorageCapacityRequest } from "@/fetchers/infrastructure/datacenter/create-storage-capacity";
import { getDatacenterErrorMessage } from "@/lib/infrastructure-error";
import { toast } from "@/lib/toast";

// Adds a planned capacity entry (a storage node or a block of a managed service) to a cluster.
export function EntryDialog({
  open,
  onOpenChange,
  clusterName,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusterName: string;
  onSubmit: (data: CreateStorageCapacityRequest["data"]) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState("");
  const [modelName, setModelName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [pending, setPending] = useState(false);

  const capacityGb = Number(capacity);
  const valid = Number.isInteger(capacityGb) && capacityGb >= 1;

  const handleSubmit = async () => {
    if (!valid || pending) return;
    setPending(true);
    try {
      await onSubmit({
        ...(label.trim() ? { label: label.trim() } : {}),
        modelName: modelName.trim() || null,
        capacityGb,
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(
        getDatacenterErrorMessage(
          error,
          t,
          "workspace:datacenter.errors.saveFailed",
        ),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t("workspace:datacenter.entryDialog.title")}
            </DialogTitle>
            <DialogDescription>{clusterName}</DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <Field>
              <FieldLabel>
                {t("workspace:datacenter.fields.capacityGb")}
              </FieldLabel>
              <Input
                nativeInput
                type="number"
                min={1}
                aria-label={t("workspace:datacenter.fields.capacityGb")}
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
              />
              <FieldDescription>
                {t("workspace:datacenter.entryDialog.capacityHint")}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>{t("workspace:datacenter.fields.model")}</FieldLabel>
              <Input
                nativeInput
                aria-label={t("workspace:datacenter.fields.model")}
                maxLength={200}
                value={modelName}
                onChange={(event) => setModelName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>{t("workspace:datacenter.fields.label")}</FieldLabel>
              <Input
                nativeInput
                aria-label={t("workspace:datacenter.fields.label")}
                maxLength={200}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
              <FieldDescription>
                {t("workspace:datacenter.entryDialog.labelHint")}
              </FieldDescription>
            </Field>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!valid || pending}>
              {t("workspace:datacenter.actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
