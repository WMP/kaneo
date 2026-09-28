import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateResource from "@/fetchers/resource/update-resource";

function useUpdateResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateResource,
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ["workspace-resources", updated.workspaceId, null],
        (existing: Array<typeof updated> | undefined) => {
          if (!existing) return existing;
          return existing.map((resource) =>
            resource.id === updated.id ? updated : resource,
          );
        },
      );

      void queryClient.invalidateQueries({
        queryKey: ["workspace-resources", updated.workspaceId],
      });
      // A renamed resource's name/kind icon shows up wherever a task's
      // assignee list is rendered.
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["task"] });
    },
  });
}

export default useUpdateResource;
