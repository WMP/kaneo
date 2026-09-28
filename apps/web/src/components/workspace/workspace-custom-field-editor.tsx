import CustomFieldEditorCore from "@/components/custom-field/custom-field-editor-core";
import type { CustomFieldDefinition } from "@/components/custom-field/types";
import useCreateWorkspaceCustomField from "@/hooks/mutations/custom-field/use-create-workspace-custom-field";
import useDeleteWorkspaceCustomField from "@/hooks/mutations/custom-field/use-delete-workspace-custom-field";
import useReorderWorkspaceCustomFields from "@/hooks/mutations/custom-field/use-reorder-workspace-custom-fields";
import useUpdateWorkspaceCustomField from "@/hooks/mutations/custom-field/use-update-workspace-custom-field";
import useGetWorkspaceCustomFields from "@/hooks/queries/custom-field/use-get-workspace-custom-fields";

type WorkspaceCustomFieldEditorProps = {
  workspaceId: string;
};

/** Manages a workspace's custom field definitions — every field here is
 * inherited by every project in the workspace. A project can only hide/show
 * one of these fields for itself (see the project editor's inherited-fields
 * section); content edits (name, options, colors) and deletion happen here. */
export default function WorkspaceCustomFieldEditor({
  workspaceId,
}: WorkspaceCustomFieldEditorProps) {
  const { data: fields = [], isLoading } = useGetWorkspaceCustomFields(
    workspaceId,
  ) as { data: CustomFieldDefinition[] | undefined; isLoading: boolean };

  const { mutateAsync: createCustomField, isPending: creating } =
    useCreateWorkspaceCustomField();
  const { mutateAsync: deleteCustomField, isPending: deleting } =
    useDeleteWorkspaceCustomField(workspaceId);
  const { mutateAsync: reorderCustomFields } =
    useReorderWorkspaceCustomFields();
  const { mutateAsync: updateCustomField } =
    useUpdateWorkspaceCustomField(workspaceId);

  return (
    <CustomFieldEditorCore
      fields={fields}
      isLoading={isLoading}
      onCreate={(payload) => createCustomField({ workspaceId, ...payload })}
      creating={creating}
      onDelete={(id) => deleteCustomField({ id })}
      deleting={deleting}
      onReorder={(reorderedFields) =>
        reorderCustomFields({ workspaceId, fields: reorderedFields })
      }
      onUpdateOptionColor={(id, optionColors) =>
        updateCustomField({ id, optionColors })
      }
    />
  );
}
