import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockPublishEvent = vi.fn();
const mockCreateNotification = vi.fn();
const mockReadTaskAssignees = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
  },
}));

vi.mock("../../../apps/api/src/events", () => ({
  publishEvent: (...args: unknown[]) => mockPublishEvent(...args),
}));

vi.mock(
  "../../../apps/api/src/notification/controllers/create-notification",
  () => ({
    default: (...args: unknown[]) => mockCreateNotification(...args),
  }),
);

vi.mock("../../../apps/api/src/task/assignments", () => ({
  readTaskAssignees: (...args: unknown[]) => mockReadTaskAssignees(...args),
}));

import createComment from "../../../apps/api/src/activity/controllers/create-comment";

// createComment's own selects both terminate at `.where()` (no `.limit()`),
// and its insert terminates at `.returning()`, so those are the two calls
// this stub resolves to `rows`.
function makeQueryStub(rows: unknown[]) {
  const resolved = Promise.resolve(rows);
  const stub = {
    from: () => stub,
    innerJoin: () => stub,
    where: () => resolved,
    values: () => stub,
    returning: () => resolved,
  };
  return stub;
}

const ACTIVITY_ROW = {
  id: "activity-1",
  type: "comment",
  userId: "commenter-1",
  content: "",
};

const TASK_ROW = {
  projectId: "proj-1",
  title: "Ship it",
  workspaceId: "ws-1",
};

describe("createComment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockInsert.mockReturnValue(makeQueryStub([ACTIVITY_ROW]));
  });

  it("notifies every current assignee except the commenter", async () => {
    mockSelect
      .mockReturnValueOnce(makeQueryStub([{ name: "Commenter" }])) // user lookup
      .mockReturnValueOnce(makeQueryStub([TASK_ROW])); // task lookup
    mockReadTaskAssignees.mockResolvedValue(
      new Map([
        [
          "task-1",
          [
            {
              userId: "commenter-1",
              name: "Commenter",
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
            {
              userId: "user-3",
              name: "Carl",
              image: null,
              units: 100,
              work: null,
            },
          ],
        ],
      ]),
    );

    await createComment("task-1", "commenter-1", "Looks good");

    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    const notifiedIds = mockCreateNotification.mock.calls
      .map((call) => (call[0] as { userId: string }).userId)
      .sort();
    expect(notifiedIds).toEqual(["user-2", "user-3"]);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "task_comment", resourceId: "task-1" }),
    );
  });

  it("does not double-notify an assignee already notified as a mention", async () => {
    mockSelect
      .mockReturnValueOnce(makeQueryStub([{ name: "Commenter" }]))
      .mockReturnValueOnce(makeQueryStub([TASK_ROW]));
    mockReadTaskAssignees.mockResolvedValue(
      new Map([
        [
          "task-1",
          [
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

    await createComment(
      "task-1",
      "commenter-1",
      'cc <kaneo-mention id="user-2">Bea</kaneo-mention>',
    );

    const mentionCalls = mockCreateNotification.mock.calls.filter(
      (call) => (call[0] as { type: string }).type === "task_mention",
    );
    const commentCalls = mockCreateNotification.mock.calls.filter(
      (call) => (call[0] as { type: string }).type === "task_comment",
    );
    expect(mentionCalls).toHaveLength(1);
    expect(commentCalls).toHaveLength(0);
  });

  it("notifies no one when the task has no other assignees", async () => {
    mockSelect
      .mockReturnValueOnce(makeQueryStub([{ name: "Commenter" }]))
      .mockReturnValueOnce(makeQueryStub([TASK_ROW]));
    mockReadTaskAssignees.mockResolvedValue(new Map());

    await createComment("task-1", "commenter-1", "Looks good");

    expect(mockCreateNotification).not.toHaveBeenCalled();
  });
});
