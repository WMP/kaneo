import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import useInviteResource from "./use-invite-resource";
import useLinkResource from "./use-link-resource";

const m = vi.hoisted(() => ({ invite: vi.fn(), link: vi.fn() }));

vi.mock("@/fetchers/resource/invite-resource", () => ({ default: m.invite }));
vi.mock("@/fetchers/resource/link-resource", () => ({ default: m.link }));

function setup() {
  const client = new QueryClient();
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const keys = () => spy.mock.calls.map((call) => call[0]?.queryKey);
  return { wrapper, keys };
}

describe("resource mutations", () => {
  it("linking refreshes what an assignee change refreshes, workspace-wide", async () => {
    m.link.mockResolvedValue({
      resource: { workspaceId: "ws-1" },
      movedTaskCount: 2,
    });
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useLinkResource(), { wrapper });

    result.current.mutate({ id: "r1", userId: "u1" });

    await waitFor(() => expect(keys().length).toBeGreaterThan(0));
    const invalidated = keys().map((key) => key?.[0]);
    for (const prefix of [
      "workspace-resources",
      "tasks",
      "task",
      "projects",
      "activities",
      "task-relations",
      "calendar",
      "portfolio",
      "search",
      "workload",
      "notifications",
    ]) {
      expect(invalidated).toContain(prefix);
    }
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
