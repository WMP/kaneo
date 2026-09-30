import { useQuery } from "@tanstack/react-query";
import getEnforcementPreview from "@/fetchers/workspace-column/get-enforcement-preview";

/**
 * Dry run of turning column enforcement on. It is only fetched while the
 * confirmation dialog is open, and never reused: the numbers must describe the
 * data at the moment the administrator confirms.
 */
export function useEnforcementPreview({
  workspaceId,
  fallbackColumnId,
  enabled,
}: {
  workspaceId: string;
  fallbackColumnId: string | undefined;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: [
      "workspace-columns",
      workspaceId,
      "enforcement-preview",
      fallbackColumnId ?? null,
    ],
    queryFn: () => getEnforcementPreview({ workspaceId, fallbackColumnId }),
    enabled: enabled && !!workspaceId && !!fallbackColumnId,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
