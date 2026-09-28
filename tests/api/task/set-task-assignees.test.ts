import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readTaskAssignees,
  setTaskAssignees,
} from "../../../apps/api/src/task/assignments";

type RecordedCall = {
  op: "delete" | "insert" | "update";
  table: unknown;
  arg?: unknown;
};

function createMockExecutor() {
  const calls: RecordedCall[] = [];

  const deleteFn = vi.fn((table: unknown) => ({
    where: vi.fn((cond: unknown) => {
      calls.push({ op: "delete", table, arg: cond });
      return Promise.resolve();
    }),
  }));

  const insertFn = vi.fn((table: unknown) => ({
    values: vi.fn((rows: unknown) => ({
      onConflictDoNothing: vi.fn(() => {
        calls.push({ op: "insert", table, arg: rows });
        return Promise.resolve();
      }),
    })),
  }));

  const updateFn = vi.fn((table: unknown) => ({
    set: vi.fn((values: unknown) => ({
      where: vi.fn(() => {
        calls.push({ op: "update", table, arg: values });
        return Promise.resolve();
      }),
    })),
  }));

  const executor = {
    delete: deleteFn,
    insert: insertFn,
    update: updateFn,
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(executor)),
  };

  return { executor, calls };
}

describe("setTaskAssignees", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("dedupes, preserves the first id as primary, and mirrors it onto task.userId", async () => {
    const { executor, calls } = createMockExecutor();

    const result = await setTaskAssignees(
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural mock
      executor as any,
      "task-1",
      ["user-1", "user-2", "user-1", "  ", "user-2"],
    );

    expect(result).toEqual(["user-1", "user-2"]);

    const insertCall = calls.find((call) => call.op === "insert");
    expect(insertCall?.arg).toEqual([
      { taskId: "task-1", userId: "user-1" },
      { taskId: "task-1", userId: "user-2" },
    ]);

    const updateCall = calls.find((call) => call.op === "update");
    expect(updateCall?.arg).toEqual({ userId: "user-1" });

    expect(executor.transaction).toHaveBeenCalledTimes(1);
  });

  it("replaces the previous rows: a stale assignee not in the new list is deleted", async () => {
    const { executor, calls } = createMockExecutor();

    await setTaskAssignees(
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural mock
      executor as any,
      "task-1",
      ["user-2"],
    );

    const deleteCall = calls.find((call) => call.op === "delete");
    expect(deleteCall).toBeDefined();
    expect(executor.insert).toHaveBeenCalled();
  });

  it("clears every assignment and nulls the primary when given an empty list", async () => {
    const { executor, calls } = createMockExecutor();

    const result = await setTaskAssignees(
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural mock
      executor as any,
      "task-1",
      [],
    );

    expect(result).toEqual([]);
    expect(executor.insert).not.toHaveBeenCalled();

    const updateCall = calls.find((call) => call.op === "update");
    expect(updateCall?.arg).toEqual({ userId: null });
  });
});

describe("readTaskAssignees", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns an empty map without querying when given no task ids", async () => {
    const selectFn = vi.fn();
    const executor = { select: selectFn };

    // biome-ignore lint/suspicious/noExplicitAny: minimal structural mock
    const result = await readTaskAssignees(executor as any, []);

    expect(result.size).toBe(0);
    expect(selectFn).not.toHaveBeenCalled();
  });

  it("batches every task's assignees, joined to the user table, into one map", async () => {
    const rows = [
      {
        taskId: "task-1",
        userId: "user-1",
        name: "Ada",
        image: null,
        units: 100,
        work: null,
        createdAt: new Date("2024-01-01"),
      },
      {
        taskId: "task-1",
        userId: "user-2",
        name: "Bea",
        image: "https://example.com/bea.png",
        units: 50,
        work: 8,
        createdAt: new Date("2024-01-02"),
      },
    ];

    const chain = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => Promise.resolve(rows)),
    };
    const selectFn = vi.fn(() => chain);
    const executor = { select: selectFn };

    const result = await readTaskAssignees(
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural mock
      executor as any,
      ["task-1"],
    );

    expect(selectFn).toHaveBeenCalledTimes(1);
    expect(result.get("task-1")).toEqual([
      { userId: "user-1", name: "Ada", image: null, units: 100, work: null },
      {
        userId: "user-2",
        name: "Bea",
        image: "https://example.com/bea.png",
        units: 50,
        work: 8,
      },
    ]);
  });
});
