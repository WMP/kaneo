import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
import { requireWorkspacePermission } from "../../../apps/api/src/utils/require-workspace-permission";

function context(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as unknown as Context;
}

const needTaskRead = { task: ["read"] };

describe("requireWorkspacePermission guards", () => {
  it("answers 500 and does not continue when the workspace was not resolved", async () => {
    const next = vi.fn();
    await expect(
      requireWorkspacePermission(needTaskRead)(context({ userId: "u1" }), next),
    ).rejects.toMatchObject({
      status: 500,
      message: "workspaceId not set in context",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("answers 403 when the API key scope does not cover the permission, even for an instance admin", async () => {
    const next = vi.fn();
    await expect(
      requireWorkspacePermission(needTaskRead)(
        context({
          workspaceId: "w1",
          userId: "u1",
          user: { role: "admin" },
          apiKey: { permissions: { label: ["read"] } },
        }),
        next,
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: "Insufficient API key scope",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("answers 401, not 403, when nobody is signed in", async () => {
    const next = vi.fn();
    await expect(
      requireWorkspacePermission(needTaskRead)(
        context({ workspaceId: "w1", userId: "" }),
        next,
      ),
    ).rejects.toMatchObject({ status: 401, message: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("continues for an instance admin whose key scope covers the permission", async () => {
    const next = vi.fn(async () => undefined);
    await requireWorkspacePermission(needTaskRead)(
      context({
        workspaceId: "w1",
        userId: "u1",
        user: { role: "admin" },
        apiKey: { permissions: { task: ["read", "update"] } },
      }),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
