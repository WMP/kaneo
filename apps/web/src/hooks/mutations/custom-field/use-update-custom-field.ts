import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateCustomField from "@/fetchers/custom-field/update-custom-field";

function useUpdateCustomField(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateCustomField,
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ["custom-fields", projectId],
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

export default useUpdateCustomField;
