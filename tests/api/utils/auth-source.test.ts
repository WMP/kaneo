import { describe, expect, it } from "vitest";
import {
  apiKeyAuthSource,
  authViaForNewSession,
  MCP_DEVICE_CLIENT_ID,
  NO_AUTH_SOURCE,
  sessionAuthSource,
} from "../../../apps/api/src/utils/auth-source";

describe("apiKeyAuthSource", () => {
  it("labels an API key and keeps only the stored start as the hint", () => {
    expect(apiKeyAuthSource("kaneo_ab")).toEqual({
      via: "api",
      tokenHint: "kaneo_ab…",
    });
  });

  it("caps a long configured start", () => {
    const source = apiKeyAuthSource("kaneo_abcdefghijklmnop");
    expect(source.tokenHint).toBe("kaneo_ab…");
  });

  it("has no hint when the key has no stored start", () => {
    expect(apiKeyAuthSource(null)).toEqual({ via: "api", tokenHint: null });
    expect(apiKeyAuthSource("  ")).toEqual({ via: "api", tokenHint: null });
  });
});

describe("sessionAuthSource", () => {
  const token = "3f2a9c1e-7b5d-4e8a-9c0d-1234567890a1b2";

  it("labels an MCP session with the last 4 characters of the token only", () => {
    const source = sessionAuthSource({ authVia: "mcp" }, token);
    expect(source).toEqual({ via: "mcp", tokenHint: "…a1b2" });
    expect(JSON.stringify(source)).not.toContain(token);
    expect(JSON.stringify(source)).not.toContain(token.slice(0, -4));
  });

  it("treats a cookie or plain bearer session as the web UI", () => {
    expect(sessionAuthSource({ authVia: null }, token)).toBe(NO_AUTH_SOURCE);
    expect(sessionAuthSource({}, token)).toBe(NO_AUTH_SOURCE);
    expect(sessionAuthSource(null, token)).toBe(NO_AUTH_SOURCE);
    expect(sessionAuthSource({ authVia: "other" }, token)).toBe(NO_AUTH_SOURCE);
  });

  it("omits the hint rather than exposing a token shorter than the hint", () => {
    expect(sessionAuthSource({ authVia: "mcp" }, "abc")).toEqual({
      via: "mcp",
      tokenHint: null,
    });
    expect(sessionAuthSource({ authVia: "mcp" }, null)).toEqual({
      via: "mcp",
      tokenHint: null,
    });
  });
});

describe("authViaForNewSession", () => {
  it("marks a session issued by the device token endpoint to the MCP client", () => {
    expect(
      authViaForNewSession({
        path: "/device/token",
        body: { client_id: MCP_DEVICE_CLIENT_ID },
      }),
    ).toBe("mcp");
  });

  it("does not mark other clients, endpoints or missing context", () => {
    expect(
      authViaForNewSession({
        path: "/device/token",
        body: { client_id: "kaneo-cli" },
      }),
    ).toBeNull();
    expect(
      authViaForNewSession({
        path: "/sign-in/email",
        body: { client_id: MCP_DEVICE_CLIENT_ID },
      }),
    ).toBeNull();
    expect(authViaForNewSession({ path: "/device/token" })).toBeNull();
    expect(
      authViaForNewSession({ path: "/device/token", body: null }),
    ).toBeNull();
    expect(authViaForNewSession(null)).toBeNull();
    expect(authViaForNewSession(undefined)).toBeNull();
  });
});
