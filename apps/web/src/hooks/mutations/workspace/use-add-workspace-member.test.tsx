import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addWorkspaceMember = vi.fn();
vi.mock("@/fetchers/workspace/add-workspace-member", () => ({
  default: (vars: unknown) => addWorkspaceMember(vars),
}));

const { default: useAddWorkspaceMember } = await import(
  "./use-add-workspace-member"
);

let queryClient: QueryClient;
let invalidated: unknown[][];

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const has = (key: unknown[]) =>
  invalidated.some((entry) => JSON.stringify(entry) === JSON.stringify(key));

beforeEach(() => {
  queryClient = new QueryClient();
  invalidated = [];
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation(
    async (filters) => {
      invalidated.push([...(filters?.queryKey ?? [])]);
    },
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("adding a workspace member", () => {
  it("refreshes the people lists, the candidates and the user directory after a success", async () => {
    addWorkspaceMember.mockResolvedValueOnce({});
    const { result } = renderHook(() => useAddWorkspaceMember(), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        workspaceId: "workspace-1",
        userId: "u",
        role: "member",
      }),
    );

    expect(has(["workspace-members", "workspace-1"])).toBe(true);
    expect(has(["workspace", "full", "workspace-1"])).toBe(true);
    expect(has(["project-member-candidates"])).toBe(true);
    expect(has(["workspace-user-directory"])).toBe(true);
  });

  it("refreshes after a failure too, so a 409 shows what is stored", async () => {
    addWorkspaceMember.mockRejectedValueOnce(new Error("409"));
    const { result } = renderHook(() => useAddWorkspaceMember(), { wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({
          workspaceId: "workspace-1",
          userId: "u",
          role: "member",
        })
        .catch(() => {});
    });

    expect(has(["workspace-members", "workspace-1"])).toBe(true);
    expect(has(["workspace-user-directory"])).toBe(true);
  });
});
