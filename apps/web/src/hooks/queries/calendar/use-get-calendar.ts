import { useQuery } from "@tanstack/react-query";
import getCalendar from "@/fetchers/calendar/get-calendar";
import { ganttCalendarKey } from "@/lib/gantt-query-keys";

function useGetCalendar(
  workspaceId: string | undefined,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    enabled: Boolean(workspaceId) && (options.enabled ?? true),
    queryKey: ganttCalendarKey(workspaceId),
    // Working days and holidays are edited in workspace settings; do not show
    // the copy cached when this view was last open.
    refetchOnMount: true,
    queryFn: () => getCalendar(workspaceId as string),
  });
}

export default useGetCalendar;
