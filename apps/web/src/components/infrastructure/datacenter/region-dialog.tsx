import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
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
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { getDatacenterErrorMessage } from "@/lib/infrastructure-error";
import { toast } from "@/lib/toast";
import type { CatalogRegion } from "./types";

// Same rule as `regionCode` in apps/api/src/infrastructure/schema.ts.
const CODE_PATTERN = /^[A-Z0-9-]{1,16}$/;
// Limit of `zones` in apps/api/src/infrastructure/schema.ts.
const MAX_ZONES = 20;

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
  onSubmit: (data: {
    code: string;
    name: string;
    zones: string[];
  }) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState(region?.code ?? "");
  const [name, setName] = useState(region?.name ?? "");
  const [zones, setZones] = useState<string[]>(region?.zones ?? []);
  const [zoneInput, setZoneInput] = useState("");
  const [pending, setPending] = useState(false);

  // A zone code that can be added from the input: well formed, new, within the
  // limit. An empty input is not a candidate.
  const zoneCandidate = zoneInput.trim().toUpperCase();
  const canAddZone =
    CODE_PATTERN.test(zoneCandidate) &&
    !zones.includes(zoneCandidate) &&
    zones.length < MAX_ZONES;

  const addZone = () => {
    if (!canAddZone) return;
    setZones([...zones, zoneCandidate]);
    setZoneInput("");
  };

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
        // Text left in the input is added, not dropped silently.
        zones: canAddZone ? [...zones, zoneCandidate] : zones,
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
            <Field>
              <FieldLabel>
                {t("workspace:datacenter.regions.zonesLabel")}
              </FieldLabel>
              <div className="flex gap-2">
                <Input
                  nativeInput
                  aria-label={t("workspace:datacenter.regions.zoneInput")}
                  maxLength={16}
                  value={zoneInput}
                  onChange={(event) => setZoneInput(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter adds the zone; it must not submit the region form.
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addZone();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canAddZone}
                  onClick={addZone}
                >
                  {t("workspace:datacenter.regions.addZone")}
                </Button>
              </div>
              {zones.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {zones.map((zone) => {
                    const used = (region?.zoneUsage[zone] ?? 0) > 0;
                    const remove = (
                      <button
                        type="button"
                        className="inline-flex cursor-pointer items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={t(
                          "workspace:datacenter.regions.removeZone",
                          {
                            zone,
                          },
                        )}
                        disabled={used}
                        onClick={() =>
                          setZones(zones.filter((item) => item !== zone))
                        }
                      >
                        <X aria-hidden="true" className="size-3" />
                      </button>
                    );
                    return (
                      <li key={zone}>
                        <Badge variant="outline" size="lg">
                          {zone}
                          {used ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  // A disabled button gets no pointer events,
                                  // so the span carries the tooltip.
                                  <span className="inline-flex" />
                                }
                              >
                                {remove}
                              </TooltipTrigger>
                              <TooltipPopup>
                                {t("workspace:datacenter.errors.zoneInUse")}
                              </TooltipPopup>
                            </Tooltip>
                          ) : (
                            remove
                          )}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
              <FieldDescription>
                {t("workspace:datacenter.regions.zonesHint")}
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
