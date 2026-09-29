import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_ACCEPT_MAX_AGE_MS,
  consumeAutoAcceptMarker,
  isAutoAcceptMarkerFresh,
  parseAutoAcceptMarker,
  readAutoAcceptMarker,
  writeAutoAcceptMarker,
} from "./auto-accept-invitation";

const NOW = 1_800_000_000_000;

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("parseAutoAcceptMarker", () => {
  it("parses a well-formed marker", () => {
    expect(
      parseAutoAcceptMarker(
        JSON.stringify({ invitationId: "a", createdAt: 5 }),
      ),
    ).toEqual({ invitationId: "a", createdAt: 5 });
  });

  it.each([
    null,
    "",
    "not json",
    "null",
    "42",
    JSON.stringify({ invitationId: "", createdAt: 1 }),
    JSON.stringify({ invitationId: "a" }),
    JSON.stringify({ invitationId: "a", createdAt: "1" }),
    JSON.stringify({ invitationId: 7, createdAt: 1 }),
  ])("rejects %j", (raw) => {
    expect(parseAutoAcceptMarker(raw)).toBeNull();
  });
});

describe("isAutoAcceptMarkerFresh", () => {
  const marker = { invitationId: "a", createdAt: NOW };

  it("accepts a marker inside the window, boundary included", () => {
    expect(isAutoAcceptMarkerFresh(marker, NOW + 1000)).toBe(true);
    expect(isAutoAcceptMarkerFresh(marker, NOW + AUTO_ACCEPT_MAX_AGE_MS)).toBe(
      true,
    );
  });

  it("rejects an expired marker", () => {
    expect(
      isAutoAcceptMarkerFresh(marker, NOW + AUTO_ACCEPT_MAX_AGE_MS + 1),
    ).toBe(false);
  });

  it("rejects a marker from the future", () => {
    expect(isAutoAcceptMarkerFresh(marker, NOW - 1)).toBe(false);
  });
});

describe("write, read and consume", () => {
  it("round-trips through sessionStorage", () => {
    writeAutoAcceptMarker("inv-1", NOW);
    expect(readAutoAcceptMarker()).toEqual({
      invitationId: "inv-1",
      createdAt: NOW,
    });
  });

  it("consumes a fresh marker for the same invitation exactly once", () => {
    writeAutoAcceptMarker("inv-1", NOW);
    expect(consumeAutoAcceptMarker("inv-1", NOW + 1000)).toBe(true);
    expect(consumeAutoAcceptMarker("inv-1", NOW + 1000)).toBe(false);
    expect(readAutoAcceptMarker()).toBeNull();
  });

  it("does not consume a marker written for another invitation", () => {
    writeAutoAcceptMarker("inv-1", NOW);
    expect(consumeAutoAcceptMarker("inv-2", NOW + 1000)).toBe(false);
    expect(readAutoAcceptMarker()?.invitationId).toBe("inv-1");
  });

  it("clears but does not honour an expired marker", () => {
    writeAutoAcceptMarker("inv-1", NOW);
    expect(
      consumeAutoAcceptMarker("inv-1", NOW + AUTO_ACCEPT_MAX_AGE_MS + 1),
    ).toBe(false);
    expect(readAutoAcceptMarker()).toBeNull();
  });

  it("returns false when nothing was written", () => {
    expect(consumeAutoAcceptMarker("inv-1", NOW)).toBe(false);
  });
});

describe("when sessionStorage throws", () => {
  it("never throws and never grants auto-accept", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => writeAutoAcceptMarker("inv-1", NOW)).not.toThrow();
    expect(readAutoAcceptMarker()).toBeNull();
    expect(consumeAutoAcceptMarker("inv-1", NOW)).toBe(false);
  });
});
