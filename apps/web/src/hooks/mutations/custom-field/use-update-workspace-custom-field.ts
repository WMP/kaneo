import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateCustomField from "@/fetchers/custom-field/update-custom-field";

// Reuses the same PATCH /custom-field/{id} fetcher as the project editor —
// it already works for both scopes — and only differs in which cache entry
// gets the optimistic update.
function useUpdateWorkspaceCustomField(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateCustomField,
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ["workspace-custom-fields", workspaceId],
        (existing: Array<typeof updated> | undefined) => {
          if (!existing) return existing;
          return existing.map((field) =>
            field.id === updated.id ? updated : field,
          );
        },
      );

      void queryClient.invalidateQueries({ refetchType: "all" });
    },
  });
}

export default useUpdateWorkspaceCustomField;
