import { format, isValid, parseISO } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Combobox,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxValue,
} from "@/components/ui/combobox";
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
import { formatDateMedium } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CustomFieldType } from "./types";

export type DefaultValueInputProps = {
  /** The field's API type: a multiple dropdown is `multiselect`. */
  type: CustomFieldType;
  /** A string for every type but multiselect, which holds an array. */
  value: string | string[];
  onChange: (value: string | string[]) => void;
  /** The option list a dropdown default must come from. */
  options: string[];
  /** Whether a single dropdown default may be cleared (not when required). */
  clearable: boolean;
  /** Whether pressing the selected boolean value again unsets it. */
  allowBooleanUnset?: boolean;
  ariaLabel?: string;
};

/** The default-value control for a custom field definition, matching its
 * type. Shared by the create form and the inline edit form of
 * CustomFieldEditorCore so both keep one set of rules for what a default can
 * be. Purely controlled: it holds no state of its own. */
export default function CustomFieldDefaultValueInput({
  type,
  value: defaultValue,
  onChange,
  options,
  clearable,
  allowBooleanUnset = false,
  ariaLabel,
}: DefaultValueInputProps) {
  const { t } = useTranslation();
  const isMultiple = type === "multiselect";

  if (type === "date") {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            aria-label={ariaLabel}
            className={cn(
              "h-8 w-48 flex-[2_0_0] justify-start bg-background text-left text-sm font-normal",
              !(typeof defaultValue === "string" && defaultValue) &&
                "text-muted-foreground",
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 opacity-70" />
            {typeof defaultValue === "string" &&
            defaultValue &&
            isValid(parseISO(defaultValue))
              ? formatDateMedium(parseISO(defaultValue))
              : t("tasks:detail.pickDate", "Pick a date")}
          </Button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={
              typeof defaultValue === "string" &&
              defaultValue &&
              isValid(parseISO(defaultValue))
                ? parseISO(defaultValue)
                : undefined
            }
            onSelect={(date) => {
              onChange(date ? format(date, "yyyy-MM-dd") : "");
            }}
            captionLayout="dropdown"
          />
        </PopoverContent>
      </Popover>
    );
  }

  if (type === "boolean") {
    return (
      // biome-ignore lint/a11y/useSemanticElements: a fieldset would restyle the segmented control
      <div
        role="group"
        aria-label={ariaLabel}
        className="inline-flex h-8 w-48 flex-[2_0_0] items-center overflow-hidden rounded-lg border text-xs"
      >
        {(["true", "false"] as const).map((val) => {
          const isSelected = defaultValue === val;
          return (
            <button
              key={val}
              type="button"
              onClick={() =>
                onChange(isSelected && allowBooleanUnset ? "" : val)
              }
              className={cn(
                "flex-1 h-full flex items-center justify-center capitalize transition-colors",
                isSelected
                  ? "bg-foreground text-background font-medium"
                  : "text-muted-foreground hover:bg-muted",
              )}
              aria-pressed={isSelected}
            >
              {val === "true"
                ? t("common:boolean.true", "True")
                : t("common:boolean.false", "False")}
            </button>
          );
        })}
      </div>
    );
  }

  if (type === "dropdown" || type === "multiselect") {
    return (
      <Combobox
        key={isMultiple ? "multi" : "single"}
        multiple={isMultiple}
        autoHighlight
        items={options}
        value={
          isMultiple
            ? Array.isArray(defaultValue)
              ? defaultValue
              : []
            : typeof defaultValue === "string"
              ? defaultValue
              : ""
        }
        onValueChange={(value) => {
          onChange(isMultiple ? (value ?? []) : (value ?? ""));
        }}
        disabled={options.length === 0}
      >
        <ComboboxChips
          className={cn(
            "h-8 min-w-0 w-48 flex-[2_0_0] select-none cursor-default",
            "overflow-hidden",
            "flex-nowrap",
          )}
        >
          <ComboboxValue>
            {(values: string[] | string) => {
              const selected: string[] = isMultiple
                ? Array.isArray(values)
                  ? values.filter((v) => v !== "")
                  : []
                : typeof values === "string" && values !== ""
                  ? [values]
                  : [];

              const MAX_VISIBLE_CHIPS = 3;
              const visibleChips = selected.slice(0, MAX_VISIBLE_CHIPS);
              const hiddenCount = selected.length - MAX_VISIBLE_CHIPS;

              return (
                <>
                  {visibleChips.map((value) => {
                    if (isMultiple) {
                      return (
                        <div
                          key={value}
                          className={cn(
                            "min-w-0 max-w-full flex-1 shrink basis-0",
                            "inline-flex items-center overflow-hidden",
                            "rounded-md bg-secondary px-1.5 py-0.5",
                            "select-none cursor-default",
                          )}
                        >
                          <span className="block min-w-0 max-w-full truncate text-xs text-secondary-foreground">
                            {value}
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={value}
                        className={cn(
                          "min-w-0 max-w-full flex-1 shrink basis-0",
                          "inline-flex items-center overflow-hidden",
                          "ps-1.5",
                          "select-none cursor-default",
                        )}
                      >
                        <span className="block min-w-0 max-w-full truncate text-xs">
                          {value}
                        </span>
                      </div>
                    );
                  })}

                  {selected.length > MAX_VISIBLE_CHIPS && (
                    <HoverCard>
                      <HoverCardTrigger asChild>
                        <button
                          type="button"
                          className="shrink-0 inline-flex items-center gap-1 text-xs font-medium cursor-pointer text-foreground/50 pe-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                          }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                          }}
                        >
                          {t("settings:customFields.moreOptions", {
                            hiddenCount,
                          })}
                        </button>
                      </HoverCardTrigger>

                      <HoverCardContent
                        side="top"
                        align="start"
                        className="flex max-w-xs flex-wrap gap-1 overflow-hidden"
                      >
                        <div className="min-w-0 space-y-1.5">
                          <div className="text-xs font-medium text-muted-foreground">
                            {t(
                              "settings:customFields.availableOptions",
                              "Available options",
                            )}
                          </div>

                          <div className="flex min-w-0 max-h-48 flex-wrap gap-x-1.5 gap-y-1.5 overflow-y-auto overflow-x-hidden">
                            {selected.slice(MAX_VISIBLE_CHIPS).map((value) => (
                              <div
                                key={value}
                                className={cn(
                                  "min-w-0 max-w-full",
                                  "inline-flex items-center overflow-hidden",
                                  "rounded bg-secondary px-1.5 py-0.5",
                                  "select-none cursor-default",
                                )}
                              >
                                <span className="block min-w-0 max-w-[14rem] truncate text-xs">
                                  {value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                  )}

                  <ComboboxChipsInput
                    aria-label={ariaLabel}
                    className={cn(
                      "min-w-0 flex-1 caret-transparent",
                      selected.length > 0 && "hidden",
                      "pointer-events-none",
                      "placeholder:text-foreground/50",
                      isMultiple && "text-transparent",
                    )}
                    placeholder={
                      options.length === 0
                        ? t(
                            "settings:customFields.noOptionsPlaceholder",
                            "No options",
                          )
                        : selected.length === 0
                          ? t(
                              "settings:customFields.defaultValuePlaceholder",
                              "Default value",
                            )
                          : undefined
                    }
                  />

                  {!isMultiple && clearable && selected.length > 0 && (
                    <button
                      type="button"
                      className="ml-auto shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onChange("");
                      }}
                      aria-label={t(
                        "settings:customFields.clearDefault",
                        "Clear",
                      )}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </>
              );
            }}
          </ComboboxValue>
        </ComboboxChips>

        <ComboboxPopup>
          <ComboboxEmpty>
            {t("settings:customFields.noOptionsPlaceholder", "No options")}
          </ComboboxEmpty>

          <ComboboxList>
            {(option: string) => (
              <ComboboxItem
                className="min-w-0 max-w-full"
                key={`field_option_${option}`}
                value={option}
              >
                <span className="block max-w-38 truncate">{option}</span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    );
  }

  if (type === "number") {
    return (
      <Input
        value={typeof defaultValue === "string" ? defaultValue : ""}
        type="number"
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        placeholder={t("settings:customFields.defaultValuePlaceholder")}
        className="h-8 text-sm w-48 flex-[2_0_0]"
      />
    );
  }

  return (
    <Input
      value={typeof defaultValue === "string" ? defaultValue : ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      placeholder={t("settings:customFields.defaultValuePlaceholder")}
      className="h-8 text-sm w-48 flex-[2_0_0]"
    />
  );
}
