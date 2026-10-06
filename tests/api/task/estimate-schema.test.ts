import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { buildScheduleChanges } from "../../../apps/api/src/task/diff-schedule-fields";
import {
  assertEstimateExcludesDateRange,
  ESTIMATE_DATE_RANGE_CONFLICT_MESSAGE,
  ESTIMATE_DATE_RANGE_CONSTRAINT,
  isEstimateDateRangeViolation,
  MAX_ESTIMATE_MINUTES,
  WORK_DAY_MINUTES,
} from "../../../apps/api/src/task/estimate";
import {
  createTaskBody,
  updateTaskBody,
} from "../../../apps/api/src/task/schema";

const baseCreate = {
  title: "T",
  description: "",
  priority: "low",
  status: "to-do",
};

const baseUpdate = {
  title: "T",
  status: "to-do",
  priority: "low",
  projectId: "p1",
  position: 0,
};

describe("task estimate validation", () => {
  it("defines a work day as 8 hours", () => {
    expect(WORK_DAY_MINUTES).toBe(480);
  });

  it("leaves the estimate undefined when omitted on update (untouched)", () => {
    const parsed = updateTaskBody.parse(baseUpdate);
    expect(parsed.estimateMinutes).toBeUndefined();
    expect(parsed.estimateUnit).toBeUndefined();
  });

  it("accepts null to clear and the boundary values", () => {
    expect(
      updateTaskBody.parse({ ...baseUpdate, estimateMinutes: null })
        .estimateMinutes,
    ).toBeNull();
    expect(
      updateTaskBody.parse({ ...baseUpdate, estimateMinutes: 0 })
        .estimateMinutes,
    ).toBe(0);
    expect(
      updateTaskBody.parse({
        ...baseUpdate,
        estimateMinutes: MAX_ESTIMATE_MINUTES,
        estimateUnit: "days",
      }),
    ).toMatchObject({
      estimateMinutes: MAX_ESTIMATE_MINUTES,
      estimateUnit: "days",
    });
  });

  it.each([-1, 1.5, MAX_ESTIMATE_MINUTES + 1, Number.NaN, "60"])(
    "rejects estimateMinutes %s on update and create",
    (value) => {
      expect(
        updateTaskBody.safeParse({ ...baseUpdate, estimateMinutes: value })
          .success,
      ).toBe(false);
      expect(
        createTaskBody.safeParse({ ...baseCreate, estimateMinutes: value })
          .success,
      ).toBe(false);
    },
  );

  it.each(["weeks", "", null, 1])("rejects estimateUnit %s", (value) => {
    expect(
      updateTaskBody.safeParse({ ...baseUpdate, estimateUnit: value }).success,
    ).toBe(false);
    expect(
      createTaskBody.safeParse({ ...baseCreate, estimateUnit: value }).success,
    ).toBe(false);
  });

  it("records an estimate change in the schedule diff and ignores the unchanged one", () => {
    expect(
      buildScheduleChanges({ estimateMinutes: null }, { estimateMinutes: 480 }),
    ).toEqual({ estimateMinutes: { from: null, to: 480 } });
    expect(
      buildScheduleChanges({ estimateMinutes: 480 }, { estimateMinutes: 480 }),
    ).toEqual({});
  });
});

describe("estimate versus date range rule", () => {
  const start = new Date("2026-03-02T00:00:00.000Z");
  const due = new Date("2026-03-06T00:00:00.000Z");

  it.each([
    ["estimate and no dates", 60, null, null],
    ["estimate and start only", 60, start, null],
    ["estimate and due only", 60, null, due],
    ["a zero estimate and no dates", 0, null, null],
    ["both dates without an estimate", null, start, due],
    ["both dates, estimate undefined", undefined, start, due],
  ])("allows %s", (_name, estimateMinutes, startDate, dueDate) => {
    expect(() =>
      assertEstimateExcludesDateRange({ estimateMinutes, startDate, dueDate }),
    ).not.toThrow();
  });

  it.each([
    ["an estimate", 60],
    ["a zero estimate", 0],
  ])("rejects %s with both dates as a stable 400", (_name, estimateMinutes) => {
    try {
      assertEstimateExcludesDateRange({
        estimateMinutes,
        startDate: start,
        dueDate: due,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).status).toBe(400);
      expect((error as HTTPException).message).toBe(
        ESTIMATE_DATE_RANGE_CONFLICT_MESSAGE,
      );
    }
  });

  it("recognizes the check violation, also when wrapped", () => {
    const pgError = {
      code: "23514",
      constraint: ESTIMATE_DATE_RANGE_CONSTRAINT,
    };
    expect(isEstimateDateRangeViolation(pgError)).toBe(true);
    expect(isEstimateDateRangeViolation({ cause: pgError })).toBe(true);
    expect(
      isEstimateDateRangeViolation({ code: "23514", constraint: "other" }),
    ).toBe(false);
    expect(isEstimateDateRangeViolation(new Error("x"))).toBe(false);
    expect(isEstimateDateRangeViolation(null)).toBe(false);
  });
});
