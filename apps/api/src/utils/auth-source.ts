// How the current request was authenticated, for the activity log: the same
// person acting through the web UI, an MCP client or an API key must be
// distinguishable. Only a short, non-secret hint of the token is kept; never
// the full token or key.

export type AuthVia = "mcp" | "api";

export type AuthSource = {
  via: AuthVia | null;
  tokenHint: string | null;
};

export const NO_AUTH_SOURCE: AuthSource = { via: null, tokenHint: null };

// Longest API key `start` kept as a hint, in case an instance configured a
// long `startingCharactersConfig`.
const MAX_API_KEY_HINT_CHARS = 8;
const MCP_TOKEN_HINT_CHARS = 4;
const ELLIPSIS = "…";

// `start` is the beginning of the key that better-auth stores and shows in the
// key settings (for example "kaneo_").
export function apiKeyAuthSource(start: string | null | undefined): AuthSource {
  const trimmed = start?.trim();
  return {
    via: "api",
    tokenHint: trimmed
      ? `${trimmed.slice(0, MAX_API_KEY_HINT_CHARS)}${ELLIPSIS}`
      : null,
  };
}

// A session issued for an MCP client is marked server-side (`session.authVia`).
// The hint is the last characters of the bearer token, which is the session
// token the client holds.
export function sessionAuthSource(
  session: { authVia?: unknown } | null | undefined,
  bearerToken: string | null,
): AuthSource {
  if (session?.authVia !== "mcp") {
    return NO_AUTH_SOURCE;
  }
  return {
    via: "mcp",
    tokenHint:
      bearerToken && bearerToken.length >= MCP_TOKEN_HINT_CHARS
        ? `${ELLIPSIS}${bearerToken.slice(-MCP_TOKEN_HINT_CHARS)}`
        : null,
  };
}

// Device-flow client id of the published stdio MCP package (packages/mcp).
export const MCP_DEVICE_CLIENT_ID = "kaneo-mcp";

// Session `authVia` for a session Better Auth is about to create: "mcp" only
// when the device token endpoint issues it to the MCP client. Decided from the
// server-side endpoint context, never from a client-supplied session field
// (`authVia` is `input: false`), and not from the User-Agent.
export function authViaForNewSession(
  ctx: { path?: string; body?: unknown } | null | undefined,
): "mcp" | null {
  if (ctx?.path !== "/device/token") {
    return null;
  }
  const clientId =
    ctx.body && typeof ctx.body === "object"
      ? (ctx.body as { client_id?: unknown }).client_id
      : undefined;
  return clientId === MCP_DEVICE_CLIENT_ID ? "mcp" : null;
}
