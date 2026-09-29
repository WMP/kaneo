import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateProjectMembership } from "./invalidate-project-membership";

describe("invalidateProjectMembership", () => {
  it("invalidates everything a membership change can make stale", async () => {
    const queryClient = new QueryClient();
    const spy = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);

    await invalidateProjectMembership(queryClient, {
      projectId: "project-1",
      workspaceId: "workspace-1",
    });

    const keys = spy.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["project-members", "project-1"],
        ["project-member-candidates", "project-1"],
        ["project-assignable-roles", "project-1"],
        ["project-invitations", "project-1"],
        ["projects"],
        ["workspace-users"],
        ["project-access", "project-1"],
        ["workspace", "full", "workspace-1"],
        ["workspace-invites", "workspace-1"],
      ]),
    );
  });

  it("still invalidates the project's own keys without a workspace id", async () => {
    const queryClient = new QueryClient();
    const spy = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);

    await invalidateProjectMembership(queryClient, { projectId: "project-1" });

    const keys = spy.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(["project-members", "project-1"]);
    expect(keys).toContainEqual(["project-access", "project-1"]);
    expect(keys).not.toContainEqual(["workspace-invites", undefined]);
  });
});
