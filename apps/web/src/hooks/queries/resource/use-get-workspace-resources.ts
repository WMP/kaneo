import { useQuery } from "@tanstack/react-query";
import getWorkspaceResources from "@/fetchers/resource/get-workspace-resources";
import type { ResourceKind } from "@/types/resource";

function useGetWorkspaceResources(workspaceId: string, kind?: ResourceKind) {
  return useQuery({
    queryKey: ["workspace-resources", workspaceId, kind ?? null],
    queryFn: () => getWorkspaceResources({ workspaceId, kind }),
    enabled: Boolean(workspaceId),
  });
}

export default useGetWorkspaceResources;
