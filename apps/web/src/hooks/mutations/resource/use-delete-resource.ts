import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteResource from "@/fetchers/resource/delete-resource";

function useDeleteResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteResource,
    onSuccess: (deleted) => {
      queryClient.setQueryData(
        ["workspace-resources", deleted.workspaceId, null],
        (existing: Array<typeof deleted> | undefined) =>
          existing?.filter((resource) => resource.id !== deleted.id) ?? [],
      );

      void queryClient.invalidateQueries({
        queryKey: ["workspace-resources", deleted.workspaceId],
      });
      // Deleting a resource unassigns it from every task it was on.
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["task"] });
    },
  });
}

export default useDeleteResource;
