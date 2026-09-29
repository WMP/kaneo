import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", () => ({
  default: {},
  schema: {},
}));

import {
  isStatementSubset,
  parsePermissionStatements,
  satisfies,
} from "../../../apps/api/src/utils/role-statements";

describe("isStatementSubset", () => {
  it("accepts an identical or narrower grant", () => {
    const granted = { task: ["read", "update"], project: ["read"] };
    expect(isStatementSubset(granted, granted)).toBe(true);
    expect(isStatementSubset({ task: ["read"] }, granted)).toBe(true);
    expect(isStatementSubset({}, granted)).toBe(true);
  });

  it("rejects an action the granter does not hold", () => {
    expect(
      isStatementSubset({ task: ["read", "delete"] }, { task: ["read"] }),
    ).toBe(false);
  });

  it("rejects a resource the granter does not hold", () => {
    expect(
      isStatementSubset({ workspace: ["delete"] }, { task: ["read"] }),
    ).toBe(false);
  });

  it("ignores resources that carry no actions", () => {
    expect(
      isStatementSubset({ ac: [], task: ["read"] }, { task: ["read"] }),
    ).toBe(true);
  });

  it("agrees with satisfies with the arguments swapped", () => {
    const a = { task: ["read"], project: ["read", "create"] };
    const b = { task: ["read", "update"], project: ["read"] };
    expect(isStatementSubset(a, b)).toBe(satisfies(b, a));
    expect(isStatementSubset(b, a)).toBe(satisfies(a, b));
  });
});

describe("parsePermissionStatements", () => {
  it("drops malformed entries and rejects non-objects", () => {
    expect(
      parsePermissionStatements(
        JSON.stringify({ task: ["read", 1], bad: "x", empty: [] }),
      ),
    ).toEqual({ task: ["read"] });
    expect(parsePermissionStatements("not json")).toBeNull();
    expect(parsePermissionStatements("[]")).toBeNull();
  });
});
