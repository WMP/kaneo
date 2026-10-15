import { describe, expect, it } from "vitest";
import { buildFullTaskUpdateBody, isTaskPriority } from "./task-helpers.js";

const existing = {
  title: "T",
  description: "D",
  status: "to-do",
  priority: "high",
  projectId: "p1",
  position: 3,
};

describe("isTaskPriority", () => {
  it("accepts the five priorities and nothing else", () => {
    for (const p of ["no-priority", "low", "medium", "high", "urgent"]) {
      expect(isTaskPriority(p)).toBe(true);
    }
    expect(isTaskPriority("critical")).toBe(false);
    expect(isTaskPriority("")).toBe(false);
  });
});

describe("buildFullTaskUpdateBody validation", () => {
  it("reads the position from a numeric string on the existing task", () => {
    expect(
      buildFullTaskUpdateBody({ ...existing, position: "7" }, {}).position,
    ).toBe(7);
  });

  it.each([["abc"], [undefined], [null], [Number.NaN]])(
    "rejects a non-numeric position (%s)",
    (position) => {
      expect(() =>
        buildFullTaskUpdateBody({ ...existing, position }, {}),
      ).toThrow("missing numeric `position`");
    },
  );

  it.each([
    [{ title: "" }, "missing title"],
    [{ title: 5 }, "missing title"],
    [{ status: undefined }, "missing status"],
    [{ priority: "nope" }, "invalid or missing priority"],
    [{ priority: undefined }, "invalid or missing priority"],
    [{ projectId: undefined }, "missing projectId"],
  ])("rejects an existing task with %j", (override, message) => {
    expect(() =>
      buildFullTaskUpdateBody({ ...existing, ...override }, {}),
    ).toThrow(message);
  });

  it("converts null description to an empty string and keeps an existing null as empty", () => {
    expect(
      buildFullTaskUpdateBody(existing, { description: null }).description,
    ).toBe("");
    expect(
      buildFullTaskUpdateBody({ ...existing, description: null }, {})
        .description,
    ).toBe("");
    expect(
      buildFullTaskUpdateBody(existing, { description: "New" }).description,
    ).toBe("New");
  });

  it("unassigns the primary assignee with an empty userId when patch.userId is null", () => {
    expect(
      buildFullTaskUpdateBody({ ...existing, userId: "u1" }, { userId: null })
        .userId,
    ).toBe("");
    expect(
      buildFullTaskUpdateBody({ ...existing, userId: "u1" }, { userId: "u2" })
        .userId,
    ).toBe("u2");
    expect(
      buildFullTaskUpdateBody({ ...existing, userId: "u1" }, {}).userId,
    ).toBe("u1");
    expect(buildFullTaskUpdateBody(existing, {})).not.toHaveProperty("userId");
  });

  it("formats dates from Date objects and strings and drops null or invalid values", () => {
    const body = buildFullTaskUpdateBody(
      {
        ...existing,
        startDate: new Date("2025-01-02T03:04:05.000Z"),
        dueDate: 12345,
      },
      {},
    );
    expect(body.startDate).toBe("2025-01-02T03:04:05.000Z");
    expect(body).not.toHaveProperty("dueDate");

    const patched = buildFullTaskUpdateBody(
      { ...existing, startDate: "2025-01-01", dueDate: "2025-02-02" },
      { startDate: null, dueDate: "2025-03-03" },
    );
    expect(patched).not.toHaveProperty("startDate");
    expect(patched.dueDate).toBe("2025-03-03");
  });
});
