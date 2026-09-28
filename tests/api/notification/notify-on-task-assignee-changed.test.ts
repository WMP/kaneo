import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateNotification = vi.fn();
const mockSelect = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

vi.mock(
  "../../../apps/api/src/notification/controllers/create-notification",
  () => ({
    default: (...args: unknown[]) => mockCreateNotification(...args),
  }),
);

import { notifyOnTaskAssigneeChanged } from "../../../apps/api/src/notification/index";

function makeSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

describe("notifyOnTaskAssigneeChanged", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSelect.mockImplementation(() =>
      makeSelectChain([{ projectId: "proj-1", workspaceId: "ws-1" }]),
    );
  });

  it("notifies only the primary assignee when addedAssigneeIds is absent (legacy publishers)", async () => {
    await notifyOnTaskAssigneeChanged({
      taskId: "task-1",
      userId: "actor-1",
      oldAssignee: null,
      newAssignee: "Bea",
      newAssigneeId: "user-2",
      title: "Ship it",
    });

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-2",
        type: "task_assignee_changed",
        resourceId: "task-1",
      }),
    );
  });

  it("notifies every newly added assignee, deduping the primary", async () => {
    await notifyOnTaskAssigneeChanged({
      taskId: "task-1",
      userId: "actor-1",
      oldAssignee: "user-1",
      newAssignee: "Ada",
      newAssigneeId: "user-1",
      addedAssigneeIds: ["user-1", "user-2", "user-3"],
      title: "Ship it",
    });

    expect(mockCreateNotification).toHaveBeenCalledTimes(3);
    const notifiedIds = mockCreateNotification.mock.calls
      .map((call) => (call[0] as { userId: string }).userId)
      .sort();
    expect(notifiedIds).toEqual(["user-1", "user-2", "user-3"]);
  });

  it("notifies an added secondary assignee even when the primary is unchanged", async () => {
    await notifyOnTaskAssigneeChanged({
      taskId: "task-1",
      userId: "actor-1",
      oldAssignee: "user-1",
      newAssignee: "Ada",
      newAssigneeId: "user-1",
      addedAssigneeIds: ["user-2"],
      title: "Ship it",
    });

    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    const notifiedIds = mockCreateNotification.mock.calls
      .map((call) => (call[0] as { userId: string }).userId)
      .sort();
    expect(notifiedIds).toEqual(["user-1", "user-2"]);
  });

  it("does nothing when there is no primary and nothing was added (an unassign-only diff)", async () => {
    await notifyOnTaskAssigneeChanged({
      taskId: "task-1",
      userId: "actor-1",
      oldAssignee: "user-1",
      title: "Ship it",
      addedAssigneeIds: [],
    });

    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });
});
