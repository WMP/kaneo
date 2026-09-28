import { useMutation, useQueryClient } from "@tanstack/react-query";
import setCustomFieldVisibility from "@/fetchers/custom-field/set-custom-field-visibility";

function useSetCustomFieldVisibility(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ fieldId, hidden }: { fieldId: string; hidden: boolean }) =>
      setCustomFieldVisibility({ projectId, fieldId, hidden }),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ["custom-fields", projectId, "all"],
        (existing: Array<typeof updated> | undefined) => {
          if (!existing) return existing;
          return existing.map((field) =>
            field.id === updated.id ? updated : field,
          );
        },
      );

      // Hiding/showing a field changes this project's effective field set
      // (and its task values/filter values that key off it).
      void queryClient.invalidateQueries({ refetchType: "all" });
    },
  });
}

export default useSetCustomFieldVisibility;
