import { useQuery } from "@tanstack/react-query";
import getWorkspaceCustomFields from "@/fetchers/custom-field/get-workspace-custom-fields";

function useGetWorkspaceCustomFields(workspaceId: string) {
  return useQuery({
    queryKey: ["workspace-custom-fields", workspaceId],
    queryFn: () => getWorkspaceCustomFields({ workspaceId }),
    enabled: !!workspaceId,
  });
}

export default useGetWorkspaceCustomFields;
