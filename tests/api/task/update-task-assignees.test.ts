import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindFirst = vi.fn();
const mockSelect = vi.fn();
const mockPublishEvent = vi.fn();
const mockFilterAssignableUsers = vi.fn();
const mockGetProjectWorkspaceId = vi.fn();
const mockSetTaskAssignees = vi.fn();
const mockReadTaskAssignees = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    query: {
      taskTable: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

vi.mock("../../../apps/api/src/events", () => ({
  publishEvent: (...args: unknown[]) => mockPublishEvent(...args),
}));

vi.mock("../../../apps/api/src/utils/assert-assignable-user", () => ({
  filterAssignableUsers: (...args: unknown[]) =>
    mockFilterAssignableUsers(...args),
  getProjectWorkspaceId: (...args: unknown[]) =>
    mockGetProjectWorkspaceId(...args),
}));

vi.mock("../../../apps/api/src/task/assignments", () => ({
  setTaskAssignees: (...args: unknown[]) => mockSetTaskAssignees(...args),
  readTaskAssignees: (...args: unknown[]) => mockReadTaskAssignees(...args),
}));

import updateTaskAssignees from "../../../apps/api/src/task/controllers/update-task-assignees";

const EXISTING_TASK = {
  id: "task-1",
  projectId: "proj-1",
  userId: "user-1",
  title: "Ship it",
};

function makeSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

describe("updateTaskAssignees", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("throws 404 when the task does not exist", async () => {
    mockFindFirst.mockResolvedValue(undefined);

    await expect(
      updateTaskAssignees({
        id: "missing",
        userIds: ["user-1"],
        currentUserId: "user-1",
      }),
    ).rejects.toMatchObject({ status: 404 });

    expect(mockSetTaskAssignees).not.toHaveBeenCalled();
  });

  it("rejects with 403 when an assignee is not a workspace member", async () => {
    mockFindFirst.mockResolvedValue(EXISTING_TASK);
    mockGetProjectWorkspaceId.mockResolvedValue("ws-1");
    mockFilterAssignableUsers.mockResolvedValue(new Set(["user-1"]));

    await expect(
      updateTaskAssignees({
        id: "task-1",
        userIds: ["user-1", "user-outsider"],
        currentUserId: "user-1",
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(mockSetTaskAssignees).not.toHaveBeenCalled();
  });

  it("dedupes ids, validates membership once, and replaces the assignee list", async () => {
    mockFindFirst.mockResolvedValue(EXISTING_TASK);
    mockGetProjectWorkspaceId.mockResolvedValue("ws-1");
    mockFilterAssignableUsers.mockResolvedValue(new Set(["user-1", "user-2"]));
    mockSetTaskAssignees.mockResolvedValue(["user-1", "user-2"]);
    const updatedRow = {
      ...EXISTING_TASK,
      userId: "user-1",
      assigneeName: "Ada",
      assigneeId: "user-1",
    };
    mockSelect.mockReturnValue(makeSelectChain([updatedRow]));
    mockReadTaskAssignees.mockResolvedValue(
      new Map([
        [
          "task-1",
          [
            {
              userId: "user-1",
              name: "Ada",
              image: null,
              units: 100,
              work: null,
            },
            {
              userId: "user-2",
              name: "Bea",
              image: null,
              units: 100,
              work: null,
            },
          ],
        ],
      ]),
    );

    const result = await updateTaskAssignees({
      id: "task-1",
      userIds: ["user-1", "user-2", "user-1"],
      currentUserId: "user-1",
    });

    expect(mockFilterAssignableUsers).toHaveBeenCalledWith(
      ["user-1", "user-2"],
      "ws-1",
    );
    expect(mockSetTaskAssignees).toHaveBeenCalledWith(
      expect.anything(),
      "task-1",
      ["user-1", "user-2"],
    );
    expect(result.assignees).toHaveLength(2);
    // Primary assignee unchanged (user-1 stays first), so no assignee event.
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it("publishes task.assignee_changed when the primary assignee changes", async () => {
    mockFindFirst.mockResolvedValue(EXISTING_TASK);
    mockGetProjectWorkspaceId.mockResolvedValue("ws-1");
    mockFilterAssignableUsers.mockResolvedValue(new Set(["user-2"]));
    mockSetTaskAssignees.mockResolvedValue(["user-2"]);
    mockSelect.mockReturnValue(
      makeSelectChain([
        {
          ...EXISTING_TASK,
          userId: "user-2",
          assigneeName: "Bea",
          assigneeId: "user-2",
        },
      ]),
    );
    mockReadTaskAssignees.mockResolvedValue(new Map());

    await updateTaskAssignees({
      id: "task-1",
      userIds: ["user-2"],
      currentUserId: "user-1",
    });

    expect(mockPublishEvent).toHaveBeenCalledWith(
      "task.assignee_changed",
      expect.objectContaining({
        oldAssignee: "user-1",
        newAssigneeId: "user-2",
        newAssignee: "Bea",
      }),
    );
  });

  it("publishes task.unassigned when the list is emptied", async () => {
    mockFindFirst.mockResolvedValue(EXISTING_TASK);
    mockSetTaskAssignees.mockResolvedValue([]);
    mockSelect.mockReturnValue(
      makeSelectChain([
        {
          ...EXISTING_TASK,
          userId: null,
          assigneeName: null,
          assigneeId: null,
        },
      ]),
    );
    mockReadTaskAssignees.mockResolvedValue(new Map());

    await updateTaskAssignees({
      id: "task-1",
      userIds: [],
      currentUserId: "user-1",
    });

    expect(mockGetProjectWorkspaceId).not.toHaveBeenCalled();
    expect(mockFilterAssignableUsers).not.toHaveBeenCalled();
    expect(mockPublishEvent).toHaveBeenCalledWith(
      "task.unassigned",
      expect.objectContaining({ taskId: "task-1" }),
    );
  });
});
