import { skipToken, useQuery } from "@tanstack/react-query";
import getWorkspaceActivity from "@/fetchers/workspace/get-workspace-activity";

type UseGetWorkspaceActivityParams = {
  workspaceId: string | undefined;
  userId?: string;
  type?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
};

function useGetWorkspaceActivity({
  workspaceId,
  userId,
  type,
  from,
  to,
  page,
  limit,
}: UseGetWorkspaceActivityParams) {
  return useQuery({
    queryKey: [
      "workspace-activity",
      workspaceId,
      userId,
      type,
      from,
      to,
      page,
      limit,
    ],
    queryFn: workspaceId
      ? () =>
          getWorkspaceActivity({
            workspaceId,
            userId,
            type,
            from,
            to,
            page,
            limit,
          })
      : skipToken,
    placeholderData: (previousData) => previousData,
  });
}

export default useGetWorkspaceActivity;
