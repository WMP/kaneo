import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http-error";
import { readProjectApiError } from "@/lib/project-member-error";
import {
  getResourceErrorCode,
  getResourceErrorMessage,
} from "./resource-error";

const t = (key: string) => `t:${key}`;

// What a resource fetcher throws for a failed response.
const apiError = (status: number, code: string) =>
  readProjectApiError(
    new Response(JSON.stringify({ code, message: "raw" }), { status }),
  );

describe("getResourceErrorCode", () => {
  it("reads the code of the API's JSON body", async () => {
    expect(
      getResourceErrorCode(await apiError(409, "ALREADY_WORKSPACE_MEMBER")),
    ).toBe("ALREADY_WORKSPACE_MEMBER");
  });

  it("has none for a plain-text answer, another error or a body without code", async () => {
    expect(
      getResourceErrorCode(
        await readProjectApiError(
          new Response("Insufficient permissions", { status: 403 }),
        ),
      ),
    ).toBe(undefined);
    expect(getResourceErrorCode(new Error("network"))).toBe(undefined);
    expect(getResourceErrorCode(new HttpError(400, "{}"))).toBe(undefined);
    expect(getResourceErrorCode(undefined)).toBe(undefined);
  });
});

describe("getResourceErrorMessage", () => {
  it.each([
    ["ROLE_EXCEEDS_YOUR_PERMISSIONS", "errors.roleExceedsYourPermissions"],
    ["INSUFFICIENT_PERMISSIONS", "errors.insufficientPermissions"],
    ["ALREADY_WORKSPACE_MEMBER", "errors.alreadyWorkspaceMember"],
    ["RESOURCE_HAS_NO_EMAIL", "errors.noEmail"],
    ["NOT_A_WORKSPACE_MEMBER", "errors.notMember"],
    ["RATE_LIMITED", "errors.rateLimited"],
    ["RESOURCE_NOT_FOUND", "errors.notFound"],
    ["WORKSPACE_NOT_FOUND", "errors.workspaceNotFound"],
    ["RESOURCE_NAME_REQUIRED", "nameRequired"],
  ])("maps %s to its translated key", async (code, key) => {
    expect(
      getResourceErrorMessage(await apiError(400, code), t, "fallback"),
    ).toBe(`t:settings:workspaceResources.${key}`);
  });

  it("falls back for an unknown code and never shows the raw body", async () => {
    expect(
      getResourceErrorMessage(
        await apiError(400, "SOMETHING_NEW"),
        t,
        "fallback",
      ),
    ).toBe("t:fallback");
    expect(
      getResourceErrorMessage(
        await readProjectApiError(
          new Response("Internal Server Error", { status: 500 }),
        ),
        t,
        "fallback",
      ),
    ).toBe("t:fallback");
  });
});
