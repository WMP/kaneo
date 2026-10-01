import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addProjectMember = vi.fn();
const removeProjectMember = vi.fn();
const createProjectInvitation = vi.fn();

vi.mock("@/fetchers/project-member/add-project-member", () => ({
  default: (vars: unknown) => addProjectMember(vars),
}));
vi.mock("@/fetchers/project-member/remove-project-member", () => ({
  default: (vars: unknown) => removeProjectMember(vars),
}));
vi.mock("@/fetchers/project-invitation/create-project-invitation", () => ({
  default: (vars: unknown) => createProjectInvitation(vars),
}));

const { default: useAddProjectMember } = await import(
  "./use-add-project-member"
);
const { default: useLeaveProject } = await import("./use-leave-project");
const { default: useCreateProjectInvitation } = await import(
  "../project-invitation/use-create-project-invitation"
);

let queryClient: QueryClient;
let invalidated: unknown[][];

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const MEMBERS = ["project-members", "project-1"];
const INVITATIONS = ["project-invitations", "project-1"];

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

const has = (key: unknown[]) =>
  invalidated.some((entry) => JSON.stringify(entry) === JSON.stringify(key));

describe("adding a member", () => {
  it("invalidates after a success and after a failure, so a 409 reloads the lists", async () => {
    addProjectMember.mockResolvedValueOnce({});
    const { result } = renderHook(() => useAddProjectMember("workspace-1"), {
      wrapper,
    });

    await act(() =>
      result.current.mutateAsync({
        projectId: "project-1",
        userId: "u",
        role: "member",
      }),
    );
    expect(has(MEMBERS)).toBe(true);

    invalidated = [];
    addProjectMember.mockRejectedValueOnce(new Error("409"));
    await act(async () => {
      await result.current
        .mutateAsync({ projectId: "project-1", userId: "u", role: "member" })
        .catch(() => {});
    });
    expect(has(MEMBERS)).toBe(true);
    expect(has(["project-member-candidates", "project-1"])).toBe(true);
  });

  it("refreshes the user directory, so an added account is not offered again", async () => {
    addProjectMember.mockResolvedValueOnce({});
    const { result } = renderHook(() => useAddProjectMember("workspace-1"), {
      wrapper,
    });

    await act(() =>
      result.current.mutateAsync({
        projectId: "project-1",
        userId: "u",
        role: "member",
        workspaceRole: "viewer",
      }),
    );

    expect(has(["workspace-user-directory"])).toBe(true);
  });

  it("settles as soon as the members list is refreshed, without waiting for the rest", async () => {
    addProjectMember.mockResolvedValue({});
    vi.mocked(queryClient.invalidateQueries).mockImplementation(
      async (filters) => {
        const key = filters?.queryKey as string[] | undefined;
        // Everything but the members list never finishes.
        if (key?.[0] !== "project-members") await new Promise(() => {});
      },
    );
    const { result } = renderHook(() => useAddProjectMember("workspace-1"), {
      wrapper,
    });

    await act(() =>
      result.current.mutateAsync({
        projectId: "project-1",
        userId: "u",
        role: "member",
      }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("creating an invitation", () => {
  it("invalidates after a failure too, and awaits the invitation list", async () => {
    createProjectInvitation.mockRejectedValue(new Error("409"));
    vi.mocked(queryClient.invalidateQueries).mockImplementation(
      async (filters) => {
        const key = filters?.queryKey as string[] | undefined;
        invalidated.push([...(key ?? [])]);
        if (key?.[0] !== "project-invitations") await new Promise(() => {});
      },
    );
    const { result } = renderHook(
      () => useCreateProjectInvitation("workspace-1"),
      { wrapper },
    );

    await act(async () => {
      await result.current
        .mutateAsync({
          projectId: "project-1",
          email: "a@b.co",
          workspaceRole: "member",
          projectRole: "member",
        })
        .catch(() => {});
    });

    expect(has(INVITATIONS)).toBe(true);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("leaving a project", () => {
  it("toasts and navigates before anything is invalidated", async () => {
    const order: string[] = [];
    removeProjectMember.mockImplementation(async () => {
      order.push("request");
    });
    vi.mocked(queryClient.invalidateQueries).mockImplementation(
      async (filters) => {
        order.push(`invalidate:${String(filters?.queryKey?.[0])}`);
      },
    );
    const { result } = renderHook(() => useLeaveProject("workspace-1"), {
      wrapper,
    });

    await act(() =>
      result.current.leave(
        { projectId: "project-1", userId: "me" },
        async () => {
          order.push("afterLeft:start");
          await Promise.resolve();
          order.push("afterLeft:end");
        },
      ),
    );

    expect(order.slice(0, 3)).toEqual([
      "request",
      "afterLeft:start",
      "afterLeft:end",
    ]);
    expect(order.slice(3).length).toBeGreaterThan(0);
    expect(
      order.slice(3).every((entry) => entry.startsWith("invalidate:")),
    ).toBe(true);
    expect(order).toContain("invalidate:projects");
  });

  it("invalidates even when navigating away throws", async () => {
    removeProjectMember.mockResolvedValue({});
    const { result } = renderHook(() => useLeaveProject("workspace-1"), {
      wrapper,
    });

    await act(async () => {
      await result.current
        .leave({ projectId: "project-1", userId: "me" }, () => {
          throw new Error("router exploded");
        })
        .catch(() => {});
    });

    expect(has(["projects"])).toBe(true);
  });

  it("invalidates at once, and does not run afterLeft, when leaving failed", async () => {
    removeProjectMember.mockRejectedValue(new Error("409"));
    const afterLeft = vi.fn();
    const { result } = renderHook(() => useLeaveProject("workspace-1"), {
      wrapper,
    });

    await act(async () => {
      await expect(
        result.current.leave(
          { projectId: "project-1", userId: "me" },
          afterLeft,
        ),
      ).rejects.toThrow("409");
    });

    expect(afterLeft).not.toHaveBeenCalled();
    expect(has(MEMBERS)).toBe(true);
  });
});
