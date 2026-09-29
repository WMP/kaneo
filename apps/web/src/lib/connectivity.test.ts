import { describe, expect, it } from "vitest";
import {
  indicatesServerUnreachable,
  isConnectivityError,
} from "./connectivity";
import { HttpError } from "./http-error";

describe("isConnectivityError", () => {
  it.each([
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
    "The network connection was lost.",
  ])("recognizes the browser's no-response message %j", (message) => {
    expect(isConnectivityError(new TypeError(message))).toBe(true);
  });

  it("recognizes the message re-thrown on a plain Error (Better Auth wrapper in getWorkspaces)", () => {
    expect(isConnectivityError(new Error("Failed to fetch"))).toBe(true);
  });

  it("never treats an API error (the server answered) as a lost connection", () => {
    // Fetchers word their HttpErrors like this; a substring check used to
    // misread them as network failures.
    expect(
      isConnectivityError(new HttpError(500, "Failed to fetch tasks")),
    ).toBe(false);
    expect(isConnectivityError(new Error("Failed to fetch workspaces"))).toBe(
      false,
    );
  });

  it("ignores unrelated TypeErrors from application code", () => {
    expect(
      isConnectivityError(
        new TypeError("Cannot read properties of undefined (reading 'id')"),
      ),
    ).toBe(false);
    expect(isConnectivityError("Failed to fetch")).toBe(false);
  });
});

describe("indicatesServerUnreachable", () => {
  it("is true for no response and for a proxy's gateway errors", () => {
    expect(indicatesServerUnreachable(new TypeError("Failed to fetch"))).toBe(
      true,
    );
    for (const status of [502, 503, 504]) {
      expect(
        indicatesServerUnreachable(new HttpError(status, "Bad Gateway")),
      ).toBe(true);
    }
  });

  it("is false when the API itself answered, even with an error", () => {
    expect(indicatesServerUnreachable(new HttpError(500, "boom"))).toBe(false);
    expect(indicatesServerUnreachable(new HttpError(404, "nope"))).toBe(false);
    expect(indicatesServerUnreachable(new HttpError(401, "who"))).toBe(false);
  });
});
