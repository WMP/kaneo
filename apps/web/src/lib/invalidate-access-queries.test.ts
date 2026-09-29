import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import invalidateUserProfileQueries from "@/hooks/mutations/invalidate-user-profile-queries";
import { invalidateAccessQueries } from "./invalidate-access-queries";

function spyClient() {
  const client = new QueryClient();
  const invalidate = vi
    .spyOn(client, "invalidateQueries")
    .mockResolvedValue(undefined);
  return { client, invalidate };
}

describe("invalidateAccessQueries", () => {
  it("drops project capabilities and the people lists", async () => {
    const { client, invalidate } = spyClient();
    await invalidateAccessQueries(client);

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual([
      ["project-access"],
      ["project-members"],
      ["workspace-members"],
    ]);
  });
});

describe("invalidateUserProfileQueries", () => {
  it("refreshes the people lists a name or avatar change shows up in", async () => {
    const { client, invalidate } = spyClient();
    await invalidateUserProfileQueries(client);

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(["project-members"]);
    expect(keys).toContainEqual(["workspace-members"]);
  });
});
