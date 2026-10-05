import { describe, expect, it } from "vitest";
import { buildScheduleChanges } from "../../../apps/api/src/task/diff-schedule-fields";
import {
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
