import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wizard = vi.hoisted(() => ({
  promptTargetSelect: vi.fn(),
  promptCustomConfigPath: vi.fn(),
  promptConfirmOverwrite: vi.fn(),
}));
vi.mock("./wizard.js", () => wizard);

import { runInstall } from "./index.js";

let dir = "";
let logs: string[] = [];
let errors: string[] = [];
let savedHome: string | undefined;
const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

const setTty = (value: boolean) => {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "kaneo-mcp-install-"));
  savedHome = process.env.HOME;
  process.env.HOME = dir;
  logs = [];
  errors = [];
  process.exitCode = undefined;
  setTty(false);
  for (const fn of Object.values(wizard)) fn.mockReset();
  vi.spyOn(console, "log").mockImplementation((...a) => {
    logs.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a) => {
    errors.push(a.join(" "));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;
  if (stdoutTty) Object.defineProperty(process.stdout, "isTTY", stdoutTty);
  else delete (process.stdout as { isTTY?: boolean }).isTTY;
  await rm(dir, { recursive: true, force: true });
});

const readJson = async (file: string) =>
  JSON.parse(await readFile(file, "utf8")) as {
    mcpServers: Record<
      string,
      { command: string; args: string[]; env?: Record<string, string> }
    >;
    [k: string]: unknown;
  };

describe("runInstall argument handling", () => {
  it("prints help and writes nothing", async () => {
    await runInstall(["--help"]);
    expect(logs.join("\n")).toContain("kaneo-mcp install: register Kaneo");
    expect(process.exitCode).toBeUndefined();
  });

  it("reports parse errors with help and exit code 1", async () => {
    await runInstall(["--bogus"]);
    expect(errors).toEqual(["Unknown option: --bogus"]);
    expect(logs.join("\n")).toContain("Usage:");
    expect(process.exitCode).toBe(1);
  });

  it("rejects an unknown target", async () => {
    await runInstall(["--target", "vscode", "-y"]);
    expect(errors[0]).toBe(
      "Invalid --target. Use one of: cursor-user, cursor-project, claude-desktop, custom",
    );
    expect(process.exitCode).toBe(1);
  });

  it("rejects a blank name", async () => {
    await runInstall(["--target", "cursor-user", "--name", "  ", "-y"]);
    expect(errors).toEqual(["--name must be a non-empty string."]);
    expect(process.exitCode).toBe(1);
  });

  it("requires --target in non-interactive mode", async () => {
    await runInstall(["-y"]);
    expect(errors[0]).toContain("Non-interactive mode: specify --target");
    expect(process.exitCode).toBe(1);
    expect(wizard.promptTargetSelect).not.toHaveBeenCalled();
  });

  it("requires --output for the custom target when not interactive", async () => {
    await runInstall(["--target", "custom", "-y"]);
    expect(errors).toEqual(["Custom target requires --output <path>"]);
    expect(process.exitCode).toBe(1);
  });

  it.each([
    ["relative.json", "Invalid --output: Path must be absolute"],
    ["/tmp/x.txt", "Invalid --output: Path must end with .json"],
  ])("validates --output %s", async (output, message) => {
    await runInstall(["--target", "custom", "--output", output, "-y"]);
    expect(errors).toEqual([message]);
    expect(process.exitCode).toBe(1);
  });
});

describe("runInstall writing", () => {
  it("writes the server entry for cursor-user under HOME with private permissions", async () => {
    await runInstall(["--target", "cursor-user", "-y"]);
    const file = path.join(dir, ".cursor", "mcp.json");
    const config = await readJson(file);
    expect(config.mcpServers.kaneo?.command).toBe(process.execPath);
    expect(config.mcpServers.kaneo?.args).toHaveLength(1);
    expect(config.mcpServers.kaneo?.args[0]).toMatch(/index\.js$/);
    expect(config.mcpServers.kaneo).not.toHaveProperty("env");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(logs).toContain('Wrote MCP server "kaneo" to:');
    expect(logs).toContain(`  ${file}`);
    expect(process.exitCode).toBeUndefined();
  });

  it("writes cursor-project config in --project-dir with the API URL and custom name", async () => {
    const project = path.join(dir, "proj");
    await runInstall([
      "--target",
      "cursor-project",
      "--project-dir",
      project,
      "--name",
      "my-kaneo",
      "--api-url",
      "https://kaneo.example.com",
      "-y",
    ]);
    const config = await readJson(path.join(project, ".cursor", "mcp.json"));
    expect(config.mcpServers["my-kaneo"]?.env).toEqual({
      KANEO_API_URL: "https://kaneo.example.com",
    });
  });

  it("ignores an empty --api-url", async () => {
    await runInstall(["--target", "cursor-user", "--api-url=", "-y"]);
    const config = await readJson(path.join(dir, ".cursor", "mcp.json"));
    expect(config.mcpServers.kaneo).not.toHaveProperty("env");
  });

  it("preserves other servers and top-level keys when merging", async () => {
    const file = path.join(dir, "custom", "mcp.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        theme: "dark",
        mcpServers: { other: { command: "x", args: [] } },
      }),
    );
    await runInstall(["--target", "custom", "--output", ` ${file} `, "-y"]);
    const config = await readJson(file);
    expect(config.theme).toBe("dark");
    expect(config.mcpServers.other).toEqual({ command: "x", args: [] });
    expect(config.mcpServers.kaneo).toBeDefined();
  });

  it("refuses to overwrite an existing entry without -y when not interactive", async () => {
    const file = path.join(dir, "mcp.json");
    await writeFile(
      file,
      JSON.stringify({ mcpServers: { kaneo: { command: "old", args: [] } } }),
    );
    await runInstall(["--target", "custom", "--output", file]);
    expect(errors).toEqual([
      'Entry "kaneo" already exists. Pass -y to overwrite.',
    ]);
    expect(process.exitCode).toBe(1);
    expect((await readJson(file)).mcpServers.kaneo?.command).toBe("old");
  });

  it("overwrites an existing entry with -y", async () => {
    const file = path.join(dir, "mcp.json");
    await writeFile(
      file,
      JSON.stringify({ mcpServers: { kaneo: { command: "old", args: [] } } }),
    );
    await runInstall(["--target", "custom", "--output", file, "-y"]);
    expect((await readJson(file)).mcpServers.kaneo?.command).toBe(
      process.execPath,
    );
  });

  it.each([
    [
      "not JSON",
      "{oops",
      /Cannot update config at .*: Existing MCP config is not valid JSON\./,
    ],
    [
      "an array",
      "[]",
      /Cannot update config at .*: Existing MCP config must be a JSON object/,
    ],
  ])("does not modify a config that is %s", async (_n, content, pattern) => {
    const file = path.join(dir, "bad.json");
    await writeFile(file, content);
    await runInstall(["--target", "custom", "--output", file, "-y"]);
    expect(errors[0]).toMatch(pattern);
    expect(process.exitCode).toBe(1);
    expect(await readFile(file, "utf8")).toBe(content);
  });

  it("refuses reserved server names without writing", async () => {
    const file = path.join(dir, "mcp.json");
    await runInstall([
      "--target",
      "custom",
      "--output",
      file,
      "--name",
      "__proto__",
      "-y",
    ]);
    expect(errors[0]).toContain('Refusing MCP server name "__proto__"');
    expect(process.exitCode).toBe(1);
    await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not write any target when one of several configs is invalid", async () => {
    // cursor-user is valid, cursor-project (via project-dir) is broken
    const project = path.join(dir, "proj");
    await mkdir(path.join(project, ".cursor"), { recursive: true });
    await writeFile(path.join(project, ".cursor", "mcp.json"), "{bad");
    setTty(true);
    wizard.promptTargetSelect.mockResolvedValue([
      "cursor-user",
      "cursor-project",
    ]);
    await runInstall(["--project-dir", project]);
    expect(process.exitCode).toBe(1);
    await expect(
      stat(path.join(dir, ".cursor", "mcp.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rethrows read errors other than ENOENT", async () => {
    // A directory at the config path makes readFile fail with EISDIR.
    const file = path.join(dir, "isdir.json");
    await mkdir(file);
    await expect(
      runInstall(["--target", "custom", "--output", file, "-y"]),
    ).rejects.toMatchObject({ code: "EISDIR" });
  });
});

describe("runInstall interactive mode", () => {
  beforeEach(() => setTty(true));

  it("asks for targets when none is given and a TTY is attached", async () => {
    wizard.promptTargetSelect.mockResolvedValue(["cursor-user"]);
    await runInstall([]);
    expect(wizard.promptTargetSelect).toHaveBeenCalledTimes(1);
    expect(
      (await readJson(path.join(dir, ".cursor", "mcp.json"))).mcpServers.kaneo,
    ).toBeDefined();
  });

  it("prompts for the custom path when --output is missing", async () => {
    const file = path.join(dir, "prompted.json");
    wizard.promptTargetSelect.mockResolvedValue(["custom"]);
    wizard.promptCustomConfigPath.mockResolvedValue(file);
    await runInstall([]);
    expect((await readJson(file)).mcpServers.kaneo).toBeDefined();
  });

  it("skips a target when the user declines to overwrite", async () => {
    const file = path.join(dir, "mcp.json");
    await writeFile(
      file,
      JSON.stringify({ mcpServers: { kaneo: { command: "old", args: [] } } }),
    );
    wizard.promptConfirmOverwrite.mockResolvedValue(false);
    await runInstall(["--target", "custom", "--output", file]);
    expect(wizard.promptConfirmOverwrite).toHaveBeenCalledWith("kaneo", file);
    expect(logs).toContain(`Skipped:\n  ${file}`);
    expect(logs).toContain("No config files were updated.");
    expect((await readJson(file)).mcpServers.kaneo?.command).toBe("old");
  });

  it("overwrites when the user confirms", async () => {
    const file = path.join(dir, "mcp.json");
    await writeFile(
      file,
      JSON.stringify({ mcpServers: { kaneo: { command: "old", args: [] } } }),
    );
    wizard.promptConfirmOverwrite.mockResolvedValue(true);
    await runInstall(["--target", "custom", "--output", file]);
    expect((await readJson(file)).mcpServers.kaneo?.command).toBe(
      process.execPath,
    );
  });
});

describe("runInstall with unusual existing configs", () => {
  it.each([
    ["mcpServers is an array", '{"mcpServers":[]}'],
    ["mcpServers is missing", "{}"],
    ["the file is an empty object", "{}\n"],
  ])(
    "does not treat a file where %s as an existing entry",
    async (_n, content) => {
      const file = path.join(dir, "mcp.json");
      await writeFile(file, content);
      await runInstall(["--target", "custom", "--output", file]);
      expect(process.exitCode).toBeUndefined();
      expect((await readJson(file)).mcpServers.kaneo?.command).toBe(
        process.execPath,
      );
    },
  );
});
