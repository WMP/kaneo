import { registerTools, type ToolRegistrar } from "@kaneo/mcp/tools";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

export type McpToolRegistrar = ToolRegistrar;

type ShapeToolServer = {
  registerTool(
    name: string,
    config: { description: string; inputSchema: z.ZodRawShape },
    callback: (args: unknown) => Promise<CallToolResult>,
  ): unknown;
};

export function toMcpToolRegistrar(server: ShapeToolServer): McpToolRegistrar {
  return {
    registerTool: (name, config, callback) =>
      server.registerTool(
        name,
        {
          description: config.description,
          // Hand the SDK the FULL, strict object schema rather than its raw
          // shape. Given a raw shape the SDK rebuilds a NON-strict object and
          // silently strips unknown keys before the callback runs, so a client
          // sending an unsupported/misspelled field would get a false success
          // (the field is quietly dropped, not rejected). The strict schema
          // makes the SDK reject unknown keys up front and advertise
          // additionalProperties:false in the tool's JSON schema. Cast because
          // the SDK's TS type asks for a raw shape though at runtime it accepts
          // a full schema (its normalizeObjectSchema returns an object schema
          // as-is and validates against it).
          inputSchema: config.inputSchema.strict() as unknown as z.ZodRawShape,
        },
        (args) => callback(args),
      ),
  };
}

class ApiClient {
  readonly usingApiKey = false;
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  async json<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    if (init?.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, {
      ...init,
      headers,
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    });

    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!res.ok) {
      const detail =
        typeof body === "object" && body !== null && "message" in body
          ? (body as { message: string }).message
          : typeof body === "string" && body.length > 0
            ? body.slice(0, 500)
            : `HTTP ${res.status}`;
      throw new Error(`${path}: ${detail}`);
    }
    return body as T;
  }
}

export function registerMcpTools(
  server: McpToolRegistrar,
  baseUrl: string,
  token: string,
): void {
  registerTools(server, { client: new ApiClient(baseUrl, token) });
}
