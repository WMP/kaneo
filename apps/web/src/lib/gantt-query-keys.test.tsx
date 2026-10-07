import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ganttAllProjectRelationsKey,
  ganttCalendarKey,
  ganttProjectRelationsKey,
  ganttTaskRelationsKey,
  ganttTasksKey,
  invalidateGanttRelations,
} from "./gantt-query-keys";

const { relations, tasks, calendar } = vi.hoisted(() => ({
  relations: vi.fn(),
  tasks: vi.fn(),
  calendar: vi.fn(),
}));
vi.mock("@/fetchers/task-relation/get-project-task-relations", () => ({
  default: relations,
}));
vi.mock("@/fetchers/task/get-tasks", () => ({ default: tasks }));
vi.mock("@/fetchers/calendar/get-calendar", () => ({ default: calendar }));

import useGetCalendar from "@/hooks/queries/calendar/use-get-calendar";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import useGetProjectTaskRelations from "@/hooks/queries/task-relation/use-get-project-task-relations";

afterEach(cleanup);

// Same default the app sets in query-client/index.ts, which is what hid the
// stale Gantt data after navigating back to it.
function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { refetchOnMount: false, retry: false } },
  });
}

describe("Gantt query keys", () => {
  it("keeps the exact key shapes the Gantt, mutations and realtime share", () => {
    expect(ganttTasksKey("p1")).toEqual(["tasks", "p1"]);
    expect(ganttProjectRelationsKey("p1")).toEqual([
      "task-relations",
      "project",
      "p1",
    ]);
    expect(ganttAllProjectRelationsKey()).toEqual([
      "task-relations",
      "project",
    ]);
    expect(ganttTaskRelationsKey("t1")).toEqual(["task-relations", "t1"]);
    expect(ganttCalendarKey("w1")).toEqual(["calendar", "w1"]);
  });

  it("invalidateGanttRelations marks every project's relations cache but not the task lists", () => {
    const client = makeClient();
    client.setQueryData(ganttProjectRelationsKey("p1"), []);
    client.setQueryData(ganttProjectRelationsKey("p2"), []);
    client.setQueryData(ganttTasksKey("p1"), {});
    void invalidateGanttRelations(client);
    expect(
      client.getQueryState(ganttProjectRelationsKey("p1"))?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(ganttProjectRelationsKey("p2"))?.isInvalidated,
    ).toBe(true);
    expect(client.getQueryState(ganttTasksKey("p1"))?.isInvalidated).toBe(
      false,
    );
    client.clear();
  });
});

describe("Gantt queries refetch on mount", () => {
  function wrap(client: QueryClient) {
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  it("project relations: remounting after an invalidation fetches again", async () => {
    relations.mockReset().mockResolvedValue([]);
    const client = makeClient();
    const first = renderHook(() => useGetProjectTaskRelations("p1"), {
      wrapper: wrap(client),
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    // Edited while the Gantt was not mounted (e.g. on a task page).
    await invalidateGanttRelations(client);
    renderHook(() => useGetProjectTaskRelations("p1"), {
      wrapper: wrap(client),
    });
    await waitFor(() => expect(relations).toHaveBeenCalledTimes(2));
    client.clear();
  });

  it("tasks: remounting fetches again", async () => {
    tasks.mockReset().mockResolvedValue({ columns: [] });
    const client = makeClient();
    const first = renderHook(() => useGetTasks("p1"), {
      wrapper: wrap(client),
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    renderHook(() => useGetTasks("p1"), { wrapper: wrap(client) });
    await waitFor(() => expect(tasks).toHaveBeenCalledTimes(2));
    client.clear();
  });

  it("calendar: remounting fetches again", async () => {
    calendar.mockReset().mockResolvedValue({ holidays: [] });
    const client = makeClient();
    const first = renderHook(() => useGetCalendar("w1"), {
      wrapper: wrap(client),
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    renderHook(() => useGetCalendar("w1"), { wrapper: wrap(client) });
    await waitFor(() => expect(calendar).toHaveBeenCalledTimes(2));
    client.clear();
  });
});
