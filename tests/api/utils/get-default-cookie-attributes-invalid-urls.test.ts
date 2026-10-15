import { describe, expect, it } from "vitest";
import { getDefaultCookieAttributes } from "../../../apps/api/src/utils/get-default-cookie-attributes";

describe("getDefaultCookieAttributes with unusable URLs", () => {
  it("falls back to non-secure same-site cookies when the API URL cannot be parsed", () => {
    expect(
      getDefaultCookieAttributes({
        apiUrl: "not a url",
        clientUrl: "https://app.example.com",
      }),
    ).toEqual({
      sameSite: "lax",
      secure: false,
      partitioned: false,
      domain: undefined,
    });
  });

  it("does not treat an HTTPS API as cross-site when the client URL cannot be parsed", () => {
    expect(
      getDefaultCookieAttributes({
        apiUrl: "https://api.example.com",
        clientUrl: "::::",
        cookieDomain: "",
      }),
    ).toEqual({
      sameSite: "lax",
      secure: true,
      partitioned: false,
      domain: undefined,
    });
  });
});
