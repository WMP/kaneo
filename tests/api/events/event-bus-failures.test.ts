import { afterEach, describe, expect, it, vi } from "vitest";
import {
  publishEvent,
  subscribeToEvent,
} from "../../../apps/api/src/events/index";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("event bus failure paths", () => {
  it("logs and rethrows when the event bus itself fails to emit", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    // An "error" event without an "error" listener makes Node's emitter throw.
    await expect(publishEvent("error", { reason: "boom" })).rejects.toThrow();

    expect(error).toHaveBeenCalledWith(
      "Failed to publish event:",
      expect.any(Error),
    );
  });

  it("answers SIGTERM by dropping every subscriber", async () => {
    const handler = vi.fn(async () => {});
    await subscribeToEvent("test.sigterm.drop", handler);
    await publishEvent(
      "test.sigterm.drop",
      { n: 1 },
      { waitForHandlers: true },
    );
    expect(handler).toHaveBeenCalledTimes(1);

    process.emit("SIGTERM");
    await vi.waitFor(async () => {
      await publishEvent(
        "test.sigterm.drop",
        { n: 2 },
        { waitForHandlers: true },
      );
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
