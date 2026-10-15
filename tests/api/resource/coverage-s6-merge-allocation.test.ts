import { describe, expect, it } from "vitest";
import { mergeAssignmentAllocation } from "../../../apps/api/src/resource/transfer-assignments";

describe("mergeAssignmentAllocation", () => {
  it("falls back to a full allocation without work when there are no candidates", () => {
    expect(mergeAssignmentAllocation([])).toEqual({ units: 100, work: null });
  });

  it("takes the higher units and never their sum", () => {
    expect(
      mergeAssignmentAllocation([
        { units: 40, work: null },
        { units: 70, work: null },
      ]),
    ).toEqual({ units: 70, work: null });
  });

  it("keeps the first listed row on a tie in units", () => {
    expect(
      mergeAssignmentAllocation([
        { units: 50, work: 120 },
        { units: 50, work: 480 },
      ]),
    ).toEqual({ units: 50, work: 120 });
  });

  it("keeps work from either side when the winner has none", () => {
    expect(
      mergeAssignmentAllocation([
        { units: 30, work: 600 },
        { units: 80, work: null },
      ]),
    ).toEqual({ units: 80, work: 600 });
  });

  it("returns a single candidate unchanged", () => {
    expect(mergeAssignmentAllocation([{ units: 25, work: 60 }])).toEqual({
      units: 25,
      work: 60,
    });
  });
});
