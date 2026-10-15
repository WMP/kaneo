import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runInstall: vi.fn(),
  connect: vi.fn(),
  createMcpServer: vi.fn(),
  StdioServerTransport: vi.fn(),
}));

vi.mock("./install/index.js", () => ({ runInstall: mocks.runInstall }));
vi.mock("./server.js", () => ({ createMcpServer: mocks.createMcpServer }));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: mocks.StdioServerTransport,
}));

import { runCli } from "./cli.js";

const realArgv = process.argv;
const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
let logs: string[] = [];
let errors: string[] = [];

const argv = (...args: string[]) => {
  process.argv = ["node", "kaneo-mcp", ...args];
};
const setTty = (value: boolean) =>
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });

beforeEach(() => {
  logs = [];
  errors = [];
  process.exitCode = undefined;
  mocks.runInstall.mockReset().mockResolvedValue(undefined);
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.StdioServerTransport.mockReset();
  mocks.createMcpServer.mockReset().mockReturnValue({ connect: mocks.connect });
  setTty(false);
  vi.spyOn(console, "log").mockImplementation((...a) => {
    logs.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a) => {
    errors.push(a.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.argv = realArgv;
  process.exitCode = undefined;
  if (ttyDescriptor)
    Object.defineProperty(process.stdin, "isTTY", ttyDescriptor);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;
});

describe("runCli", () => {
  it.each(["-h", "--help", "help"])(
    "prints the main help for %s",
    async (flag) => {
      argv(flag);
      await runCli();
      expect(logs.join("\n")).toContain(
        "kaneo-mcp: Kaneo MCP server (stdio transport)",
      );
      expect(mocks.runInstall).not.toHaveBeenCalled();
      expect(mocks.createMcpServer).not.toHaveBeenCalled();
    },
  );

  it.each(["install", "setup"])(
    "delegates '%s' with the remaining arguments",
    async (cmd) => {
      argv(cmd, "--target", "cursor-user", "-y");
      await runCli();
      expect(mocks.runInstall).toHaveBeenCalledWith([
        "--target",
        "cursor-user",
        "-y",
      ]);
      expect(mocks.createMcpServer).not.toHaveBeenCalled();
    },
  );

  it.each(["serve", "server", "stdio", "run"])(
    "starts the stdio server for '%s'",
    async (cmd) => {
      argv(cmd);
      await runCli();
      expect(mocks.StdioServerTransport).toHaveBeenCalledTimes(1);
      expect(mocks.connect).toHaveBeenCalledWith(
        mocks.StdioServerTransport.mock.instances[0],
      );
      expect(mocks.runInstall).not.toHaveBeenCalled();
    },
  );

  it("rejects unknown commands with help and exit code 1", async () => {
    argv("bogus");
    await runCli();
    expect(errors).toEqual(["Unknown command: bogus"]);
    expect(logs.join("\n")).toContain("Usage:");
    expect(process.exitCode).toBe(1);
    expect(mocks.createMcpServer).not.toHaveBeenCalled();
  });

  it("starts the interactive installer without arguments in a terminal", async () => {
    argv();
    setTty(true);
    await runCli();
    expect(mocks.runInstall).toHaveBeenCalledWith([]);
    expect(mocks.createMcpServer).not.toHaveBeenCalled();
  });

  it("serves MCP without arguments when stdin is piped", async () => {
    argv();
    setTty(false);
    await runCli();
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.runInstall).not.toHaveBeenCalled();
  });

  it("propagates a failure to connect", async () => {
    argv("serve");
    mocks.connect.mockRejectedValue(new Error("pipe closed"));
    await expect(runCli()).rejects.toThrow("pipe closed");
  });
});
