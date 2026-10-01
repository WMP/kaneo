import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Delivery re-reads the project's workspace: answer it without a database.
vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ workspaceId: "workspace" }],
        }),
      }),
    }),
  },
}));

// Mock events to prevent side effects from ws/index.ts top-level subscriptions
vi.mock("../../../apps/api/src/events", () => ({
  subscribeToEvent: vi.fn(),
  publishEvent: vi.fn(),
}));

import { subscribeToEvent } from "../../../apps/api/src/events";
import {
  addConnection,
  initializeWebSocketAdapter,
  removeConnection,
  shutdownWebSocketAdapter,
} from "../../../apps/api/src/ws/index";

const JIRA_EVENTS = [
  "jira.issue_linked",
  "jira.issue_unlinked",
  "jira.status_changed",
  "jira.status_proposal_created",
  "jira.status_proposal_resolved",
];

// Captured at import: the subscriptions are made when ws/index.ts loads.
const handlers = new Map(
  vi
    .mocked(subscribeToEvent)
    .mock.calls.map(([name, handler]: [string, unknown]) => [name, handler]),
);

function handlerFor(eventName: string) {
  return handlers.get(eventName) as
    | ((data: unknown) => Promise<void>)
    | undefined;
}

describe("Jira events reach the project's clients", () => {
  beforeEach(async () => {
    delete process.env.REDIS_URL;
    await initializeWebSocketAdapter();
  });

  afterEach(async () => {
    await shutdownWebSocketAdapter();
  });

  it.each(JIRA_EVENTS)(
    "%s refreshes the task with TASK_UPDATED",
    async (eventName) => {
      const handler = handlerFor(eventName);
      expect(handler).toBeTypeOf("function");

      const ws = {
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1,
        raw: undefined,
        url: null,
        protocol: null,
      } as never;
      const connection = addConnection(
        "proj-1",
        ws,
        "user-1",
        "init-1",
        "workspace",
      );

      await handler?.({
        taskId: "task-1",
        projectId: "proj-1",
        userId: null,
        issueKey: "PRJ-1",
      });

      await vi.waitFor(
        () => {
          expect(
            (ws as { send: ReturnType<typeof vi.fn> }).send,
          ).toHaveBeenCalled();
        },
        { timeout: 500 },
      );
      const sent = JSON.parse(
        (ws as { send: ReturnType<typeof vi.fn> }).send.mock.calls[0][0],
      );
      expect(sent).toMatchObject({
        type: "TASK_UPDATED",
        projectId: "proj-1",
        taskId: "task-1",
      });
      // Only ids travel to the client: nothing of the event payload beyond that.
      expect(JSON.stringify(sent)).not.toContain("PRJ-1");

      removeConnection("proj-1", connection);
    },
  );
});
