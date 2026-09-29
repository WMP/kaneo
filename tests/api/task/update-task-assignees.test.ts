import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindFirst = vi.fn();
const mockSelect = vi.fn();
const mockPublishEvent = vi.fn();
const mockFilterAssignableUsers = vi.fn();
const mockFilterWorkspaceMembers = vi.fn();
const mockGetProjectWorkspaceId = vi.fn();
const mockFilterWorkspaceResources = vi.fn();
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
  // Workspace-level check, applied to assignees carried over unchanged.
  filterAssignableUsers: (...args: unknown[]) =>
    mockFilterWorkspaceMembers(...args),
  filterProjectAssignableUsers: (...args: unknown[]) =>
    mockFilterAssignableUsers(...args),
  getProjectWorkspaceId: (...args: unknown[]) =>
    mockGetProjectWorkspaceId(...args),
}));

vi.mock("../../../apps/api/src/resource/workspace-resources", () => ({
  filterWorkspaceResources: (...args: unknown[]) =>
    mockFilterWorkspaceResources(...args),
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
    mockFilterWorkspaceMembers.mockImplementation(
      async (ids: string[]) => new Set(ids),
    );
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

  it("rejects with 403 when a new assignee cannot access the project", async () => {
    mockFindFirst.mockResolvedValue(EXISTING_TASK);
    mockGetProjectWorkspaceId.mockResolvedValue("ws-1");
    mockReadTaskAssignees.mockResolvedValue(new Map());
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

  it("rejects with 403 when a carried-over assignee is no longer a workspace member", async () => {
    mockFindFirst.mockResolvedValue(EXISTING_TASK);
    mockGetProjectWorkspaceId.mockResolvedValue("ws-1");
    mockReadTaskAssignees.mockResolvedValue(
      new Map([["task-1", [{ userId: "user-left", resourceId: null }]]]),
    );
    mockFilterAssignableUsers.mockResolvedValue(new Set());
    mockFilterWorkspaceMembers.mockResolvedValue(new Set());

    await expect(
      updateTaskAssignees({
        id: "task-1",
        userIds: ["user-left"],
        currentUserId: "user-1",
      }),
    ).rejects.toMatchObject({ status: 403 });

    // Carried over: only the workspace-level check applies, not the project's.
    expect(mockFilterWorkspaceMembers).toHaveBeenCalledWith(
      ["user-left"],
      "ws-1",
    );
    expect(mockFilterAssignableUsers).toHaveBeenCalledWith([], "proj-1");
    expect(mockSetTaskAssignees).not.toHaveBeenCalled();
  });

  it("rejects with 403 when a resource does not belong to the task's workspace", async () => {
    mockFindFirst.mockResolvedValue(EXISTING_TASK);
    mockGetProjectWorkspaceId.mockResolvedValue("ws-1");
    mockReadTaskAssignees.mockResolvedValue(new Map());
    mockFilterAssignableUsers.mockResolvedValue(new Set(["user-1"]));
    mockFilterWorkspaceResources.mockResolvedValue(new Set());

    await expect(
      updateTaskAssignees({
        id: "task-1",
        userIds: ["user-1"],
        resourceIds: ["resource-outsider"],
        currentUserId: "user-1",
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(mockSetTaskAssignees).not.toHaveBeenCalled();
  });

  it("dedupes ids, validates membership once, and replaces the assignee list", async () => {
    mockFindFirst.mockResolvedValue(EXISTING_TASK);
    mockGetProjectWorkspaceId.mockResolvedValue("ws-1");
    mockFilterAssignableUsers.mockResolvedValue(new Set(["user-1", "user-2"]));
    mockSetTaskAssignees.mockResolvedValue([
      { userId: "user-1" },
      { userId: "user-2" },
    ]);
    const updatedRow = {
      ...EXISTING_TASK,
      userId: "user-1",
      assigneeName: "Ada",
      assigneeId: "user-1",
    };
    mockSelect.mockReturnValue(makeSelectChain([updatedRow]));
    // user-1 was already assigned before this call; only user-2 is new.
    mockReadTaskAssignees.mockResolvedValueOnce(
      new Map([
        [
          "task-1",
          [
            {
              userId: "user-1",
              resourceId: null,
              kind: "user",
              name: "Ada",
              image: null,
              units: 100,
              work: null,
            },
          ],
        ],
      ]),
    );
    mockReadTaskAssignees.mockResolvedValue(
      new Map([
        [
          "task-1",
          [
            {
              userId: "user-1",
              resourceId: null,
              kind: "user",
              name: "Ada",
              image: null,
              units: 100,
              work: null,
            },
            {
              userId: "user-2",
              resourceId: null,
              kind: "user",
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

    // Only the NEW assignee is checked, against the task's project.
    expect(mockFilterAssignableUsers).toHaveBeenCalledWith(
      ["user-2"],
      "proj-1",
    );
    expect(mockFilterWorkspaceResources).not.toHaveBeenCalled();
    expect(mockSetTaskAssignees).toHaveBeenCalledWith(
      expect.anything(),
      "task-1",
      [{ userId: "user-1" }, { userId: "user-2" }],
    );
    expect(result.assignees).toHaveLength(2);
    // The primary assignee is unchanged (user-1 stays first) but user-2 was
    // added, so the event carries the diff.
    expect(mockPublishEvent).toHaveBeenCalledWith(
      "task.assignee_changed",
      expect.objectContaining({
        addedAssigneeIds: ["user-2"],
        removedAssigneeIds: [],
      }),
    );
  });

  it("validates and assigns a mix of users and resources", async () => {
    mockFindFirst.mockResolvedValue(EXISTING_TASK);
    mockGetProjectWorkspaceId.mockResolvedValue("ws-1");
    mockFilterAssignableUsers.mockResolvedValue(new Set(["user-1"]));
    mockFilterWorkspaceResources.mockResolvedValue(new Set(["resource-1"]));
    mockSetTaskAssignees.mockResolvedValue([
      { userId: "user-1" },
      { resourceId: "resource-1" },
    ]);
    mockSelect.mockReturnValue(
      makeSelectChain([
        {
          ...EXISTING_TASK,
          userId: "user-1",
          assigneeName: "Ada",
          assigneeId: "user-1",
        },
      ]),
    );
    // user-1 was already the sole (primary) assignee before this call; only
    // the resource is new.
    mockReadTaskAssignees
      .mockResolvedValueOnce(
        new Map([
          [
            "task-1",
            [
              {
                userId: "user-1",
                resourceId: null,
                kind: "user",
                name: "Ada",
                image: null,
                units: 100,
                work: null,
              },
            ],
          ],
        ]),
      )
      .mockResolvedValueOnce(
        new Map([
          [
            "task-1",
            [
              {
                userId: "user-1",
                resourceId: null,
                kind: "user",
                name: "Ada",
                image: null,
                units: 100,
                work: null,
              },
              {
                userId: null,
                resourceId: "resource-1",
                kind: "equipment",
                name: "Bulldozer",
                image: null,
                units: 100,
                work: null,
              },
            ],
          ],
        ]),
      );

    await updateTaskAssignees({
      id: "task-1",
      userIds: ["user-1"],
      resourceIds: ["resource-1"],
      currentUserId: "user-1",
    });

    expect(mockFilterWorkspaceResources).toHaveBeenCalledWith(
      ["resource-1"],
      "ws-1",
    );
    expect(mockSetTaskAssignees).toHaveBeenCalledWith(
      expect.anything(),
      "task-1",
      [{ userId: "user-1" }, { resourceId: "resource-1" }],
    );
    // task.userId (user-1) is unchanged and no user was added/removed, so a
    // resource-only addition fires no event (a resource has no account to
    // notify, and the activity entry is written in terms of the primary).
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it("publishes task.assignee_changed when the primary assignee changes", async () => {
    mockFindFirst.mockResolvedValue(EXISTING_TASK);
    mockGetProjectWorkspaceId.mockResolvedValue("ws-1");
    mockFilterAssignableUsers.mockResolvedValue(new Set(["user-2"]));
    mockSetTaskAssignees.mockResolvedValue([{ userId: "user-2" }]);
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

  it("carries the full added/removed diff on task.assignee_changed", async () => {
    mockFindFirst.mockResolvedValue(EXISTING_TASK);
    mockGetProjectWorkspaceId.mockResolvedValue("ws-1");
    mockFilterAssignableUsers.mockResolvedValue(new Set(["user-2"]));
    mockSetTaskAssignees.mockResolvedValue([{ userId: "user-2" }]);
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
    // Pre-mutation read (user-1 was the sole assignee), then the
    // post-mutation read (user-2 is now the sole assignee).
    mockReadTaskAssignees
      .mockResolvedValueOnce(
        new Map([
          [
            "task-1",
            [
              {
                userId: "user-1",
                resourceId: null,
                kind: "user",
                name: "Ada",
                image: null,
                units: 100,
                work: null,
              },
            ],
          ],
        ]),
      )
      .mockResolvedValueOnce(
        new Map([
          [
            "task-1",
            [
              {
                userId: "user-2",
                resourceId: null,
                kind: "user",
                name: "Bea",
                image: null,
                units: 100,
                work: null,
              },
            ],
          ],
        ]),
      );

    await updateTaskAssignees({
      id: "task-1",
      userIds: ["user-2"],
      currentUserId: "user-1",
    });

    expect(mockPublishEvent).toHaveBeenCalledWith(
      "task.assignee_changed",
      expect.objectContaining({
        addedAssigneeIds: ["user-2"],
        removedAssigneeIds: ["user-1"],
      }),
    );
  });

  it("publishes task.assignee_changed with addedAssigneeIds when a secondary assignee is added and the primary is unchanged", async () => {
    mockFindFirst.mockResolvedValue(EXISTING_TASK);
    mockGetProjectWorkspaceId.mockResolvedValue("ws-1");
    mockFilterAssignableUsers.mockResolvedValue(new Set(["user-1", "user-2"]));
    mockSetTaskAssignees.mockResolvedValue([
      { userId: "user-1" },
      { userId: "user-2" },
    ]);
    mockSelect.mockReturnValue(
      makeSelectChain([
        {
          ...EXISTING_TASK,
          userId: "user-1",
          assigneeName: "Ada",
          assigneeId: "user-1",
        },
      ]),
    );
    // Pre-mutation: only user-1. Post-mutation: user-1 and user-2.
    mockReadTaskAssignees
      .mockResolvedValueOnce(
        new Map([
          [
            "task-1",
            [
              {
                userId: "user-1",
                resourceId: null,
                kind: "user",
                name: "Ada",
                image: null,
                units: 100,
                work: null,
              },
            ],
          ],
        ]),
      )
      .mockResolvedValueOnce(
        new Map([
          [
            "task-1",
            [
              {
                userId: "user-1",
                resourceId: null,
                kind: "user",
                name: "Ada",
                image: null,
                units: 100,
                work: null,
              },
              {
                userId: "user-2",
                resourceId: null,
                kind: "user",
                name: "Bea",
                image: null,
                units: 100,
                work: null,
              },
            ],
          ],
        ]),
      );

    await updateTaskAssignees({
      id: "task-1",
      userIds: ["user-1", "user-2"],
      currentUserId: "user-1",
    });

    // The primary (user-1) is unchanged, but the added secondary assignee
    // still needs the event to fire so it can be notified downstream.
    expect(mockPublishEvent).toHaveBeenCalledWith(
      "task.assignee_changed",
      expect.objectContaining({
        oldAssignee: "user-1",
        newAssigneeId: "user-1",
        addedAssigneeIds: ["user-2"],
        removedAssigneeIds: [],
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
