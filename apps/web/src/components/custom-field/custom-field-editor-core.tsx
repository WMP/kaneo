import {
  CalendarIcon,
  CheckSquare,
  GripVertical,
  Hash,
  List,
  Pencil,
  Plus,
  Trash2,
  Type,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/preview-card";
import labelColors from "@/constants/label-colors";
import { resolveLabelColor } from "@/lib/label-color";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import CustomFieldDefaultValueInput from "./custom-field-default-value-input";
import CustomFieldEditForm from "./custom-field-edit-form";
import { parseOptionsText } from "./custom-field-form-utils";
import type {
  CreateCustomFieldPayload,
  CustomFieldDefinition,
  CustomFieldType,
  UpdateCustomFieldPayload,
} from "./types";

/** A small color-dot button that opens the shared label palette (see
 * constants/label-colors.ts) to assign a color to one dropdown option.
 * Reused for both the create form (uncommitted colors) and existing fields
 * (persisted immediately via onSelect). */
function OptionColorSwatch({
  color,
  ariaLabel,
  onSelect,
}: {
  color: string | undefined;
  ariaLabel: string;
  onSelect: (colorValue: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "size-3.5 shrink-0 rounded-full border transition-transform hover:scale-110",
            color
              ? "border-transparent"
              : "border-dashed border-muted-foreground/50",
          )}
          style={
            color ? { backgroundColor: resolveLabelColor(color) } : undefined
          }
        />
      </PopoverTrigger>
      <PopoverContent className="w-40" align="start">
        <div className="flex flex-wrap gap-1.5 p-1">
          {labelColors.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.label}
              aria-label={c.label}
              className={cn(
                "size-6 rounded-full border-2 transition-[scale,border-color]",
                color === c.value
                  ? "border-foreground scale-110"
                  : "border-transparent hover:scale-110",
              )}
              style={{ backgroundColor: c.color }}
              onClick={() => onSelect(c.value)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const CUSTOM_FIELD_TYPES: Array<{
  value: CustomFieldType;
  icon: React.ElementType;
  availableOnTask?: boolean;
}> = [
  { value: "text", icon: Type, availableOnTask: true },
  { value: "number", icon: Hash, availableOnTask: true },
  { value: "date", icon: CalendarIcon, availableOnTask: true },
  { value: "dropdown", icon: List, availableOnTask: true },
  { value: "multiselect", icon: List, availableOnTask: false },
  { value: "boolean", icon: CheckSquare, availableOnTask: true },
];

export type CustomFieldEditorCoreProps = {
  fields: CustomFieldDefinition[];
  isLoading: boolean;
  onCreate: (payload: CreateCustomFieldPayload) => Promise<unknown>;
  creating: boolean;
  onDelete: (id: string) => Promise<unknown>;
  deleting: boolean;
  onReorder: (
    fields: Array<{ id: string; position: number }>,
  ) => Promise<unknown>;
  onUpdateOptionColor: (
    fieldId: string,
    optionColors: Record<string, string>,
  ) => Promise<unknown>;
  /** Saves the edited properties of one field (name, required, default value,
   * options). The type is immutable and never sent. */
  onUpdate: (
    fieldId: string,
    payload: UpdateCustomFieldPayload,
  ) => Promise<unknown>;
};

/** The reusable "manage a flat list of custom field definitions" UI: a
 * drag-to-reorder list with edit/delete/color-swatch actions, plus a create
 * form. One row at a time can be switched into an inline edit form.
 * Used both by the project editor (its own fields) and the workspace editor
 * (workspace-level fields) — the two differ only in which fields they pass
 * in and where their mutations are scoped, via the callbacks above. */
export default function CustomFieldEditorCore({
  fields: customFields,
  isLoading: customFieldsLoading,
  onCreate,
  creating: savingField,
  onDelete,
  deleting: deletingField,
  onReorder,
  onUpdateOptionColor,
  onUpdate,
}: CustomFieldEditorCoreProps) {
  const { t } = useTranslation();

  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [required, setRequired] = useState(false);

  const [isMultiple, setIsMultiple] = useState(false);

  const [defaultValue, setDefaultValue] = useState<string | string[]>("");
  const [optionsText, setOptionsText] = useState("");
  // Uncommitted per-option colors for the field currently being built below —
  // only meaningful while type === "dropdown" && !isMultiple (the API only
  // accepts optionColors for a single-select dropdown field).
  const [pendingOptionColors, setPendingOptionColors] = useState<
    Record<string, string>
  >({});
  const [deletingFieldId, setDeletingFieldId] = useState<string | null>(null);
  // The one row currently shown as an inline edit form, and whether its save
  // request is in flight.
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [pendingFields, setPendingFields] = useState<
    CustomFieldDefinition[] | null
  >(null);
  const [isReordering, setIsReordering] = useState(false);

  const dragPreviewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (type !== "boolean") return;

    if (defaultValue !== "true" && defaultValue !== "false") {
      setDefaultValue("false");
    }
  }, [type, defaultValue]);

  useEffect(() => {
    return () => {
      dragPreviewRef.current?.remove();
    };
  }, []);

  useEffect(() => {
    setPendingFields(null);
  }, []);

  async function handleCreate() {
    try {
      if (!name.trim()) return;

      const options =
        type === "dropdown" ? parseOptionsText(optionsText) : undefined;

      let apiDefaultValue: string | undefined;

      const apiType: CustomFieldType =
        type === "dropdown" && isMultiple ? "multiselect" : type;

      if (apiType === "multiselect") {
        if (Array.isArray(defaultValue) && defaultValue.length > 0) {
          apiDefaultValue = JSON.stringify(defaultValue);
        }
      } else if (apiType === "dropdown") {
        if (typeof defaultValue === "string" && defaultValue.trim() !== "") {
          apiDefaultValue = defaultValue;
        }
      } else if (typeof defaultValue === "string") {
        if (defaultValue.trim() !== "") {
          apiDefaultValue = defaultValue;
        }
      }

      // Colors only apply to a single-select dropdown (see the field on
      // pendingOptionColors above); prune to options that survived dedupe.
      const optionColors =
        apiType === "dropdown" && options
          ? Object.fromEntries(
              Object.entries(pendingOptionColors).filter(([option]) =>
                options.includes(option),
              ),
            )
          : undefined;

      await onCreate({
        name: name.trim(),
        type: apiType,
        required,
        defaultValue: apiDefaultValue,
        options,
        optionColors:
          optionColors && Object.keys(optionColors).length > 0
            ? optionColors
            : undefined,
      });

      setName("");
      setType("text");
      setRequired(false);
      setIsMultiple(false);
      setDefaultValue("");
      setOptionsText("");
      setPendingOptionColors({});

      toast.success(t("settings:customFields.createSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:customFields.createError"),
      );
    }
  }

  // A field that disappears (deleted elsewhere, refetch) closes its editor.
  const editingField = editingFieldId
    ? (customFields.find((field) => field.id === editingFieldId) ?? null)
    : null;
  const isEditing = editingField !== null;

  function closeEditor(fieldId: string) {
    setEditingFieldId(null);
    // The form unmounts; hand focus back to the row's Edit button.
    requestAnimationFrame(() => {
      document.getElementById(`custom-field-edit-button-${fieldId}`)?.focus();
    });
  }

  async function handleSaveEdit(
    fieldId: string,
    payload: UpdateCustomFieldPayload,
  ) {
    try {
      setSavingEdit(true);
      await onUpdate(fieldId, payload);
      toast.success(t("settings:customFields.updateSuccess"));
      closeEditor(fieldId);
    } catch (error) {
      // Stay in edit mode so the draft is not lost.
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("settings:customFields.updateError"),
      );
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      setDeletingFieldId(id);
      await onDelete(id);
      toast.success(t("settings:customFields.deleteSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:customFields.deleteError"),
      );
    } finally {
      setDeletingFieldId(null);
    }
  }

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    index: number,
  ) => {
    if (isReordering || isEditing) return;

    if (!pendingFields && customFields) {
      setPendingFields(customFields);
    }

    setDraggedIndex(index);

    dragPreviewRef.current?.remove();

    const sourceElement = e.currentTarget;
    const sourceRect = sourceElement.getBoundingClientRect();

    const dragPreview = sourceElement.cloneNode(true) as HTMLDivElement;

    dragPreview.setAttribute("aria-hidden", "true");
    dragPreview.inert = true;

    Object.assign(dragPreview.style, {
      position: "fixed",
      top: "-10000px",
      left: "-10000px",
      width: `${sourceRect.width}px`,
      height: `${sourceRect.height}px`,
      margin: "0",
      boxSizing: "border-box",
      overflow: "hidden",
      pointerEvents: "none",
      transform: "none",
      contain: "layout paint",
    });

    document.body.appendChild(dragPreview);
    dragPreviewRef.current = dragPreview;

    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    e.dataTransfer.setDragImage(
      dragPreview,
      e.clientX - sourceRect.left,
      e.clientY - sourceRect.top,
    );
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();

    if (draggedIndex === null) return;

    const currentFields = pendingFields ?? customFields;
    if (!currentFields || draggedIndex === index) return;

    const reordered = [...currentFields];
    const [removed] = reordered.splice(draggedIndex, 1);
    reordered.splice(index, 0, removed);

    setPendingFields(reordered);
    setDraggedIndex(index);
  };

  const handleDragEnd = async () => {
    if (isReordering) return;

    const finalFields = pendingFields ?? customFields;

    setDraggedIndex(null);

    dragPreviewRef.current?.remove();
    dragPreviewRef.current = null;

    if (!finalFields) {
      setPendingFields(null);
      return;
    }

    if (pendingFields === null) {
      return;
    }
    if (isReordering) return;

    try {
      const updates = finalFields.map((col, i) => ({
        id: col.id,
        position: i,
      }));

      await onReorder(updates);

      setPendingFields(null);
    } catch (error) {
      setPendingFields(null);

      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:customFields.reorderError"),
      );
    } finally {
      setIsReordering(false);
    }
  };

  const hasExtraInput =
    type === "dropdown" || type === "date" || type === "boolean";

  const dropdownOptions = useMemo(
    () => parseOptionsText(optionsText),
    [optionsText],
  );

  // Colors only apply to a single-select dropdown; drop stale entries once
  // an option is renamed/removed or the field stops being a plain dropdown.
  useEffect(() => {
    if (type !== "dropdown" || isMultiple) {
      if (Object.keys(pendingOptionColors).length > 0) {
        setPendingOptionColors({});
      }
      return;
    }
    setPendingOptionColors((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([option]) =>
          dropdownOptions.includes(option),
        ),
      );
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next;
    });
  }, [type, isMultiple, dropdownOptions, pendingOptionColors]);

  useEffect(() => {
    if (type !== "dropdown") {
      if (isMultiple) setIsMultiple(false);
      if (Array.isArray(defaultValue)) {
        setDefaultValue(defaultValue[0] ?? "");
      } else if (
        type !== "boolean" &&
        (defaultValue === "true" || defaultValue === "false")
      ) {
        setDefaultValue("");
      }
      return;
    }

    if (isMultiple) {
      if (!Array.isArray(defaultValue)) {
        setDefaultValue(defaultValue ? [defaultValue] : []);
      }
    } else {
      if (Array.isArray(defaultValue)) {
        setDefaultValue(defaultValue[0] ?? "");
      }
    }
  }, [isMultiple, type, defaultValue]);

  useEffect(() => {
    if (type !== "dropdown") return;

    if (isMultiple) {
      if (Array.isArray(defaultValue)) {
        const stillValid = defaultValue.filter((v) =>
          dropdownOptions.includes(v),
        );
        if (stillValid.length !== defaultValue.length) {
          setDefaultValue(stillValid);
        }
      }
    } else {
      if (typeof defaultValue === "string" && defaultValue !== "") {
        if (
          dropdownOptions.length === 0 ||
          !dropdownOptions.includes(defaultValue)
        ) {
          setDefaultValue("");
        }
      }
    }
  }, [dropdownOptions, isMultiple, type, defaultValue]);

  const currentType = CUSTOM_FIELD_TYPES.find((t) => t.value === type);
  const CurrentIcon = currentType?.icon || Type;

  const fieldsToRender = pendingFields ?? customFields;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {customFieldsLoading ? (
          <div className="text-sm text-muted-foreground">
            {t("settings:customFields.loading")}
          </div>
        ) : fieldsToRender.length === 0 ? (
          <div className="text-sm text-muted-foreground border border-border rounded-md bg-sidebar p-4">
            {t("settings:customFields.empty")}
          </div>
        ) : (
          fieldsToRender.map((field, index) => {
            const FieldType = CUSTOM_FIELD_TYPES.find(
              (t) => t.value === field.type,
            );
            const FieldIcon = FieldType?.icon || Type;

            const isDragging = draggedIndex === index;
            const isHovered = draggedIndex !== null && draggedIndex !== index;

            let defaultParsedValues: string[] | null = null;
            let defaultDisplayValue = field.defaultValue ?? "";

            if (field.defaultValue) {
              try {
                const parsed = JSON.parse(field.defaultValue);
                if (Array.isArray(parsed)) {
                  defaultParsedValues = parsed;
                  defaultDisplayValue = parsed.join(", ");
                }
              } catch {}
            }

            const defaultValueCanHover =
              Boolean(field.defaultValue) &&
              (field.type === "dropdown" || field.type === "multiselect") &&
              (defaultParsedValues
                ? defaultParsedValues.length > 0
                : Boolean(defaultDisplayValue));

            if (field.id === editingField?.id) {
              return (
                // biome-ignore lint/a11y/useSemanticElements: false positive for role="listitem"
                <div
                  key={field.id}
                  role="listitem"
                  className="flex items-start gap-2 rounded-md border border-border bg-sidebar p-3"
                >
                  <FieldIcon className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <CustomFieldEditForm
                    field={field}
                    saving={savingEdit}
                    onSave={(payload) => void handleSaveEdit(field.id, payload)}
                    onCancel={() => closeEditor(field.id)}
                  />
                </div>
              );
            }

            return (
              // biome-ignore lint/a11y/useSemanticElements: false positive for role="listitem"
              <div
                key={field.id}
                role="listitem"
                draggable={!isReordering && !isEditing}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={cn(
                  "flex items-center gap-2 p-2 border border-border rounded-md bg-sidebar transition-colors active:cursor-grabbing",
                  isDragging && "opacity-50 cursor-grabbing",
                  isHovered && "bg-sidebar-accent",
                  !isDragging && "hover:bg-sidebar-accent/50",
                )}
              >
                <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <FieldIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="min-w-0 max-w-[16rem] truncate text-sm font-medium">
                      {field.name}
                    </span>
                    <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {t(`settings:customFields.types.${field.type}`)}
                    </span>
                    {field.required && (
                      <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {t("settings:customFields.required")}
                      </span>
                    )}
                    {(field.type === "dropdown" ||
                      field.type === "multiselect") &&
                    field.options?.length ? (
                      <HoverCard>
                        <HoverCardTrigger asChild>
                          <span className="shrink-0 inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground cursor-pointer hover:bg-muted/80 transition-colors">
                            {t("settings:customFields.options", {
                              count: field.options.length,
                            })}
                          </span>
                        </HoverCardTrigger>
                        <HoverCardContent
                          className="w-64 max-w-[calc(100vw-3rem)] overflow-hidden"
                          align="start"
                        >
                          <div className="min-w-0 space-y-1.5">
                            <div className="text-xs font-medium text-muted-foreground">
                              {t(
                                "settings:customFields.availableOptions",
                                "Available options",
                              )}
                            </div>

                            <div className="flex min-w-0 max-h-48 flex-wrap gap-1.5 overflow-y-auto overflow-x-hidden">
                              {field.options.map((option) => (
                                <span
                                  key={`field_${field.id}_option_${option}`}
                                  className="min-w-0 max-w-full whitespace-normal break-all rounded bg-secondary px-2.5 py-1 text-xs"
                                >
                                  {option}
                                </span>
                              ))}
                            </div>
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                    ) : null}
                    {field.defaultValue &&
                      (defaultValueCanHover ? (
                        <HoverCard>
                          <HoverCardTrigger asChild>
                            <span className="shrink-0 inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground cursor-pointer hover:bg-muted/80 transition-colors">
                              {t("settings:customFields.defaultValues", {
                                count: defaultParsedValues?.length ?? 1,
                              })}
                            </span>
                          </HoverCardTrigger>
                          <HoverCardContent
                            className="w-64 max-w-[calc(100vw-3rem)] overflow-hidden"
                            align="start"
                          >
                            <div className="min-w-0 space-y-1.5">
                              <div className="text-xs font-medium text-muted-foreground">
                                {t("settings:customFields.defaultLabel")}
                              </div>

                              {defaultParsedValues ? (
                                <div className="flex min-w-0 max-h-48 flex-wrap gap-1.5 overflow-y-auto overflow-x-hidden">
                                  {defaultParsedValues.map((value) => (
                                    <span
                                      key={`field_${field.id}_default_${value}`}
                                      className="min-w-0 max-w-full whitespace-normal break-all rounded bg-secondary px-2.5 py-1 text-xs"
                                    >
                                      {value}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="min-w-0 max-w-full whitespace-normal break-words text-xs text-foreground">
                                  {defaultDisplayValue}
                                </p>
                              )}
                            </div>
                          </HoverCardContent>
                        </HoverCard>
                      ) : (
                        <span className="min-w-0 max-w-[12rem] truncate text-xs text-muted-foreground">
                          {t("settings:customFields.defaultLabel")}:{" "}
                          <span className="text-foreground">
                            {defaultDisplayValue}
                          </span>
                        </span>
                      ))}
                    {field.type === "dropdown" && field.options?.length ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {field.options.map((option) => (
                          <OptionColorSwatch
                            key={option}
                            color={field.optionColors?.[option]}
                            ariaLabel={t(
                              "settings:customFields.optionColorAriaLabel",
                              { option },
                            )}
                            onSelect={async (colorValue) => {
                              try {
                                await onUpdateOptionColor(field.id, {
                                  ...(field.optionColors ?? {}),
                                  [option]: colorValue,
                                });
                              } catch (error) {
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : t(
                                        "settings:customFields.updateColorError",
                                      ),
                                );
                              }
                            }}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <Button
                  type="button"
                  id={`custom-field-edit-button-${field.id}`}
                  variant="ghost"
                  size="sm"
                  aria-label={t("settings:customFields.editFieldAriaLabel", {
                    name: field.name,
                  })}
                  disabled={isEditing || deletingFieldId === field.id}
                  onClick={() => setEditingFieldId(field.id)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={deletingField || deletingFieldId === field.id}
                  onClick={() => void handleDelete(field.id)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="sr-only">
                    {t("settings:customFields.deleteButton")}
                  </span>
                </Button>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center gap-2 w-full">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 shrink-0"
              title={t("settings:customFields.typePlaceholder")}
            >
              <CurrentIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48" align="start">
            <div className="space-y-1 px-0.5 py-1">
              {CUSTOM_FIELD_TYPES.filter((item) => item.availableOnTask).map(
                (item) => {
                  const Icon = item.icon;
                  return (
                    <Button
                      key={item.value}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setType(item.value)}
                      className={cn(
                        "w-full justify-start gap-2 text-sm rounded-sm",
                        type === item.value &&
                          "bg-sidebar-accent text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {t(`settings:customFields.types.${item.value}`)}
                    </Button>
                  );
                },
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("settings:customFields.namePlaceholder")}
          className={cn(
            "h-8 text-sm",
            hasExtraInput ? "w-32 flex-[2_0_0]" : "flex-1",
          )}
        />

        {type === "dropdown" && (
          <Input
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            placeholder={t("settings:customFields.optionsPlaceholder")}
            className="h-8 text-sm w-48 flex-[2_0_0]"
          />
        )}

        {type !== "dropdown" ? (
          <CustomFieldDefaultValueInput
            type={type}
            value={defaultValue}
            onChange={setDefaultValue}
            options={dropdownOptions}
            clearable={!required}
          />
        ) : (
          <>
            <CustomFieldDefaultValueInput
              type={isMultiple ? "multiselect" : "dropdown"}
              value={defaultValue}
              onChange={setDefaultValue}
              options={dropdownOptions}
              clearable={!required}
            />
            <Checkbox
              id="dropdown-multiple"
              checked={isMultiple}
              onCheckedChange={(checked) => {
                const next = Boolean(checked);
                setIsMultiple(next);
                setDefaultValue(next ? [] : "");
              }}
              className="h-4 w-4"
            />
            <label
              htmlFor="dropdown-multiple"
              className="text-xs text-muted-foreground whitespace-nowrap"
            >
              {t("settings:customFields.multiple")}
            </label>
          </>
        )}

        <div className="flex items-center gap-2 shrink-0">
          <Checkbox
            id="required-field"
            checked={required}
            onCheckedChange={(checked) => setRequired(Boolean(checked))}
            className="h-4 w-4"
          />
          <label
            htmlFor="required-field"
            className="text-xs text-muted-foreground whitespace-nowrap"
          >
            {t("settings:customFields.required")}
          </label>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCreate}
          disabled={
            !name.trim() ||
            savingField ||
            (required &&
              (Array.isArray(defaultValue)
                ? defaultValue.length === 0
                : !defaultValue)) ||
            (type === "dropdown" &&
              dropdownOptions.length < (isMultiple ? 2 : 1))
          }
          className="h-8 gap-1 shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("settings:customFields.addButton")}
        </Button>
      </div>

      {type === "dropdown" && !isMultiple && dropdownOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 pl-1">
          <span className="text-xs text-muted-foreground">
            {t("settings:customFields.optionColorsLabel")}
          </span>
          {dropdownOptions.map((option) => (
            <div key={option} className="flex items-center gap-1.5">
              <OptionColorSwatch
                color={pendingOptionColors[option]}
                ariaLabel={t("settings:customFields.optionColorAriaLabel", {
                  option,
                })}
                onSelect={(colorValue) =>
                  setPendingOptionColors((current) => ({
                    ...current,
                    [option]: colorValue,
                  }))
                }
              />
              <span className="max-w-32 truncate text-xs text-muted-foreground">
                {option}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
