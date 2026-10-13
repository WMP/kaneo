import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { InfraModelInput } from "@/fetchers/infrastructure/create-project-model";
import type { InfraModel } from "@/fetchers/infrastructure/get-project-models";
import useCreateProjectModel from "@/hooks/mutations/infrastructure/use-create-project-model";
import useUpdateProjectModel from "@/hooks/mutations/infrastructure/use-update-project-model";
import useProjectRegions from "@/hooks/queries/infrastructure/use-project-regions";
import { InfraSelect } from "../infra-select";

const PROVIDERS = ["ovh", "azure", "other"] as const;
type Provider = (typeof PROVIDERS)[number];

// Limit of `regions` in apps/api/src/infrastructure/schema.ts.
const MAX_REGIONS = 20;

// Limits of apps/api/src/infrastructure/schema.ts.
const LIMITS = {
  ramGb: { min: 1, max: 1_000_000 },
  vcpu: { min: 1, max: 1_000_000 },
  storageGb: { min: 0, max: 100_000_000 },
  leadTimeDays: { min: 0, max: 3650 },
  hypervisorReservePercent: { min: 0, max: 90 },
} as const;

type NumberField = keyof typeof LIMITS;
type FormState = {
  name: string;
  family: string;
  provider: Provider;
  // Selected region codes.
  regions: string[];
} & Record<NumberField, string>;

const EMPTY: FormState = {
  name: "",
  family: "",
  provider: "ovh",
  regions: [],
  ramGb: "",
  vcpu: "",
  storageGb: "0",
  leadTimeDays: "0",
  hypervisorReservePercent: "5",
};

function fromModel(model: InfraModel): FormState {
  return {
    name: model.name,
    family: model.family ?? "",
    provider: model.provider,
    regions: [...model.regions],
    ramGb: String(model.ramGb),
    vcpu: String(model.vcpu),
    storageGb: String(model.storageGb),
    leadTimeDays: String(model.leadTimeDays),
    hypervisorReservePercent: String(model.hypervisorReservePercent),
  };
}

function parseInteger(value: string, field: NumberField): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const number = Number(value.trim());
  const { min, max } = LIMITS[field];
  return number >= min && number <= max ? number : null;
}

export function validateModelForm(form: FormState) {
  const errors: Partial<
    Record<keyof FormState, "required" | "integer" | "regions">
  > = {};
  if (!form.name.trim()) errors.name = "required";
  for (const field of Object.keys(LIMITS) as NumberField[]) {
    if (parseInteger(form[field], field) === null) errors[field] = "integer";
  }
  // The codes come from the catalog (or from the model itself), so only the
  // count is checked here; the API validates them against the catalog.
  if (form.regions.length === 0 || form.regions.length > MAX_REGIONS) {
    errors.regions = "regions";
  }
  return { errors };
}

type Props = {
  projectId: string;
  // The model to edit; null to add one.
  model: InfraModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ModelDialog({ projectId, model, open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const createModel = useCreateProjectModel();
  const updateModel = useUpdateProjectModel();
  const [form, setForm] = useState<FormState>(() =>
    model ? fromModel(model) : EMPTY,
  );
  const [submitted, setSubmitted] = useState(false);
  const isPending = createModel.isPending || updateModel.isPending;
  const { errors } = validateModelForm(form);
  const regionsQuery = useProjectRegions(projectId);
  const catalog = regionsQuery.data ?? [];
  const catalogEmpty = regionsQuery.isSuccess && catalog.length === 0;
  // A code the model already has that left the catalog stays listed, so it
  // can be unchecked.
  const catalogCodes = new Set(catalog.map((region) => region.code));
  const regionOptions = [
    ...catalog.map((region) => ({
      code: region.code,
      label: `${region.code} — ${region.name}`,
    })),
    ...form.regions
      .filter((code) => regionsQuery.isSuccess && !catalogCodes.has(code))
      .map((code) => ({
        code,
        label: `${code} ${t("settings:projectInfrastructure.models.regionNotInCatalog")}`,
      })),
  ];

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) return;
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;

    const body: InfraModelInput = {
      name: form.name.trim(),
      provider: form.provider,
      family: form.family.trim() || null,
      // Catalog order, then the codes outside the catalog.
      regions: [
        ...catalog
          .map((region) => region.code)
          .filter((code) => form.regions.includes(code)),
        ...form.regions.filter((code) => !catalogCodes.has(code)),
      ],
      ramGb: Number(form.ramGb),
      vcpu: Number(form.vcpu),
      storageGb: Number(form.storageGb),
      leadTimeDays: Number(form.leadTimeDays),
      hypervisorReservePercent: Number(form.hypervisorReservePercent),
    };
    const options = { onSuccess: () => onOpenChange(false) };
    if (model) {
      updateModel.mutate({ projectId, modelId: model.id, ...body }, options);
    } else {
      createModel.mutate({ projectId, ...body }, options);
    }
  };

  const errorText = (field: keyof FormState) => {
    const error = submitted ? errors[field] : undefined;
    if (!error) return null;
    const message =
      error === "required"
        ? t("settings:projectInfrastructure.validation.required")
        : error === "regions"
          ? t("settings:projectInfrastructure.validation.regionsRequired")
          : t("settings:projectInfrastructure.validation.integer", {
              min: LIMITS[field as NumberField].min,
              max: LIMITS[field as NumberField].max,
            });
    return (
      <p
        id={`model-${field}-error`}
        className="text-xs text-destructive-foreground"
      >
        {message}
      </p>
    );
  };

  const numberField = (field: NumberField, label: string) => (
    <div className="grid gap-2">
      <Label htmlFor={`model-${field}`}>{label}</Label>
      <Input
        id={`model-${field}`}
        inputMode="numeric"
        value={form[field]}
        onChange={(event) => setField(field, event.target.value)}
        aria-invalid={submitted && errors[field] ? true : undefined}
        aria-describedby={
          submitted && errors[field] ? `model-${field}-error` : undefined
        }
      />
      {errorText(field)}
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isPending) onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={handleSubmit}
          noValidate
        >
          <DialogHeader>
            <DialogTitle>
              {model
                ? t("settings:projectInfrastructure.models.edit")
                : t("settings:projectInfrastructure.models.add")}
            </DialogTitle>
          </DialogHeader>

          <DialogPanel className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="model-name">
                {t("settings:projectInfrastructure.models.columns.name")}
              </Label>
              <Input
                id="model-name"
                value={form.name}
                maxLength={200}
                onChange={(event) => setField("name", event.target.value)}
                aria-invalid={submitted && errors.name ? true : undefined}
                aria-describedby={
                  submitted && errors.name ? "model-name-error" : undefined
                }
                autoFocus
              />
              {errorText("name")}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="model-family">
                {t("settings:projectInfrastructure.models.columns.family")}
              </Label>
              <Input
                id="model-family"
                value={form.family}
                maxLength={200}
                onChange={(event) => setField("family", event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>
                {t("settings:projectInfrastructure.models.columns.provider")}
              </Label>
              <InfraSelect
                ariaLabel={t(
                  "settings:projectInfrastructure.models.columns.provider",
                )}
                placeholder=""
                value={form.provider}
                options={PROVIDERS.map((provider) => ({
                  value: provider,
                  label: t(
                    `settings:projectInfrastructure.providers.${provider}`,
                  ),
                }))}
                onChange={(next) => setField("provider", next as Provider)}
              />
            </div>
            {numberField(
              "ramGb",
              t("settings:projectInfrastructure.models.columns.ram"),
            )}
            {numberField(
              "vcpu",
              t("settings:projectInfrastructure.models.columns.vcpu"),
            )}
            {numberField(
              "storageGb",
              t("settings:projectInfrastructure.models.columns.localDisk"),
            )}
            {numberField(
              "leadTimeDays",
              t("settings:projectInfrastructure.models.columns.leadTime"),
            )}
            {numberField(
              "hypervisorReservePercent",
              t("settings:projectInfrastructure.models.columns.reserve"),
            )}
            <fieldset
              className="grid min-w-0 gap-2 sm:col-span-2"
              aria-describedby={
                submitted && errors.regions ? "model-regions-error" : undefined
              }
            >
              <legend className="mb-2 font-medium text-base/4.5 sm:text-sm/4">
                {t("settings:projectInfrastructure.models.columns.regions")}
              </legend>
              {regionsQuery.isError ? (
                <p className="text-xs text-destructive-foreground">
                  {t("settings:projectInfrastructure.loadError")}
                </p>
              ) : (
                <>
                  {catalogEmpty && (
                    <p className="text-sm text-muted-foreground">
                      {t("settings:projectInfrastructure.models.regionsEmpty")}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {regionOptions.map((option) => (
                      <div
                        key={option.code}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          id={`model-region-${option.code}`}
                          checked={form.regions.includes(option.code)}
                          onCheckedChange={(checked) =>
                            setField(
                              "regions",
                              checked
                                ? [...form.regions, option.code]
                                : form.regions.filter(
                                    (code) => code !== option.code,
                                  ),
                            )
                          }
                        />
                        <Label
                          htmlFor={`model-region-${option.code}`}
                          className="font-normal"
                        >
                          {option.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {errorText("regions")}
            </fieldset>
          </DialogPanel>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={isPending || catalogEmpty || regionsQuery.isError}
            >
              {isPending
                ? t("settings:projectInfrastructure.saving")
                : t("settings:projectInfrastructure.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
