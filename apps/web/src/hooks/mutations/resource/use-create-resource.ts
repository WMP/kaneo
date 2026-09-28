import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateResourceRequest } from "@/fetchers/resource/create-resource";
import createResource from "@/fetchers/resource/create-resource";

function useCreateResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createResource,
    onSuccess: (created, variables: CreateResourceRequest) => {
      queryClient.setQueryData(
        ["workspace-resources", variables.workspaceId, null],
        (existing: Array<typeof created> | undefined) => {
          if (!existing) return [created];
          return [...existing, created];
        },
      );

      void queryClient.invalidateQueries({
        queryKey: ["workspace-resources", variables.workspaceId],
      });
    },
  });
}

export default useCreateResource;
