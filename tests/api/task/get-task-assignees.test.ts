import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockReadTaskAssignees = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

vi.mock("../../../apps/api/src/task/assignments", () => ({
  readTaskAssignees: (...args: unknown[]) => mockReadTaskAssignees(...args),
}));

import getTask from "../../../apps/api/src/task/controllers/get-task";

function makeSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

describe("getTask", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("throws 404 when the task does not exist", async () => {
    mockSelect.mockReturnValue(makeSelectChain([]));

    await expect(getTask("missing")).rejects.toMatchObject({ status: 404 });
    expect(mockReadTaskAssignees).not.toHaveBeenCalled();
  });

  it("attaches the batched assignees array alongside the existing primary fields", async () => {
    const taskRow = {
      id: "task-1",
      userId: "user-1",
      assigneeName: "Ada",
      assigneeId: "user-1",
      projectId: "proj-1",
    };
    mockSelect.mockReturnValue(makeSelectChain([taskRow]));
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
          ],
        ],
      ]),
    );

    const result = await getTask("task-1");

    expect(mockReadTaskAssignees).toHaveBeenCalledWith(expect.anything(), [
      "task-1",
    ]);
    expect(result).toEqual({
      ...taskRow,
      assignees: [
        { userId: "user-1", name: "Ada", image: null, units: 100, work: null },
      ],
    });
  });

  it("defaults assignees to an empty array when the task has none", async () => {
    const taskRow = {
      id: "task-2",
      userId: null,
      assigneeName: null,
      assigneeId: null,
      projectId: "proj-1",
    };
    mockSelect.mockReturnValue(makeSelectChain([taskRow]));
    mockReadTaskAssignees.mockResolvedValue(new Map());

    const result = await getTask("task-2");

    expect(result.assignees).toEqual([]);
  });
});
