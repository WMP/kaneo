import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("auth module start-up without a usable AUTH_SECRET", () => {
  it("prints the reason and exits with status 1 instead of falling back to a default secret", async () => {
    // dotenv never overrides a variable that is already present, so the empty
    // value wins over any .env file.
    vi.stubEnv("AUTH_SECRET", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    vi.resetModules();

    await expect(import("../../apps/api/src/auth")).rejects.toThrow(
      "process.exit called",
    );

    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/AUTH_SECRET is not set/),
    );
    // Loading the whole auth module graph takes a few seconds.
  }, 60_000);
});
