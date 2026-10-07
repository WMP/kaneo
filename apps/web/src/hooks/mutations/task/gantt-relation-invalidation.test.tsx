import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";

const m = vi.hoisted(() => ({
  dueDate: vi.fn(),
  title: vi.fn(),
  move: vi.fn(),
  del: vi.fn(),
  bulk: vi.fn(),
}));
vi.mock("@/fetchers/task/update-task-due-date", () => ({ default: m.dueDate }));
vi.mock("@/fetchers/task/update-task-title", () => ({ default: m.title }));
vi.mock("@/fetchers/task/move-task", () => ({ default: m.move }));
vi.mock("@/fetchers/task/delete-task", () => ({ default: m.del }));
vi.mock("@/fetchers/task/bulk-operation", () => ({ default: m.bulk }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { useBulkOperations } from "./use-bulk-operations";
import { useBulkUpdateTaskSchedule } from "./use-bulk-update-task-schedule";
import { useDeleteTask } from "./use-delete-task";
import { useMoveTask } from "./use-move-task";
import { useUpdateTaskDueDate } from "./use-update-task-due-date";
import { useUpdateTaskTitle } from "./use-update-task-title";

afterEach(cleanup);
beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

const task = { id: "task-1", projectId: "project-1" } as Task;
// A Gantt of ANOTHER project that shows task-1 as a relation endpoint.
const OTHER_GANTT = ["task-relations", "project", "project-2"];

function setup<T>(useHook: () => T) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  client.setQueryData(OTHER_GANTT, []);
  client.setQueryData(["tasks", "project-1"], {
    columns: [],
    plannedTasks: [],
    archivedTasks: [],
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(useHook, { wrapper }) };
}

const invalidated = (client: QueryClient) =>
  client.getQueryState(OTHER_GANTT)?.isInvalidated;

describe("task mutations refresh Gantt relation summaries", () => {
  it("due date", async () => {
    m.dueDate.mockResolvedValue(task);
    const { client, result } = setup(useUpdateTaskDueDate);
    act(() => result.current.mutate(task));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidated(client)).toBe(true);
    expect(client.getQueryState(["tasks", "project-1"])?.isInvalidated).toBe(
      true,
    );
  });

  it("title", async () => {
    m.title.mockResolvedValue(task);
    const { client, result } = setup(useUpdateTaskTitle);
    act(() => result.current.mutate(task));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidated(client)).toBe(true);
  });

  it("move to another project", async () => {
    m.move.mockResolvedValue({
      sourceProjectId: "project-1",
      destinationProjectId: "project-3",
    });
    const { client, result } = setup(useMoveTask);
    act(() =>
      result.current.mutate({ taskId: "task-1", destinationProjectId: "p3" }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidated(client)).toBe(true);
  });

  it("delete", async () => {
    m.del.mockResolvedValue({ id: "task-1", projectId: "project-1" });
    const { client, result } = setup(useDeleteTask);
    act(() => result.current.mutate("task-1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidated(client)).toBe(true);
  });

  it("bulk operation", async () => {
    m.bulk.mockResolvedValue(undefined);
    const { client, result } = setup(useBulkOperations);
    await act(() =>
      result.current.bulkDueDate({ taskIds: ["task-1"], dueDate: null }),
    );
    expect(invalidated(client)).toBe(true);
  });

  it("cascade (bulk schedule)", async () => {
    m.bulk.mockResolvedValue(undefined);
    const { client, result } = setup(useBulkUpdateTaskSchedule);
    act(() =>
      result.current.mutate({
        projectId: "project-1",
        scheduleUpdates: [{ taskId: "task-1", startDate: null, dueDate: null }],
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidated(client)).toBe(true);
  });
});
