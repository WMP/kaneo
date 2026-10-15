import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runCli } = vi.hoisted(() => ({ runCli: vi.fn() }));
vi.mock("./cli.js", () => ({ runCli }));

beforeEach(() => {
  vi.resetModules();
  runCli.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("bin entry", () => {
  it("runs the CLI", async () => {
    runCli.mockResolvedValue(undefined);
    await import("./index.js");
    expect(runCli).toHaveBeenCalledTimes(1);
  });

  it("logs the error and exits with code 1 when the CLI fails", async () => {
    const failure = new Error("boom");
    runCli.mockRejectedValue(failure);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    await import("./index.js");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(error).toHaveBeenCalledWith(failure);
  });
});
