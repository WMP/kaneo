import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_ACCEPT_MAX_AGE_MS,
  clearAutoAcceptMarker,
  consumeAutoAcceptMarker,
  hasFreshAutoAcceptMarker,
  isAutoAcceptMarkerFresh,
  parseAutoAcceptMarker,
  readAutoAcceptMarker,
  writeAutoAcceptMarker,
} from "./auto-accept-invitation";

const NOW = 1_800_000_000_000;

afterEach(() => {
  localStorage.clear();
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
  it("round-trips through localStorage, keyed by invitation", () => {
    writeAutoAcceptMarker("inv-1", NOW);
    expect(readAutoAcceptMarker("inv-1")).toEqual({
      invitationId: "inv-1",
      createdAt: NOW,
    });
    expect(readAutoAcceptMarker("inv-2")).toBeNull();
  });

  it("is visible to another tab and never touches sessionStorage", () => {
    writeAutoAcceptMarker("inv-1", NOW);
    // localStorage is shared by every tab of the origin, sessionStorage is not.
    expect(localStorage.length).toBe(1);
    expect(sessionStorage.length).toBe(0);
  });

  it("consumes a fresh marker for the same invitation exactly once", () => {
    writeAutoAcceptMarker("inv-1", NOW);
    expect(consumeAutoAcceptMarker("inv-1", NOW + 1000)).toBe(true);
    expect(consumeAutoAcceptMarker("inv-1", NOW + 1000)).toBe(false);
    expect(readAutoAcceptMarker("inv-1")).toBeNull();
  });

  it("does not consume a marker written for another invitation", () => {
    writeAutoAcceptMarker("inv-1", NOW);
    expect(consumeAutoAcceptMarker("inv-2", NOW + 1000)).toBe(false);
    expect(readAutoAcceptMarker("inv-1")?.invitationId).toBe("inv-1");
  });

  it("keeps markers of different invitations independent", () => {
    writeAutoAcceptMarker("inv-1", NOW);
    writeAutoAcceptMarker("inv-2", NOW);
    expect(consumeAutoAcceptMarker("inv-1", NOW + 1000)).toBe(true);
    expect(consumeAutoAcceptMarker("inv-2", NOW + 1000)).toBe(true);
  });

  it("clears but does not honour an expired marker", () => {
    writeAutoAcceptMarker("inv-1", NOW);
    expect(
      consumeAutoAcceptMarker("inv-1", NOW + AUTO_ACCEPT_MAX_AGE_MS + 1),
    ).toBe(false);
    expect(readAutoAcceptMarker("inv-1")).toBeNull();
  });

  it("returns false when nothing was written", () => {
    expect(consumeAutoAcceptMarker("inv-1", NOW)).toBe(false);
  });

  it("clears a marker explicitly", () => {
    writeAutoAcceptMarker("inv-1", NOW);
    clearAutoAcceptMarker("inv-1");
    expect(consumeAutoAcceptMarker("inv-1", NOW + 1000)).toBe(false);
  });

  it("prunes stale markers of other invitations when writing", () => {
    writeAutoAcceptMarker("old", NOW);
    writeAutoAcceptMarker("new", NOW + AUTO_ACCEPT_MAX_AGE_MS + 1);
    expect(readAutoAcceptMarker("old")).toBeNull();
    expect(readAutoAcceptMarker("new")).not.toBeNull();
  });

  it("peeks without consuming", () => {
    writeAutoAcceptMarker("inv-1", NOW);
    expect(hasFreshAutoAcceptMarker("inv-1", NOW + 1000)).toBe(true);
    expect(hasFreshAutoAcceptMarker("inv-1", NOW + 1000)).toBe(true);
    expect(
      hasFreshAutoAcceptMarker("inv-1", NOW + AUTO_ACCEPT_MAX_AGE_MS + 1),
    ).toBe(false);
    expect(hasFreshAutoAcceptMarker("inv-2", NOW)).toBe(false);
  });
});

describe("when localStorage throws", () => {
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
    expect(() => clearAutoAcceptMarker("inv-1")).not.toThrow();
    expect(readAutoAcceptMarker("inv-1")).toBeNull();
    expect(hasFreshAutoAcceptMarker("inv-1", NOW)).toBe(false);
    expect(consumeAutoAcceptMarker("inv-1", NOW)).toBe(false);
  });
});
