import { useQuery } from "@tanstack/react-query";
import getPortfolio from "@/fetchers/project/get-portfolio";

function useGetPortfolio({ workspaceId }: { workspaceId: string }) {
  return useQuery({
    queryFn: () => getPortfolio({ workspaceId }),
    queryKey: ["portfolio", workspaceId],
    enabled: !!workspaceId,
  });
}

export default useGetPortfolio;
