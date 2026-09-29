import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http-error";
import {
  getResourceErrorCode,
  getResourceErrorMessage,
} from "./resource-error";

const t = (key: string) => `t:${key}`;
const body = (code: string) => JSON.stringify({ code, message: "raw" });

describe("getResourceErrorCode", () => {
  it("reads the code of the API's JSON body", () => {
    expect(
      getResourceErrorCode(
        new HttpError(409, body("ALREADY_WORKSPACE_MEMBER")),
      ),
    ).toBe("ALREADY_WORKSPACE_MEMBER");
  });

  it("has none for a plain-text answer, another error or a body without code", () => {
    expect(
      getResourceErrorCode(new HttpError(403, "Insufficient permissions")),
    ).toBe(undefined);
    expect(getResourceErrorCode(new Error("network"))).toBe(undefined);
    expect(getResourceErrorCode(new HttpError(400, "{}"))).toBe(undefined);
    expect(getResourceErrorCode(undefined)).toBe(undefined);
  });
});

describe("getResourceErrorMessage", () => {
  it.each([
    ["ROLE_EXCEEDS_YOUR_PERMISSIONS", "roleExceedsYourPermissions"],
    ["INSUFFICIENT_PERMISSIONS", "insufficientPermissions"],
    ["ALREADY_WORKSPACE_MEMBER", "alreadyWorkspaceMember"],
    ["RESOURCE_HAS_NO_EMAIL", "noEmail"],
    ["NOT_A_WORKSPACE_MEMBER", "notMember"],
    ["RATE_LIMITED", "rateLimited"],
  ])("maps %s to its translated key", (code, key) => {
    expect(
      getResourceErrorMessage(new HttpError(400, body(code)), t, "fallback"),
    ).toBe(`t:settings:workspaceResources.errors.${key}`);
  });

  it("falls back for an unknown code and never shows the raw body", () => {
    expect(
      getResourceErrorMessage(
        new HttpError(400, body("SOMETHING_NEW")),
        t,
        "fallback",
      ),
    ).toBe("t:fallback");
    expect(
      getResourceErrorMessage(
        new HttpError(500, "Internal Server Error"),
        t,
        "fallback",
      ),
    ).toBe("t:fallback");
  });
});
