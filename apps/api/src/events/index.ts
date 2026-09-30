import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";

const EVENTS = new EventEmitter();
EVENTS.setMaxListeners(100);
export type EventContextStore = {
  initiatorId: string;
  // How the request was authenticated (see utils/auth-source.ts). Null or
  // absent for the web UI; used to label activity rows.
  actorVia?: "mcp" | "api" | null;
  actorTokenHint?: string | null;
};

export const eventContext = new AsyncLocalStorage<EventContextStore>();

export type EventPayload<T = unknown> = {
  type: string;
  data: T;
  timestamp: string;
};

export async function shutdownEventBus(): Promise<void> {
  EVENTS.removeAllListeners();
}

export async function publishEvent(
  eventType: string,
  data: unknown,
  options?: { waitForHandlers?: boolean },
): Promise<void> {
  let enhancedData = null;
  if (typeof data === "object" && data !== null) {
    const store = eventContext.getStore();
    enhancedData = { ...data, initiatorId: store?.initiatorId };
  }

  const payload: EventPayload = {
    type: eventType,
    data: enhancedData || data,
    timestamp: new Date().toISOString(),
  };

  try {
    if (options?.waitForHandlers) {
      // EventEmitter.emit discards promises. Bounded producers must await the
      // actual subscriber wrappers before starting their next item.
      for (const listener of EVENTS.listeners(eventType))
        await listener(payload);
    } else {
      EVENTS.emit(eventType, payload);
    }
  } catch (error) {
    console.error("Failed to publish event:", error);
    throw error;
  }
}

// Handlers that are running. `EventEmitter.emit` discards the promises of async
// listeners, so a publisher (or a test) cannot tell when the reactions to an
// event (activity rows, notifications, integrations) have finished writing.
const IN_FLIGHT_HANDLERS = new Set<Promise<void>>();

// Resolves once no event handler is running, including handlers started by
// other handlers meanwhile. For tests and shutdown: the integration harness
// waits for it before truncating tables, otherwise a handler of the previous
// test still writing takes locks that deadlock the TRUNCATE (`40P01`).
export async function waitForPendingEventHandlers(): Promise<void> {
  while (IN_FLIGHT_HANDLERS.size > 0) {
    await Promise.allSettled([...IN_FLIGHT_HANDLERS]);
  }
}

export async function subscribeToEvent<T>(
  eventType: string,
  handler: (data: T) => Promise<void>,
): Promise<void> {
  try {
    EVENTS.on(eventType, (payload: EventPayload<T>) => {
      const running = (async () => {
        try {
          await handler(payload.data);
        } catch (error) {
          console.error(`Error processing event ${eventType}:`, error);
        }
      })();
      IN_FLIGHT_HANDLERS.add(running);
      void running.finally(() => IN_FLIGHT_HANDLERS.delete(running));
      // `publishEvent` with `waitForHandlers` awaits what the listener returns.
      return running;
    });
  } catch (error) {
    console.error("Failed to subscribe to event:", error);
    throw error;
  }
}

process.on("SIGTERM", () => {
  shutdownEventBus().catch(console.error);
});
