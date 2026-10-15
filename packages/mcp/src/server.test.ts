import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpServer } from "./server.js";

const realFetch = globalThis.fetch;
const envKeys = [
  "KANEO_API_URL",
  "KANEO_MCP_CLIENT_ID",
  "KANEO_API_KEY",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of envKeys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of envKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

async function connect() {
  const server = createMcpServer();
  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { server, client };
}

describe("createMcpServer", () => {
  it("identifies itself with the package version", async () => {
    const { client } = await connect();
    const pkg = JSON.parse(
      await readFile(join(import.meta.dirname, "../package.json"), "utf8"),
    ) as { version: string };
    expect(client.getServerVersion()).toMatchObject({
      name: "kaneo-mcp",
      version: pkg.version,
    });
  });

  it("registers the Kaneo tools", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names.length).toBeGreaterThan(10);
    expect(names).toContain("list_projects");
  });

  it("calls the configured API URL (without /api suffix) with the API key as bearer", async () => {
    process.env.KANEO_API_URL = "https://kaneo.example.com/api/";
    process.env.KANEO_API_KEY = "kaneo_key";
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]"));
    globalThis.fetch = fetchMock as typeof fetch;
    const { client } = await connect();
    await client.callTool({
      name: "list_projects",
      arguments: { workspaceId: "w1" },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith("https://kaneo.example.com/api/")).toBe(true);
    expect(url).not.toContain("/api/api/");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer kaneo_key",
    );
  });

  it("defaults to http://localhost:1337", async () => {
    process.env.KANEO_API_KEY = "k";
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]"));
    globalThis.fetch = fetchMock as typeof fetch;
    const { client } = await connect();
    await client.callTool({
      name: "list_projects",
      arguments: { workspaceId: "w1" },
    });
    expect((fetchMock.mock.calls[0] as [string])[0]).toMatch(
      /^http:\/\/localhost:1337\/api\//,
    );
  });
});
