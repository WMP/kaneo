import { describe, expect, it } from "vitest";
import {
  estimateToWorkingDays,
  formatEstimate,
  hasFullDateRange,
  isDateBlockedByEstimate,
  MAX_ESTIMATE_MINUTES,
  minutesToUnitValue,
  parseEstimateInput,
  WORK_DAY_MINUTES,
} from "./estimate";

describe("estimate helpers", () => {
  it("treats a work day as 8 hours", () => {
    expect(WORK_DAY_MINUTES).toBe(480);
  });

  it("converts minutes back to the entered unit", () => {
    expect(minutesToUnitValue(90, "hours")).toBe(1.5);
    expect(minutesToUnitValue(240, "days")).toBe(0.5);
    expect(minutesToUnitValue(960, "days")).toBe(2);
  });

  it("parses decimal hours and days into whole minutes", () => {
    expect(parseEstimateInput("1.5", "hours")).toEqual({
      kind: "value",
      minutes: 90,
    });
    expect(parseEstimateInput("0,5", "days")).toEqual({
      kind: "value",
      minutes: 240,
    });
    expect(parseEstimateInput(".25", "hours")).toEqual({
      kind: "value",
      minutes: 15,
    });
    // Rounded to a whole minute.
    expect(parseEstimateInput("0.3333", "hours")).toEqual({
      kind: "value",
      minutes: 20,
    });
  });

  it("treats blank text as clearing and bad text as invalid", () => {
    expect(parseEstimateInput("  ", "hours")).toEqual({ kind: "empty" });
    for (const text of ["abc", "-1", "1e3", "1.2.3", "--", "1 h"]) {
      expect(parseEstimateInput(text, "hours")).toEqual({ kind: "invalid" });
    }
    expect(parseEstimateInput(String(MAX_ESTIMATE_MINUTES), "hours")).toEqual({
      kind: "invalid",
    });
  });

  it("sizes a Gantt bar in whole working days, at least one", () => {
    expect(estimateToWorkingDays(0)).toBe(1);
    expect(estimateToWorkingDays(30)).toBe(1);
    expect(estimateToWorkingDays(480)).toBe(1);
    expect(estimateToWorkingDays(481)).toBe(2);
    expect(estimateToWorkingDays(1200)).toBe(3);
  });

  it("formats an estimate in the unit it was entered in", () => {
    const t = (key: string, options?: Record<string, unknown>) =>
      `${key}|${options?.value}`;
    expect(formatEstimate(90, "hours", t)).toBe(
      "tasks:estimate.valueHours|1.5",
    );
    expect(formatEstimate(960, "days", t)).toBe("tasks:estimate.valueDays|2");
    expect(formatEstimate(60, undefined, t)).toBe(
      "tasks:estimate.valueHours|1",
    );
  });
});

describe("estimate versus date range", () => {
  it("detects a complete date range", () => {
    expect(hasFullDateRange("2026-10-05", "2026-10-09")).toBe(true);
    expect(hasFullDateRange("2026-10-05", null)).toBe(false);
    expect(hasFullDateRange(null, "2026-10-09")).toBe(false);
    expect(hasFullDateRange(null, null)).toBe(false);
  });

  it("blocks only the empty date picker of an estimated task with the other date set", () => {
    // estimate + start only: the due picker is blocked, the start picker is not.
    expect(isDateBlockedByEstimate(60, null, "2026-10-05")).toBe(true);
    expect(isDateBlockedByEstimate(60, "2026-10-05", null)).toBe(false);
    // A zero estimate is still an estimate.
    expect(isDateBlockedByEstimate(0, null, "2026-10-05")).toBe(true);
    // No estimate, or no date yet: nothing is blocked.
    expect(isDateBlockedByEstimate(null, null, "2026-10-05")).toBe(false);
    expect(isDateBlockedByEstimate(undefined, null, "2026-10-05")).toBe(false);
    expect(isDateBlockedByEstimate(60, null, null)).toBe(false);
  });
});
