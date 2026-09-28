import { CheckSquare, Hash, List, Lock, Type } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { CustomFieldDefinition, CustomFieldType } from "./types";

const FIELD_TYPE_ICONS: Record<CustomFieldType, React.ElementType> = {
  text: Type,
  number: Hash,
  date: Hash,
  dropdown: List,
  multiselect: List,
  boolean: CheckSquare,
};

export type InheritedCustomFieldsListProps = {
  fields: CustomFieldDefinition[];
  isLoading: boolean;
  onToggle: (fieldId: string, hidden: boolean) => Promise<unknown>;
  togglingFieldId: string | null;
};

/** Lists the workspace-level fields a project inherits, each with a
 * hide/show toggle scoped to this project only. A required workspace field
 * (hideable: false) can never be hidden here, so its toggle is locked on. */
export default function InheritedCustomFieldsList({
  fields,
  isLoading,
  onToggle,
  togglingFieldId,
}: InheritedCustomFieldsListProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("settings:customFields.loading")}
      </div>
    );
  }

  if (fields.length === 0) {
    return (
      <div className="text-sm text-muted-foreground border border-border rounded-md bg-sidebar p-4">
        {t("settings:customFields.inheritedEmpty")}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {fields.map((field) => {
        const FieldIcon = FIELD_TYPE_ICONS[field.type] ?? Type;
        // A required workspace field is mandatory everywhere and can never
        // be hidden — its switch shows visible and stays locked.
        const isLocked = !field.hideable;
        const visible = !field.hidden;
        const isToggling = togglingFieldId === field.id;

        return (
          <div
            key={field.id}
            className="flex items-center gap-2 p-2 border border-border rounded-md bg-sidebar"
          >
            <FieldIcon className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
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
                {isLocked && (
                  <span
                    className={cn(
                      "shrink-0 inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground",
                    )}
                  >
                    <Lock className="w-3 h-3" />
                    {t("settings:customFields.requiredByWorkspace")}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground">
                {visible
                  ? t("settings:customFields.visibleOnProject")
                  : t("settings:customFields.hiddenOnProject")}
              </span>
              <Switch
                checked={visible}
                disabled={isLocked || isToggling}
                aria-label={
                  visible
                    ? t("settings:customFields.hideField", { name: field.name })
                    : t("settings:customFields.showField", { name: field.name })
                }
                onCheckedChange={(checked) => void onToggle(field.id, !checked)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
