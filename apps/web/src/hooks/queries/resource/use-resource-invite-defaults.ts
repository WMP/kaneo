import { useQuery } from "@tanstack/react-query";
import getResourceInviteDefaults from "@/fetchers/resource/get-resource-invite-defaults";

// The projects a person resource can be invited to. Fetched afresh whenever the
// dialog opens: what the caller may invite to depends on their project roles.
function useResourceInviteDefaults(
  resourceId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["resource-invite-defaults", resourceId],
    queryFn: () => getResourceInviteDefaults(resourceId ?? ""),
    enabled: Boolean(resourceId) && enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export default useResourceInviteDefaults;
