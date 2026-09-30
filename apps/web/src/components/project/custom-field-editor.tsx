import { useState } from "react";
import { useTranslation } from "react-i18next";
import CustomFieldEditorCore from "@/components/custom-field/custom-field-editor-core";
import InheritedCustomFieldsList from "@/components/custom-field/inherited-custom-fields-list";
import type { CustomFieldDefinition } from "@/components/custom-field/types";
import useCreateCustomField from "@/hooks/mutations/custom-field/use-create-custom-field";
import useDeleteCustomField from "@/hooks/mutations/custom-field/use-delete-custom-field";
import { useReorderCustomFields } from "@/hooks/mutations/custom-field/use-reorder-custom-field";
import useSetCustomFieldVisibility from "@/hooks/mutations/custom-field/use-set-custom-field-visibility";
import useUpdateCustomField from "@/hooks/mutations/custom-field/use-update-custom-field";
import useGetCustomFieldsByProject from "@/hooks/queries/custom-field/use-get-custom-fields-by-project";
import { toast } from "@/lib/toast";

// Re-exported for existing consumers (e.g. board-toolbar.tsx) that import
// the definition shape from this module.
export type { CustomFieldDefinition } from "@/components/custom-field/types";

type CustomFieldEditorProps = {
  projectId: string;
};

export default function CustomFieldEditor({
  projectId,
}: CustomFieldEditorProps) {
  const { t } = useTranslation();

  // includeHidden=true returns every inherited workspace field (hidden ones
  // included, with their real per-project hidden state) plus this project's
  // own fields — everything this editor needs to manage.
  const { data: allFields = [], isLoading } = useGetCustomFieldsByProject(
    projectId,
    true,
  ) as { data: CustomFieldDefinition[] | undefined; isLoading: boolean };

  const inheritedFields = allFields.filter(
    (field) => field.scope === "workspace",
  );
  const ownFields = allFields.filter((field) => field.scope === "project");

  const { mutateAsync: createCustomField, isPending: creating } =
    useCreateCustomField();
  const { mutateAsync: deleteCustomField, isPending: deleting } =
    useDeleteCustomField(projectId);
  const { mutateAsync: reorderCustomFields } = useReorderCustomFields();
  const { mutateAsync: updateCustomField } = useUpdateCustomField(projectId);
  const { mutateAsync: setCustomFieldVisibility } =
    useSetCustomFieldVisibility(projectId);

  const [togglingFieldId, setTogglingFieldId] = useState<string | null>(null);

  const handleToggleVisibility = async (fieldId: string, hidden: boolean) => {
    try {
      setTogglingFieldId(fieldId);
      await setCustomFieldVisibility({ fieldId, hidden });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:customFields.visibilityUpdateError"),
      );
    } finally {
      setTogglingFieldId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">
            {t("settings:customFields.inheritedTitle")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("settings:customFields.inheritedDescription")}
          </p>
        </div>
        <InheritedCustomFieldsList
          fields={inheritedFields}
          isLoading={isLoading}
          onToggle={handleToggleVisibility}
          togglingFieldId={togglingFieldId}
        />
      </div>

      <div className="space-y-2">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">
            {t("settings:customFields.ownFieldsTitle")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("settings:customFields.ownFieldsDescription")}
          </p>
        </div>
        <CustomFieldEditorCore
          fields={ownFields}
          isLoading={isLoading}
          onCreate={(payload) => createCustomField({ projectId, ...payload })}
          creating={creating}
          onDelete={(id) => deleteCustomField({ id })}
          deleting={deleting}
          onReorder={(fields) => reorderCustomFields({ projectId, fields })}
          onUpdateOptionColor={(id, optionColors) =>
            updateCustomField({ id, optionColors })
          }
          onUpdate={(id, payload) => updateCustomField({ id, ...payload })}
        />
      </div>
    </div>
  );
}
