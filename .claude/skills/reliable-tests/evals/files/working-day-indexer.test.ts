import { describe, expect, it } from "vitest";
import { isWorkingDay, makeWorkingDayIndexer } from "./gantt-working-calendar";

describe("makeWorkingDayIndexer", () => {
  it("numbers each day by the working days before it", () => {
    const anchor = new Date(2026, 0, 1);
    const holidays = new Set(["2026-01-06"]);
    const index = makeWorkingDayIndexer(anchor, 62, holidays);
    for (let offset = 0; offset < 60; offset++) {
      const date = new Date(2026, 0, 1 + offset);
      let expected = 0;
      for (let k = 0; k < offset; k++) {
        if (isWorkingDay(new Date(2026, 0, 1 + k), 62, holidays)) expected++;
      }
      expect(index(date)).toBe(expected);
    }
  });
});
