import { homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getClaudeDesktopConfigPath,
  resolveTargetConfigPath,
  validateCustomConfigPathInput,
} from "./targets.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("validateCustomConfigPathInput", () => {
  it("trims and accepts an absolute .json path (case-insensitive extension)", () => {
    expect(validateCustomConfigPathInput("  /a/b/MCP.JSON ")).toEqual({
      ok: true,
      path: "/a/b/MCP.JSON",
    });
  });

  it.each([
    ["", "Path is required"],
    ["   ", "Path is required"],
    ["rel/mcp.json", "Path must be absolute"],
    ["/a/mcp.yaml", "Path must end with .json"],
  ])("rejects %j", (input, message) => {
    expect(validateCustomConfigPathInput(input)).toEqual({
      ok: false,
      message,
    });
  });
});

describe("getClaudeDesktopConfigPath", () => {
  const platform = (value: string) =>
    vi
      .spyOn(process, "platform", "get")
      .mockReturnValue(value as NodeJS.Platform);

  it("uses Application Support on macOS", () => {
    platform("darwin");
    expect(getClaudeDesktopConfigPath()).toBe(
      path.join(
        homedir(),
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      ),
    );
  });

  it("uses APPDATA on Windows and fails without it", () => {
    platform("win32");
    vi.stubEnv("APPDATA", path.join("C:", "Users", "x", "AppData"));
    expect(getClaudeDesktopConfigPath()).toBe(
      path.join(
        "C:",
        "Users",
        "x",
        "AppData",
        "Claude",
        "claude_desktop_config.json",
      ),
    );
    vi.stubEnv("APPDATA", "");
    expect(() => getClaudeDesktopConfigPath()).toThrow(
      "APPDATA is not set; cannot resolve Claude Desktop path",
    );
  });

  it("uses ~/.config on Linux", () => {
    platform("linux");
    expect(getClaudeDesktopConfigPath()).toBe(
      path.join(homedir(), ".config", "Claude", "claude_desktop_config.json"),
    );
  });
});

describe("resolveTargetConfigPath", () => {
  it("resolves each target", () => {
    const cwd = "/work/project";
    expect(resolveTargetConfigPath("cursor-user", { cwd })).toBe(
      path.join(homedir(), ".cursor", "mcp.json"),
    );
    expect(resolveTargetConfigPath("cursor-project", { cwd })).toBe(
      path.join(cwd, ".cursor", "mcp.json"),
    );
    expect(resolveTargetConfigPath("claude-desktop", { cwd })).toBe(
      getClaudeDesktopConfigPath(),
    );
    expect(
      resolveTargetConfigPath("custom", { cwd, customPath: "/x/y.json" }),
    ).toBe("/x/y.json");
  });

  it("throws the validation message for an invalid or missing custom path", () => {
    expect(() => resolveTargetConfigPath("custom", { cwd: "/" })).toThrow(
      "Path is required",
    );
    expect(() =>
      resolveTargetConfigPath("custom", { cwd: "/", customPath: "rel.json" }),
    ).toThrow("Path must be absolute");
  });
});
