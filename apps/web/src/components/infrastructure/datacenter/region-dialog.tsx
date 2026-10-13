import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getDatacenterErrorMessage } from "@/lib/infrastructure-error";
import { toast } from "@/lib/toast";
import type { CatalogRegion } from "./types";

// Same rule as `regionCode` in apps/api/src/infrastructure/schema.ts.
const CODE_PATTERN = /^[A-Z0-9-]{1,16}$/;

// Adds a region to the catalog, or renames one: the code is fixed once created.
export function RegionDialog({
  open,
  onOpenChange,
  region,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The region being renamed; omit to add one. */
  region?: CatalogRegion;
  onSubmit: (data: { code: string; name: string }) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState(region?.code ?? "");
  const [name, setName] = useState(region?.name ?? "");
  const [pending, setPending] = useState(false);

  const normalizedCode = code.trim().toUpperCase();
  const valid =
    name.trim() !== "" &&
    (region !== undefined || CODE_PATTERN.test(normalizedCode));

  const handleSubmit = async () => {
    if (!valid || pending) return;
    setPending(true);
    try {
      await onSubmit({
        code: region ? region.code : normalizedCode,
        name: name.trim(),
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
              {region
                ? t("workspace:datacenter.regions.editTitle")
                : t("workspace:datacenter.regions.add")}
            </DialogTitle>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <Field>
              <FieldLabel>{t("workspace:datacenter.regions.code")}</FieldLabel>
              <Input
                nativeInput
                aria-label={t("workspace:datacenter.regions.code")}
                maxLength={16}
                value={code}
                readOnly={region !== undefined}
                onChange={(event) => setCode(event.target.value)}
              />
              {!region && (
                <FieldDescription>
                  {t("workspace:datacenter.regions.codeHint")}
                </FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel>{t("workspace:datacenter.fields.name")}</FieldLabel>
              <Input
                nativeInput
                aria-label={t("workspace:datacenter.fields.name")}
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
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
