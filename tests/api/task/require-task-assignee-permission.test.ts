import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockRequireWorkspacePermission = vi.fn();
const mockPermissionMiddleware = vi.fn(
  async (_c: unknown, next: () => unknown) => {
    await next();
  },
);

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

vi.mock("../../../apps/api/src/utils/require-workspace-permission", () => ({
  requireWorkspacePermission: (...args: unknown[]) => {
    mockRequireWorkspacePermission(...args);
    return mockPermissionMiddleware;
  },
}));

vi.mock("../../../apps/api/src/billing/require-entitlement-middleware", () => ({
  requireEntitlement: vi.fn(),
}));

import { requireTaskAssigneePermission } from "../../../apps/api/src/task/controllers/require-task-permission";

function makeSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

function makeContext(body: unknown, taskId = "task-1") {
  return {
    req: {
      param: (name: string) => (name === "id" ? taskId : undefined),
      json: () => Promise.resolve(body),
    },
  } as unknown as Parameters<typeof requireTaskAssigneePermission>[0];
}

describe("requireTaskAssigneePermission", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPermissionMiddleware.mockImplementation(
      async (_c: unknown, next: () => unknown) => {
        await next();
      },
    );
  });

  it("skips the permission check when the single userId is unchanged", async () => {
    mockSelect.mockReturnValue(makeSelectChain([{ userId: "user-1" }]));
    const next = vi.fn();

    await requireTaskAssigneePermission(
      makeContext({ userId: "user-1" }),
      next,
    );

    expect(mockRequireWorkspacePermission).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("requires task:assign when the single userId would change", async () => {
    mockSelect.mockReturnValue(makeSelectChain([{ userId: "user-1" }]));
    const next = vi.fn();

    await requireTaskAssigneePermission(
      makeContext({ userId: "user-2" }),
      next,
    );

    expect(mockRequireWorkspacePermission).toHaveBeenCalledWith({
      task: ["assign"],
    });
    expect(mockPermissionMiddleware).toHaveBeenCalledTimes(1);
  });

  it("skips the permission check when userId is omitted, because the assignees are left alone", async () => {
    mockSelect.mockReturnValue(makeSelectChain([{ userId: "user-1" }]));
    const next = vi.fn();

    await requireTaskAssigneePermission(
      makeContext({ title: "Renamed" }),
      next,
    );

    expect(mockRequireWorkspacePermission).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("requires task:assign when a blank userId would unassign the primary", async () => {
    mockSelect.mockReturnValue(makeSelectChain([{ userId: "user-1" }]));
    const next = vi.fn();

    await requireTaskAssigneePermission(makeContext({ userId: "  " }), next);

    expect(mockRequireWorkspacePermission).toHaveBeenCalledWith({
      task: ["assign"],
    });
  });

  it("skips the permission check when a blank userId is sent for a task without a primary", async () => {
    mockSelect.mockReturnValue(makeSelectChain([{ userId: null }]));
    const next = vi.fn();

    await requireTaskAssigneePermission(makeContext({ userId: "" }), next);

    expect(mockRequireWorkspacePermission).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("skips the permission check when the userIds array matches the current assignee set", async () => {
    mockSelect.mockReturnValue(makeSelectChain([{ userId: "user-1" }]));
    const next = vi.fn();

    await requireTaskAssigneePermission(
      makeContext({ userIds: ["user-1"] }),
      next,
    );

    expect(mockRequireWorkspacePermission).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("requires task:assign when the userIds array would change the assignee set", async () => {
    mockSelect.mockReturnValue(makeSelectChain([{ userId: "user-1" }]));
    const next = vi.fn();

    await requireTaskAssigneePermission(
      makeContext({ userIds: ["user-1", "user-2"] }),
      next,
    );

    expect(mockRequireWorkspacePermission).toHaveBeenCalledWith({
      task: ["assign"],
    });
  });

  it("requires task:assign when userIds would clear an existing assignee", async () => {
    mockSelect.mockReturnValue(makeSelectChain([{ userId: "user-1" }]));
    const next = vi.fn();

    await requireTaskAssigneePermission(makeContext({ userIds: [] }), next);

    expect(mockRequireWorkspacePermission).toHaveBeenCalledWith({
      task: ["assign"],
    });
  });

  it("lets the request through when the task does not exist", async () => {
    mockSelect.mockReturnValue(makeSelectChain([]));
    const next = vi.fn();

    await requireTaskAssigneePermission(
      makeContext({ userIds: ["user-1"] }),
      next,
    );

    expect(mockRequireWorkspacePermission).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
