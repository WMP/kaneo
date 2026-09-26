import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import getTaskRelations from "@/fetchers/task-relation/get-task-relations";
import { useGanttGateWarnings } from "./use-gantt-gate-warnings";

vi.mock("@/fetchers/task-relation/get-task-relations", () => ({
  default: vi.fn(),
}));

type RelationFixture = {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
  sourceTask: {
    id: string;
    title: string;
    approvalStatus: string;
  } | null;
  targetTask: {
    id: string;
    title: string;
    approvalStatus: string;
  } | null;
};

function relation(overrides: Partial<RelationFixture>): RelationFixture {
  return {
    id: "rel-1",
    sourceTaskId: "gate",
    targetTaskId: "blocked",
    relationType: "blocks",
    sourceTask: {
      id: "gate",
      title: "Client sign-off",
      approvalStatus: "pending",
    },
    targetTask: { id: "blocked", title: "Cutover", approvalStatus: "none" },
    ...overrides,
  };
}

let client: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe("useGanttGateWarnings", () => {
  it("flags a task blocked by a pending-approval gate", async () => {
    vi.mocked(getTaskRelations).mockImplementation(async (taskId: string) =>
      taskId === "blocked" ? [relation({})] : [],
    );

    const { result } = renderHook(
      () => useGanttGateWarnings(["gate", "blocked"]),
      { wrapper: Wrapper },
    );

    await waitFor(() =>
      expect(result.current.get("blocked")).toEqual([
        { taskId: "gate", title: "Client sign-off", approvalStatus: "pending" },
      ]),
    );
    expect(result.current.get("gate")).toBeUndefined();
  });

  it("flags a task blocked by a rejected-approval gate", async () => {
    vi.mocked(getTaskRelations).mockImplementation(async (taskId: string) =>
      taskId === "blocked"
        ? [
            relation({
              sourceTask: {
                id: "gate",
                title: "Client sign-off",
                approvalStatus: "rejected",
              },
            }),
          ]
        : [],
    );

    const { result } = renderHook(() => useGanttGateWarnings(["blocked"]), {
      wrapper: Wrapper,
    });

    await waitFor(() =>
      expect(result.current.get("blocked")?.[0]?.approvalStatus).toBe(
        "rejected",
      ),
    );
  });

  it("does not warn once the gate is approved", async () => {
    vi.mocked(getTaskRelations).mockImplementation(async (taskId: string) =>
      taskId === "blocked"
        ? [
            relation({
              sourceTask: {
                id: "gate",
                title: "Client sign-off",
                approvalStatus: "approved",
              },
            }),
          ]
        : [],
    );

    const { result } = renderHook(() => useGanttGateWarnings(["blocked"]), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(getTaskRelations).toHaveBeenCalled());
    expect(result.current.get("blocked")).toBeUndefined();
  });

  it("only warns the target of a blocks relation, not the gate task itself", async () => {
    vi.mocked(getTaskRelations).mockImplementation(async (taskId: string) =>
      taskId === "gate" || taskId === "blocked" ? [relation({})] : [],
    );

    const { result } = renderHook(
      () => useGanttGateWarnings(["gate", "blocked"]),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.get("blocked")).toHaveLength(1));
    expect(result.current.get("gate")).toBeUndefined();
  });

  it("ignores non-blocks relations regardless of approval status", async () => {
    vi.mocked(getTaskRelations).mockImplementation(async (taskId: string) =>
      taskId === "blocked"
        ? [
            relation({
              relationType: "related",
              sourceTask: {
                id: "gate",
                title: "Client sign-off",
                approvalStatus: "pending",
              },
            }),
          ]
        : [],
    );

    const { result } = renderHook(() => useGanttGateWarnings(["blocked"]), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(getTaskRelations).toHaveBeenCalled());
    expect(result.current.get("blocked")).toBeUndefined();
  });
});
