import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kaneo/libs", () => ({
  windowId: "test-window-id",
}));

import { getWsUrl, useProjectWebSocket } from "./use-project-websocket";

const invalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } } }) },
}));

it("refreshes resource links when another client updates a task", () => {
  const sockets: FakeWebSocket[] = [];
  class FakeWebSocket {
    onmessage: ((event: { data: string }) => void) | null = null;
    close = vi.fn();
    constructor() {
      sockets.push(this);
    }
  }
  vi.stubGlobal("WebSocket", FakeWebSocket);
  try {
    renderHook(() => useProjectWebSocket("project-1"));
    sockets[0].onmessage?.({
      data: JSON.stringify({
        type: "TASK_UPDATED",
        projectId: "project-1",
        taskId: "task-1",
      }),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["external-links", "task-1"],
    });
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
});

function stubSocket() {
  const sockets: FakeWebSocket[] = [];
  class FakeWebSocket {
    onmessage: ((event: { data: string }) => void) | null = null;
    close = vi.fn();
    constructor() {
      sockets.push(this);
    }
  }
  vi.stubGlobal("WebSocket", FakeWebSocket);
  return sockets;
}

it("refreshes the project's columns and the enforced flag on PROJECT_UPDATED", () => {
  const sockets = stubSocket();
  invalidateQueries.mockClear();
  try {
    renderHook(() => useProjectWebSocket("project-1"));
    sockets[0].onmessage?.({
      data: JSON.stringify({ type: "PROJECT_UPDATED", projectId: "project-1" }),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["columns", "project-1"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["workspace-columns"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["tasks", "project-1"],
    });
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
});

it("refreshes the Jira state and the activity of a task another client changed", () => {
  const sockets = stubSocket();
  invalidateQueries.mockClear();
  try {
    renderHook(() => useProjectWebSocket("project-1"));
    sockets[0].onmessage?.({
      data: JSON.stringify({
        type: "TASK_UPDATED",
        projectId: "project-1",
        taskId: "task-7",
      }),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["jira-task", "task-7"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["activities", "task-7"],
    });

    invalidateQueries.mockClear();
    sockets[0].onmessage?.({
      data: JSON.stringify({ type: "TASK_CREATED", projectId: "project-1" }),
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ["jira-task", undefined],
    });
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
});

describe("getWsUrl", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://localhost:1337");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds a ws:// URL from an http API base", () => {
    expect(getWsUrl("project-123")).toBe(
      "ws://localhost:1337/api/ws/project-123?windowId=test-window-id",
    );
  });

  it("builds a wss:// URL from an https API base", () => {
    vi.stubEnv("VITE_API_URL", "https://example.com");
    expect(getWsUrl("project-123")).toBe(
      "wss://example.com/api/ws/project-123?windowId=test-window-id",
    );
  });

  it("does not append /api when the base already ends with /api", () => {
    vi.stubEnv("VITE_API_URL", "https://example.com/api");
    expect(getWsUrl("p1")).toBe(
      "wss://example.com/api/ws/p1?windowId=test-window-id",
    );
  });

  it("trims trailing slashes from the API base", () => {
    vi.stubEnv("VITE_API_URL", "http://localhost:1337///");
    expect(getWsUrl("p1")).toBe(
      "ws://localhost:1337/api/ws/p1?windowId=test-window-id",
    );
  });

  it("URL-encodes the projectId", () => {
    expect(getWsUrl("a b/c?d")).toBe(
      "ws://localhost:1337/api/ws/a%20b%2Fc%3Fd?windowId=test-window-id",
    );
  });
});
