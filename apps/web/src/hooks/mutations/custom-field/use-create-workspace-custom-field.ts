import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateWorkspaceCustomFieldRequest } from "@/fetchers/custom-field/create-workspace-custom-field";
import createWorkspaceCustomField from "@/fetchers/custom-field/create-workspace-custom-field";

function useCreateWorkspaceCustomField() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createWorkspaceCustomField,
    onSuccess: (created, variables: CreateWorkspaceCustomFieldRequest) => {
      queryClient.setQueryData(
        ["workspace-custom-fields", variables.workspaceId],
        (existing: Array<typeof created> | undefined) => {
          if (!existing) return [created];
          return [...existing, created];
        },
      );

      // A new workspace field is inherited by every project in the
      // workspace, so every project's effective/all-fields list is stale too.
      void queryClient.invalidateQueries({ refetchType: "all" });
    },
  });
}

export default useCreateWorkspaceCustomField;
