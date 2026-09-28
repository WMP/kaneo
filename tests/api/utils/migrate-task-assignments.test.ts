import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn();
const mockInsert = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    execute: (...args: unknown[]) => mockExecute(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
  },
}));

import { migrateTaskAssignments } from "../../../apps/api/src/utils/migrate-task-assignments";

function makeInsertChain() {
  const chain = {
    values: vi.fn(() => chain),
    onConflictDoNothing: vi.fn(() => Promise.resolve()),
  };
  return chain;
}

describe("migrateTaskAssignments", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("inserts one assignment row (units=100) per task missing one", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        { task_id: "task-1", user_id: "user-1" },
        { task_id: "task-2", user_id: "user-2" },
      ],
    });
    const insertChain = makeInsertChain();
    mockInsert.mockReturnValue(insertChain);

    await migrateTaskAssignments();

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(insertChain.values).toHaveBeenCalledWith([
      expect.objectContaining({
        id: expect.any(String),
        taskId: "task-1",
        userId: "user-1",
        units: 100,
      }),
      expect.objectContaining({
        id: expect.any(String),
        taskId: "task-2",
        userId: "user-2",
        units: 100,
      }),
    ]);
    expect(insertChain.onConflictDoNothing).toHaveBeenCalledWith({
      target: expect.arrayContaining([expect.anything(), expect.anything()]),
    });
  });

  it("is idempotent: a repeat run with nothing missing does not insert", async () => {
    mockExecute.mockResolvedValue({ rows: [] });

    await migrateTaskAssignments();

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("chunks large backfills so no single insert exceeds the bind-parameter-safe batch size", async () => {
    const rows = Array.from({ length: 1200 }, (_, index) => ({
      task_id: `task-${index}`,
      user_id: `user-${index}`,
    }));
    mockExecute.mockResolvedValue({ rows });
    const insertChain = makeInsertChain();
    mockInsert.mockReturnValue(insertChain);

    await migrateTaskAssignments();

    // 1200 rows at 500/chunk -> 3 inserts (500, 500, 200).
    expect(mockInsert).toHaveBeenCalledTimes(3);
    expect(insertChain.values.mock.calls[0][0]).toHaveLength(500);
    expect(insertChain.values.mock.calls[2][0]).toHaveLength(200);
  });
});
