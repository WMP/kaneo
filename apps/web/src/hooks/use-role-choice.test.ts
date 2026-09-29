import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRoleChoice } from "./use-role-choice";

const choice = (roles: string[] | undefined) =>
  renderHook(({ list }) => useRoleChoice(list), {
    initialProps: { list: roles },
  });

describe("useRoleChoice", () => {
  it("defaults to member while it is assignable", () => {
    const { result } = choice(["viewer", "member", "admin"]);

    expect(result.current.role).toBe("member");
    expect(result.current.needsExplicit).toBe(false);
  });

  it("never falls back to the first listed role when member is not assignable", () => {
    const { result } = choice(["admin", "viewer"]);

    expect(result.current.role).toBeUndefined();
    expect(result.current.needsExplicit).toBe(true);
  });

  it("uses the pick, and drops it when it vanishes from a refetched list without replacing it", () => {
    const { result, rerender } = choice(["viewer", "member", "qa-lead"]);
    act(() => result.current.select("qa-lead"));
    expect(result.current.role).toBe("qa-lead");

    rerender({ list: ["viewer", "member"] });

    expect(result.current.role).toBeUndefined();
    expect(result.current.unavailable).toBe(true);
    expect(result.current.selected).toBe("qa-lead");
    expect(result.current.needsExplicit).toBe(false);
  });

  it("has no role and no data until the list is known", () => {
    const { result } = choice(undefined);

    expect(result.current.hasData).toBe(false);
    expect(result.current.role).toBeUndefined();
    expect(result.current.needsExplicit).toBe(false);
  });

  it("reports an empty list", () => {
    const { result } = choice([]);

    expect(result.current.isEmpty).toBe(true);
    expect(result.current.role).toBeUndefined();
    expect(result.current.needsExplicit).toBe(false);
  });
});
