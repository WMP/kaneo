export type McpConnection = {
  /** Streamable HTTP MCP endpoint, e.g. https://kaneo.example.com/api/mcp. */
  mcpUrl: string;
  /** Instance base URL without the `/api/mcp` suffix, used by the stdio package. */
  baseUrl: string;
  claudeCodeAdd: string;
  claudeCodeAllowedTools: string;
  codexAdd: string;
  codexLogin: string;
  codexConfigToml: string;
  cursorJson: string;
  stdioInstall: string;
};

const MCP_SUFFIX = /\/api\/mcp$/;
const API_SUFFIX = /\/api$/;

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, "");
}

/**
 * Builds the connection snippets for the instance's built-in MCP endpoint.
 *
 * `apiUrl` may be the MCP URL itself, the API base (`.../api`, the shape of
 * VITE_API_URL) or the bare instance URL, with or without trailing slashes. A
 * relative value is resolved against `origin`.
 */
export function buildMcpConnection(
  apiUrl: string,
  origin: string = globalThis.location?.origin ?? "",
): McpConnection {
  const absolute = new URL(apiUrl, origin || undefined);
  const path = trimTrailingSlashes(absolute.pathname);
  const basePath = path.replace(MCP_SUFFIX, "").replace(API_SUFFIX, "");
  const baseUrl = `${absolute.origin}${basePath}`;
  const mcpUrl = `${baseUrl}/api/mcp`;

  return {
    mcpUrl,
    baseUrl,
    claudeCodeAdd: `claude mcp add --transport http kaneo ${mcpUrl}`,
    claudeCodeAllowedTools: `claude --allowedTools "mcp__kaneo__*"`,
    codexAdd: `codex mcp add kaneo --url ${mcpUrl}`,
    codexLogin: "codex mcp login kaneo",
    codexConfigToml: `[mcp_servers.kaneo]\nurl = "${mcpUrl}"`,
    cursorJson: JSON.stringify(
      { mcpServers: { kaneo: { url: mcpUrl } } },
      null,
      2,
    ),
    stdioInstall: `npx -y @kaneo/mcp install --api-url ${baseUrl}`,
  };
}
