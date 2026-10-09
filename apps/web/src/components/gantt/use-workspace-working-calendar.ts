import { useCallback, useMemo } from "react";
import useGetCalendar from "@/hooks/queries/calendar/use-get-calendar";
import {
  buildHolidayDateKeySet,
  DEFAULT_WORKING_DAYS,
  isWorkingDay,
} from "./gantt-working-calendar";

/**
 * The workspace working calendar (weekends and holidays) behind one predicate,
 * from the shared `["calendar", workspaceId]` query. Defaults to the standard
 * Mon-Fri mask with no holidays while the query is loading, rather than
 * treating every day as a working day. Used by the Gantt route and by the
 * dependency neighborhood so both place estimate spans on the same days.
 */
export function useWorkspaceWorkingCalendar(
  workspaceId: string | undefined,
  options: { enabled?: boolean } = {},
) {
  const { data: calendar } = useGetCalendar(workspaceId, options);
  const workingDays = calendar?.workingDays ?? DEFAULT_WORKING_DAYS;
  const holidayDateSet = useMemo(
    () => buildHolidayDateKeySet(calendar?.holidays ?? []),
    [calendar?.holidays],
  );
  const workingDayPredicate = useCallback(
    (date: Date) => isWorkingDay(date, workingDays, holidayDateSet),
    [workingDays, holidayDateSet],
  );
  return { workingDays, holidayDateSet, workingDayPredicate };
}
