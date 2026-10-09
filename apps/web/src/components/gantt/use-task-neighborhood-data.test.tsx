import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ganttCalendarKey,
  ganttProjectRelationsKey,
  ganttTasksKey,
} from "@/lib/gantt-query-keys";
import { useTaskNeighborhoodData } from "./use-task-neighborhood-data";

const getTasks = vi.fn();
const getProjectTaskRelations = vi.fn();
const getCalendar = vi.fn();
vi.mock("@/fetchers/task/get-tasks", () => ({
  default: (projectId: string) => getTasks(projectId),
}));
vi.mock("@/fetchers/task-relation/get-project-task-relations", () => ({
  default: (input: unknown) => getProjectTaskRelations(input),
}));
vi.mock("@/fetchers/calendar/get-calendar", () => ({
  default: (workspaceId: string) => getCalendar(workspaceId),
}));

const task = (
  id: string,
  number: number,
  startDate: string,
  dueDate: string,
) => ({
  id,
  title: `Task ${number}`,
  number,
  startDate,
  dueDate,
  estimateMinutes: null,
  isMilestone: false,
});
const project = {
  id: "project-1",
  slug: "AFB",
  columns: [
    {
      id: "c",
      name: "To do",
      tasks: [
        task("a", 1, "2026-08-10", "2026-08-14"),
        task("b", 2, "2026-08-17", "2026-08-19"),
      ],
    },
  ],
  plannedTasks: [],
};
const endpoint = (
  id: string,
  number: number,
  projectId: string,
  slug: string,
) => ({
  id,
  title: `Task ${number}`,
  number,
  status: "to-do",
  projectId,
  projectName: slug,
  projectSlug: slug,
  startDate: "2026-08-10",
  dueDate: "2026-08-14",
  isMilestone: false,
  estimateMinutes: null,
  estimateUnit: "hours",
});
const relations = [
  {
    id: "r1",
    sourceTaskId: "a",
    targetTaskId: "b",
    relationType: "blocks",
    dependencyType: "fs",
    lagDays: 0,
    sourceTask: endpoint("a", 1, "project-1", "AFB"),
    targetTask: endpoint("b", 2, "project-1", "AFB"),
  },
];

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  getTasks.mockReset().mockResolvedValue(project);
  getProjectTaskRelations.mockReset().mockResolvedValue(relations);
  getCalendar.mockReset().mockResolvedValue({ workingDays: 62, holidays: [] });
});

afterEach(cleanup);

const input = (taskId: string | undefined) => ({
  workspaceId: "workspace-1",
  projectId: "project-1",
  taskId,
});

describe("useTaskNeighborhoodData", () => {
  it("stays idle and requests nothing while no task is open", () => {
    const { result } = renderHook(
      () => useTaskNeighborhoodData(input(undefined)),
      {
        wrapper,
      },
    );
    expect(result.current).toEqual({ status: "idle" });
    expect(getTasks).not.toHaveBeenCalled();
    expect(getProjectTaskRelations).not.toHaveBeenCalled();
    expect(getCalendar).not.toHaveBeenCalled();
  });

  it("loads, then returns the neighborhood inputs", async () => {
    const { result } = renderHook(() => useTaskNeighborhoodData(input("a")), {
      wrapper,
    });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("not ready");
    const { data } = result.current;
    expect(data.edges.map((edge) => edge.id)).toEqual(["r1"]);
    expect(data.taskInfoById.get("b")?.key).toBe("AFB-2");
    expect(data.scheduleByTaskId.get("a")).toEqual({
      start: new Date(2026, 7, 10),
      end: new Date(2026, 7, 14),
    });
  });

  it("reuses the Gantt's cached queries and fetches nothing twice", async () => {
    client.setQueryData(ganttTasksKey("project-1"), project);
    client.setQueryData(ganttProjectRelationsKey("project-1"), relations);
    client.setQueryData(ganttCalendarKey("workspace-1"), {
      workingDays: 62,
      holidays: [],
    });
    const { result } = renderHook(() => useTaskNeighborhoodData(input("a")), {
      wrapper,
    });
    // Ready on the first render, from the cache. The app default is
    // refetchOnMount: false and these queries opt in, so a stale copy is
    // refreshed through the SAME query (one request per key), never a new key.
    expect(result.current.status).toBe("ready");
    await waitFor(() => expect(getTasks).toHaveBeenCalledTimes(1));
    expect(getProjectTaskRelations).toHaveBeenCalledTimes(1);
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((query) => JSON.stringify(query.queryKey))
        .sort(),
    ).toEqual(
      [
        JSON.stringify(ganttCalendarKey("workspace-1")),
        JSON.stringify(ganttProjectRelationsKey("project-1")),
        JSON.stringify(ganttTasksKey("project-1")),
      ].sort(),
    );
  });

  it("reports an error with a retry that refetches the failed query", async () => {
    getProjectTaskRelations.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useTaskNeighborhoodData(input("a")), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    if (result.current.status !== "error") throw new Error("not an error");
    result.current.retry();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(getProjectTaskRelations).toHaveBeenCalledTimes(2);
  });

  it("does not wait for the calendar", async () => {
    getCalendar.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useTaskNeighborhoodData(input("a")), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
});
