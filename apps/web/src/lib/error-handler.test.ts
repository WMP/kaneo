import { afterEach, describe, expect, it, vi } from "vitest";
import { useConnectivityStore } from "@/store/connectivity";
import { parseApiError } from "./error-handler";
import { HttpError } from "./http-error";

function setConnectivity(state: {
  browserOffline?: boolean;
  hasReachedServer?: boolean;
}) {
  useConnectivityStore.setState({
    browserOffline: state.browserOffline ?? false,
    serverUnreachable: false,
    hasReachedServer: state.hasReachedServer ?? false,
  });
}

afterEach(() => {
  setConnectivity({});
  vi.restoreAllMocks();
});

describe("parseApiError", () => {
  it("returns a generic message key for unknown Error instances instead of leaking error.message", () => {
    const internalMessage =
      "Cannot read properties of undefined (reading 'id') at TaskList";
    const result = parseApiError(new Error(internalMessage));

    expect(result.type).toBe("unknown");
    expect(result.message).toBe("common:error.messages.unknown");
    expect(result.message).not.toContain(internalMessage);
    // originalError is preserved so Sentry still sees the real cause.
    expect(result.originalError?.message).toBe(internalMessage);
  });

  it("returns a generic message key for non-Error values", () => {
    const result = parseApiError("something bad happened");
    expect(result.type).toBe("unknown");
    expect(result.message).toBe("common:error.messages.unknown");
  });

  it("still returns a CORS-specific message key for matching errors", () => {
    const result = parseApiError(new Error("Failed to fetch: CORS blocked"));
    expect(result.type).toBe("cors");
    expect(result.message).toBe("common:error.messages.cors");
  });

  it("classifies Safari's 'Load failed' as a network error, not CORS", () => {
    const originalMessage = "TypeError: Load failed";
    const error = new Error(originalMessage);

    const result = parseApiError(error);

    expect(result.type).toBe("network");
    expect(result.message).toBe("common:error.messages.network");
    expect(result.originalError).toBe(error);
    expect(result.originalError?.message).toBe(originalMessage);
  });

  it("classifies an API error by its HTTP status, not by a 'Failed to fetch …' message", () => {
    const result = parseApiError(new HttpError(500, "Failed to fetch tasks"));
    expect(result.type).toBe("server");
    expect(result.message).toBe("common:error.messages.server");
    expect(result.status).toBe(500);
  });

  it("reports a proxy's gateway error as the server being unreachable", () => {
    const result = parseApiError(new HttpError(503, "Service Unavailable"));
    expect(result.type).toBe("network");
    expect(result.message).toBe("common:error.messages.serverUnreachable");
  });

  it("keeps the CORS/setup hint for a first-contact failure (the API never answered this session)", () => {
    setConnectivity({ hasReachedServer: false });
    const result = parseApiError(new TypeError("Failed to fetch"));
    expect(result.type).toBe("cors");
    expect(result.message).toBe("common:error.messages.cors");
  });

  it("reports a lost connection, not CORS, once the API has answered earlier in the session", () => {
    // The reported case: working normally, Wi-Fi drops, then opening a task
    // showed a CORS error although nothing about CORS had changed.
    setConnectivity({ hasReachedServer: true });
    const result = parseApiError(new TypeError("Failed to fetch"));
    expect(result.type).toBe("network");
    expect(result.message).toBe("common:error.messages.serverUnreachable");
  });

  it("reports a network error while the browser is offline", () => {
    setConnectivity({ browserOffline: true, hasReachedServer: false });
    const result = parseApiError(new TypeError("Failed to fetch"));
    expect(result.type).toBe("network");
    expect(result.message).toBe("common:error.messages.network");
  });
});
