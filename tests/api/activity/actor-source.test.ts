import { afterEach, describe, expect, it } from "vitest";
import { currentActorSource } from "../../../apps/api/src/activity/actor-source";
import {
  eventContext,
  publishEvent,
  shutdownEventBus,
  subscribeToEvent,
  waitForPendingEventHandlers,
} from "../../../apps/api/src/events/index";

afterEach(async () => {
  await waitForPendingEventHandlers();
  await shutdownEventBus();
});

describe("currentActorSource", () => {
  it("is empty outside a request (webhooks, imports, jobs)", () => {
    expect(currentActorSource()).toEqual({
      actorVia: null,
      actorTokenHint: null,
    });
  });

  it("is empty for the web UI", () => {
    const source = eventContext.run({ initiatorId: "u1" }, currentActorSource);
    expect(source).toEqual({ actorVia: null, actorTokenHint: null });
  });

  it("returns the source of the current request", () => {
    expect(
      eventContext.run(
        { initiatorId: "u1", actorVia: "mcp", actorTokenHint: "…a1b2" },
        currentActorSource,
      ),
    ).toEqual({ actorVia: "mcp", actorTokenHint: "…a1b2" });
    expect(
      eventContext.run(
        { initiatorId: "u1", actorVia: "api", actorTokenHint: "kaneo_ab…" },
        currentActorSource,
      ),
    ).toEqual({ actorVia: "api", actorTokenHint: "kaneo_ab…" });
  });

  it("drops a hint that has no source", () => {
    expect(
      eventContext.run(
        { initiatorId: "u1", actorVia: null, actorTokenHint: "…zzzz" },
        currentActorSource,
      ),
    ).toEqual({ actorVia: null, actorTokenHint: null });
  });

  it.each([false, true])(
    "reaches event handlers started by publishEvent (waitForHandlers=%s)",
    async (waitForHandlers) => {
      const seen: unknown[] = [];
      await subscribeToEvent("test.actor-source", async () => {
        // The handler awaits before reading, like a handler that queries first.
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push(currentActorSource());
      });

      await eventContext.run(
        { initiatorId: "u1", actorVia: "api", actorTokenHint: "kaneo_ab…" },
        () => publishEvent("test.actor-source", {}, { waitForHandlers }),
      );
      await waitForPendingEventHandlers();

      expect(seen).toEqual([{ actorVia: "api", actorTokenHint: "kaneo_ab…" }]);
    },
  );

  it("keeps concurrent requests apart", async () => {
    const read = async (actorVia: "mcp" | "api", hint: string) =>
      eventContext.run(
        { initiatorId: actorVia, actorVia, actorTokenHint: hint },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return currentActorSource();
        },
      );
    const [a, b] = await Promise.all([read("mcp", "…1111"), read("api", "k…")]);
    expect(a).toEqual({ actorVia: "mcp", actorTokenHint: "…1111" });
    expect(b).toEqual({ actorVia: "api", actorTokenHint: "k…" });
  });
});
