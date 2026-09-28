import { useMutation, useQueryClient } from "@tanstack/react-query";
import reorderWorkspaceCustomFields from "@/fetchers/custom-field/reorder-workspace-custom-field";

export function useReorderWorkspaceCustomFields() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workspaceId,
      fields,
    }: {
      workspaceId: string;
      fields: Array<{ id: string; position: number }>;
    }) => reorderWorkspaceCustomFields(workspaceId, fields),
    onSuccess: () => {
      void queryClient.invalidateQueries({ refetchType: "all" });
    },
  });
}

export default useReorderWorkspaceCustomFields;
