import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteCustomField from "@/fetchers/custom-field/delete-custom-field";

// Reuses the same DELETE /custom-field/{id} fetcher as the project editor —
// it already works for both scopes — and only differs in which cache entry
// gets the optimistic update.
function useDeleteWorkspaceCustomField(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCustomField,
    onSuccess: (_data, variables) => {
      queryClient.setQueryData(
        ["workspace-custom-fields", workspaceId],
        (existing: Array<{ id: string }> | undefined) => {
          if (!existing) return [];
          return existing.filter((f) => f.id !== variables.id);
        },
      );

      // Deleting a workspace field removes it from every project that
      // inherited it, so every project's effective/all-fields list is stale.
      void queryClient.invalidateQueries({ refetchType: "all" });
    },
  });
}

export default useDeleteWorkspaceCustomField;
