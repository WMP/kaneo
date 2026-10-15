import { describe, expect, it } from "vitest";
import { mergeMcpServerEntry } from "./merge-config.js";

const entry = { command: "node", args: ["/app/index.js"] };

describe("mergeMcpServerEntry edge cases", () => {
  it.each(["__proto__", "constructor", "prototype"])(
    "refuses the reserved server name %s",
    (name) => {
      expect(() => mergeMcpServerEntry(null, name, entry)).toThrow(
        `Refusing MCP server name "${name}" (reserved key; use a different --name).`,
      );
    },
  );

  it.each(["[]", "5", "null", '"text"'])(
    "rejects a non-object config (%s)",
    (json) => {
      expect(() => mergeMcpServerEntry(json, "kaneo", entry)).toThrow(
        "Existing MCP config must be a JSON object (not an array or primitive).",
      );
    },
  );

  it("drops reserved keys from existing servers and keeps the rest", () => {
    const existing =
      '{"mcpServers":{"__proto__":{"command":"evil"},"constructor":1,"keep":{"command":"x","args":[]}}}';
    const out = JSON.parse(mergeMcpServerEntry(existing, "kaneo", entry));
    expect(Object.keys(out.mcpServers).sort()).toEqual(["kaneo", "keep"]);
    expect(Object.getPrototypeOf(out.mcpServers)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).command).toBeUndefined();
  });

  it.each(['{"mcpServers":[]}', '{"mcpServers":"x"}', '{"mcpServers":null}'])(
    "replaces a malformed mcpServers value (%s) with a fresh map",
    (json) => {
      const out = JSON.parse(mergeMcpServerEntry(json, "kaneo", entry));
      expect(out).toEqual({ mcpServers: { kaneo: entry } });
    },
  );

  it("replaces an existing entry of the same name and ends with a newline", () => {
    const text = mergeMcpServerEntry(
      '{"mcpServers":{"kaneo":{"command":"old","args":[]}}}',
      "kaneo",
      entry,
    );
    expect(JSON.parse(text).mcpServers.kaneo).toEqual(entry);
    expect(text.endsWith("}\n")).toBe(true);
  });
});
