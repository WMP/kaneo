import { describe, expect, it } from "vitest";
import { buildMcpConnection } from "./mcp-connection";

const ORIGIN = "https://app.example.com";

describe("buildMcpConnection", () => {
  it("builds the endpoint from an absolute MCP URL", () => {
    const connection = buildMcpConnection("https://kaneo.example.com/api/mcp");

    expect(connection.mcpUrl).toBe("https://kaneo.example.com/api/mcp");
    expect(connection.baseUrl).toBe("https://kaneo.example.com");
  });

  it("accepts a VITE-style base that already ends in /api", () => {
    const connection = buildMcpConnection("https://kaneo.example.com/api");

    expect(connection.mcpUrl).toBe("https://kaneo.example.com/api/mcp");
    expect(connection.baseUrl).toBe("https://kaneo.example.com");
  });

  it("accepts a bare instance URL", () => {
    const connection = buildMcpConnection("http://localhost:1337");

    expect(connection.mcpUrl).toBe("http://localhost:1337/api/mcp");
    expect(connection.baseUrl).toBe("http://localhost:1337");
  });

  it("ignores trailing slashes", () => {
    for (const input of [
      "https://kaneo.example.com/",
      "https://kaneo.example.com/api/",
      "https://kaneo.example.com/api/mcp/",
      "https://kaneo.example.com/api/mcp//",
    ]) {
      const connection = buildMcpConnection(input);

      expect(connection.mcpUrl).toBe("https://kaneo.example.com/api/mcp");
      expect(connection.baseUrl).toBe("https://kaneo.example.com");
    }
  });

  it("keeps a sub-path deployment", () => {
    const connection = buildMcpConnection("https://example.com/kaneo/api/mcp");

    expect(connection.mcpUrl).toBe("https://example.com/kaneo/api/mcp");
    expect(connection.baseUrl).toBe("https://example.com/kaneo");
  });

  it("resolves a relative API URL against the given origin", () => {
    const connection = buildMcpConnection("/api/mcp", ORIGIN);

    expect(connection.mcpUrl).toBe("https://app.example.com/api/mcp");
    expect(connection.baseUrl).toBe(ORIGIN);
  });

  it("drops query strings and fragments", () => {
    expect(
      buildMcpConnection("https://kaneo.example.com/api?x=1#y").mcpUrl,
    ).toBe("https://kaneo.example.com/api/mcp");
  });

  it("renders every client snippet from the same URL", () => {
    const connection = buildMcpConnection("https://kaneo.example.com/api/");

    expect(connection.claudeCodeAdd).toBe(
      "claude mcp add --transport http kaneo https://kaneo.example.com/api/mcp",
    );
    expect(connection.claudeCodeAllowedTools).toBe(
      'claude --allowedTools "mcp__kaneo__*"',
    );
    expect(connection.codexAdd).toBe(
      "codex mcp add kaneo --url https://kaneo.example.com/api/mcp",
    );
    expect(connection.codexLogin).toBe("codex mcp login kaneo");
    expect(connection.codexConfigToml).toBe(
      '[mcp_servers.kaneo]\nurl = "https://kaneo.example.com/api/mcp"',
    );
    expect(JSON.parse(connection.cursorJson)).toEqual({
      mcpServers: { kaneo: { url: "https://kaneo.example.com/api/mcp" } },
    });
    expect(connection.stdioInstall).toBe(
      "npx -y @kaneo/mcp install --api-url https://kaneo.example.com",
    );
  });
});
