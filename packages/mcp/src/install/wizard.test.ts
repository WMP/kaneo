import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { promptsMock } = vi.hoisted(() => ({ promptsMock: vi.fn() }));
vi.mock("prompts", () => ({ default: promptsMock }));

import {
  promptConfirmOverwrite,
  promptCustomConfigPath,
  promptTargetSelect,
} from "./wizard.js";

class ExitSignal extends Error {}

beforeEach(() => {
  promptsMock.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((() => {
    throw new ExitSignal("exit");
  }) as never);
});
afterEach(() => vi.restoreAllMocks());

describe("promptTargetSelect", () => {
  it("offers every install target and returns the selection", async () => {
    promptsMock.mockResolvedValue({ targets: ["cursor-user", "custom"] });
    await expect(promptTargetSelect()).resolves.toEqual([
      "cursor-user",
      "custom",
    ]);
    const question = promptsMock.mock.calls[0]?.[0];
    expect(question.type).toBe("multiselect");
    expect(question.min).toBe(1);
    expect(question.choices.map((c: { value: string }) => c.value)).toEqual([
      "cursor-user",
      "cursor-project",
      "claude-desktop",
      "custom",
    ]);
  });

  it.each([[{}], [{ targets: [] }], [{ targets: "cursor-user" }]])(
    "cancels with exit code 0 for an empty answer %j",
    async (answer) => {
      promptsMock.mockResolvedValue(answer);
      await expect(promptTargetSelect()).rejects.toBeInstanceOf(ExitSignal);
      expect(process.exit).toHaveBeenCalledWith(0);
      expect(console.log).toHaveBeenCalledWith("\nCancelled.");
    },
  );

  it("exits cleanly when prompts reports a cancel", async () => {
    promptsMock.mockImplementation(
      async (_q: unknown, opts: { onCancel: () => void }) => {
        opts.onCancel();
      },
    );
    await expect(promptTargetSelect()).rejects.toBeInstanceOf(ExitSignal);
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});

describe("promptCustomConfigPath", () => {
  it("returns the trimmed path and validates input", async () => {
    promptsMock.mockResolvedValue({ path: "  /a/b.json " });
    await expect(promptCustomConfigPath()).resolves.toBe("/a/b.json");
    const validate = promptsMock.mock.calls[0]?.[0].validate as (
      v: unknown,
    ) => unknown;
    expect(validate("/a/b.json")).toBe(true);
    expect(validate("rel.json")).toBe("Path must be absolute");
    expect(validate("/a/b.txt")).toBe("Path must end with .json");
    expect(validate("")).toBe("Path is required");
    expect(validate(42)).toBe("Path is required");
  });

  it("cancels when no path is given", async () => {
    promptsMock.mockResolvedValue({});
    await expect(promptCustomConfigPath()).rejects.toBeInstanceOf(ExitSignal);
  });
});

describe("promptConfirmOverwrite", () => {
  it("mentions the server and file and returns the answer", async () => {
    promptsMock.mockResolvedValueOnce({ overwrite: true });
    await expect(promptConfirmOverwrite("kaneo", "/x/mcp.json")).resolves.toBe(
      true,
    );
    const question = promptsMock.mock.calls[0]?.[0];
    expect(question.message).toBe(
      'MCP server "kaneo" is already in this file (/x/mcp.json). Overwrite it?',
    );
    expect(question.initial).toBe(false);

    promptsMock.mockResolvedValueOnce({ overwrite: false });
    await expect(promptConfirmOverwrite("kaneo", "/x/mcp.json")).resolves.toBe(
      false,
    );
  });

  it("cancels when no answer is given", async () => {
    promptsMock.mockResolvedValue({});
    await expect(promptConfirmOverwrite("k", "/f")).rejects.toBeInstanceOf(
      ExitSignal,
    );
  });
});
