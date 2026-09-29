import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import useInviteResource from "./use-invite-resource";
import useLinkResource from "./use-link-resource";
import useUnlinkResource from "./use-unlink-resource";

const m = vi.hoisted(() => ({
  invite: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock("@/fetchers/resource/invite-resource", () => ({ default: m.invite }));
vi.mock("@/fetchers/resource/link-resource", () => ({ default: m.link }));
vi.mock("@/fetchers/resource/unlink-resource", () => ({ default: m.unlink }));

function setup() {
  const client = new QueryClient();
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const keys = () =>
    spy.mock.calls.flatMap((call) =>
      call[0]?.queryKey ? [call[0].queryKey] : [],
    );
  // Would the predicate-based invalidations hit a cache entry like this?
  const predicateHits = (queryKey: unknown[], data?: unknown) =>
    spy.mock.calls.some((call) => {
      const predicate = call[0]?.predicate;
      return predicate
        ? predicate({ queryKey, state: { data } } as unknown as Parameters<
            typeof predicate
          >[0])
        : false;
    });
  return { client, wrapper, keys, predicateHits, spy };
}

describe("resource mutations", () => {
  it("linking refreshes just the workspace and the projects whose tasks moved", async () => {
    m.link.mockResolvedValue({
      resource: { workspaceId: "ws-1" },
      movedTaskCount: 2,
      movedProjectIds: ["p1", "p2"],
    });
    const { wrapper, keys, predicateHits, spy } = setup();
    const { result } = renderHook(() => useLinkResource(), { wrapper });

    result.current.mutate({ id: "r1", userId: "u1" });

    await waitFor(() => expect(keys().length).toBeGreaterThan(0));
    expect(keys()).toEqual(
      expect.arrayContaining([
        ["workspace-resources", "ws-1"],
        ["projects", "ws-1"],
        ["calendar", "ws-1"],
        ["portfolio", "ws-1"],
        ["workload", "ws-1"],
        ["workload-tasks", "ws-1"],
        ["tasks", "p1"],
        ["tasks", "p2"],
        ["task-relations", "project", "p1"],
        ["task-relations", "project", "p2"],
      ]),
    );
    // Nothing global, and no notifications: the person is not notified.
    for (const key of keys()) {
      expect(key.length).toBeGreaterThan(1);
      expect(key[0]).not.toBe("notifications");
    }
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["tasks"] });
    // Task details of the moved projects (matched by their data) and the
    // workspace's search results are refreshed, other workspaces' are not.
    expect(predicateHits(["task", "t1"], { projectId: "p1" })).toBe(true);
    expect(predicateHits(["task", "t9"], { projectId: "other" })).toBe(false);
    expect(predicateHits(["search", { workspaceId: "ws-1" }])).toBe(true);
    expect(predicateHits(["search", { workspaceId: "ws-2" }])).toBe(false);
  });

  it("unlinking refreshes the resources and the workspace workload", async () => {
    m.unlink.mockResolvedValue({ workspaceId: "ws-1" });
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useUnlinkResource(), { wrapper });

    result.current.mutate({ id: "r1" });

    await waitFor(() => expect(keys().length).toBeGreaterThan(0));
    expect(keys()).toEqual(
      expect.arrayContaining([
        ["workspace-resources", "ws-1"],
        ["workload", "ws-1"],
        ["workload-tasks", "ws-1"],
      ]),
    );
  });

  it("inviting refreshes the resource list and the pending invitations", async () => {
    m.invite.mockResolvedValue({ id: "inv-1" });
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useInviteResource("ws-1"), {
      wrapper,
    });

    result.current.mutate({ id: "r1", workspaceRole: "member", projects: [] });

    await waitFor(() => expect(keys().length).toBeGreaterThan(0));
    expect(keys()).toEqual(
      expect.arrayContaining([
        ["workspace-resources", "ws-1"],
        ["workspace-invites", "ws-1"],
        ["project-invitations"],
      ]),
    );
  });
});
