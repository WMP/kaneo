import { describe, expect, it, vi } from "vitest";
import { isBeforeDay, nextVmName } from "./infrastructure-format";

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));

describe("nextVmName", () => {
  it("increments a numeric suffix", () => {
    expect(nextVmName("billing-db-1", ["billing-db-1"])).toBe("billing-db-2");
  });

  it("adds -2 to a name without a suffix", () => {
    expect(nextVmName("web", ["web"])).toBe("web-2");
  });

  it("skips names that are taken", () => {
    expect(nextVmName("web", ["web", "web-2", "web-3"])).toBe("web-4");
  });

  it("leaves an empty name empty", () => {
    expect(nextVmName("  ", [])).toBe("");
  });
});

describe("isBeforeDay", () => {
  it("compares date-only strings", () => {
    expect(isBeforeDay("2026-09-29", "2026-10-12")).toBe(true);
    expect(isBeforeDay("2026-10-12", "2026-10-12")).toBe(false);
    expect(isBeforeDay(null, "2026-10-12")).toBe(false);
    expect(isBeforeDay("2026-09-29", undefined)).toBe(false);
  });
});
