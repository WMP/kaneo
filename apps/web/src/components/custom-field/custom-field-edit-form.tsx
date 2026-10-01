import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import CustomFieldDefaultValueInput from "./custom-field-default-value-input";
import {
  buildUpdatePayload,
  canSaveDraft,
  draftFromField,
  hasOptionColors,
  hasOptions,
  resolveDraft,
} from "./custom-field-form-utils";
import OptionColorSwatch from "./option-color-swatch";
import type { CustomFieldDefinition, UpdateCustomFieldPayload } from "./types";

type CustomFieldEditFormProps = {
  field: CustomFieldDefinition;
  saving: boolean;
  /** Called with the changed properties only (never empty). */
  onSave: (payload: UpdateCustomFieldPayload) => void;
  /** Called when nothing changed, or the user cancels (Cancel or Escape). */
  onCancel: () => void;
};

/** Inline edit form for one custom field definition: name, options, option
 * colors (single-select dropdown), default value and required. The type is shown read-only — it cannot change after
 * creation. The form holds an uncommitted draft; nothing is sent until Save. */
export default function CustomFieldEditForm({
  field,
  saving,
  onSave,
  onCancel,
}: CustomFieldEditFormProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => draftFromField(field));
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const resolved = resolveDraft(field, draft);
  const showOptions = hasOptions(field.type);
  const showOptionColors =
    hasOptionColors(field.type) && resolved.options.length > 0;
  const idPrefix = `custom-field-edit-${field.id}`;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !canSaveDraft(field, draft)) return;

    const payload = buildUpdatePayload(field, draft);
    if (Object.keys(payload).length === 0) {
      onCancel();
      return;
    }
    onSave(payload);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    // An open popover (calendar, option list) consumes Escape for itself.
    if (event.key === "Escape" && !event.defaultPrevented && !saving) {
      event.stopPropagation();
      onCancel();
    }
  }

  return (
    <form
      aria-label={t("settings:customFields.editFormAriaLabel", {
        name: field.name,
      })}
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className="min-w-0 flex-1 space-y-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-[2_1_0] space-y-1">
          <label
            htmlFor={`${idPrefix}-name`}
            className="text-xs text-muted-foreground"
          >
            {t("settings:customFields.nameLabel")}
          </label>
          <Input
            ref={nameRef}
            id={`${idPrefix}-name`}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={t("settings:customFields.namePlaceholder")}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <span className="block text-xs text-muted-foreground">
            {t("settings:customFields.typeLabel")}
          </span>
          <span
            title={t("settings:customFields.typeReadOnlyHint")}
            className="inline-flex h-8 items-center rounded bg-muted px-2 text-xs text-muted-foreground"
          >
            {t(`settings:customFields.types.${field.type}`)}
          </span>
        </div>
      </div>

      {showOptions && (
        <div className="space-y-1">
          <label
            htmlFor={`${idPrefix}-options`}
            className="text-xs text-muted-foreground"
          >
            {t("settings:customFields.optionsLabel")}
          </label>
          <Input
            id={`${idPrefix}-options`}
            value={draft.optionsText}
            onChange={(e) =>
              setDraft({ ...draft, optionsText: e.target.value })
            }
            placeholder={t("settings:customFields.optionsPlaceholder")}
            className="h-8 text-sm"
          />
        </div>
      )}

      {showOptionColors && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {t("settings:customFields.optionColorsLabel")}
          </span>
          {resolved.options.map((option) => (
            <div key={option} className="flex items-center gap-1.5">
              <OptionColorSwatch
                color={resolved.optionColors[option]}
                ariaLabel={t("settings:customFields.optionColorAriaLabel", {
                  option,
                })}
                onSelect={(colorValue) =>
                  setDraft({
                    ...draft,
                    optionColors: {
                      ...draft.optionColors,
                      [option]: colorValue,
                    },
                  })
                }
              />
              <span className="max-w-32 truncate text-xs text-muted-foreground">
                {option}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <span className="block text-xs text-muted-foreground">
            {t("settings:customFields.defaultValueLabel")}
          </span>
          <CustomFieldDefaultValueInput
            type={field.type}
            value={resolved.defaultValue}
            onChange={(defaultValue) => setDraft({ ...draft, defaultValue })}
            options={resolved.options}
            clearable={!draft.required}
            allowBooleanUnset={!draft.required}
            ariaLabel={t("settings:customFields.defaultValueLabel")}
          />
        </div>
        <div className="flex h-8 items-center gap-2">
          <Checkbox
            id={`${idPrefix}-required`}
            checked={draft.required}
            onCheckedChange={(checked) =>
              setDraft({ ...draft, required: Boolean(checked) })
            }
            className="h-4 w-4"
          />
          <label
            htmlFor={`${idPrefix}-required`}
            className="text-xs text-muted-foreground whitespace-nowrap"
          >
            {t("settings:customFields.required")}
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={saving}
          className="h-8"
        >
          {t("settings:customFields.cancelButton")}
        </Button>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={saving || !canSaveDraft(field, draft)}
          className="h-8"
        >
          {saving
            ? t("settings:customFields.saving")
            : t("settings:customFields.saveButton")}
        </Button>
      </div>
    </form>
  );
}
