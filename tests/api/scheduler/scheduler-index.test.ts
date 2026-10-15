import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobs = vi.hoisted(() => ({
  dueDate: vi.fn(async (): Promise<unknown> => undefined),
  webhook: vi.fn(async (): Promise<unknown> => undefined),
  jira: vi.fn(async (): Promise<unknown> => undefined),
  seats: vi.fn(async (): Promise<unknown> => undefined),
  trial: vi.fn(async (): Promise<unknown> => undefined),
  retention: vi.fn(async (): Promise<unknown> => undefined),
}));

const sentry = vi.hoisted(() => ({
  captureCheckIn: vi.fn((_checkIn: unknown) => "check-in-1"),
  captureException: vi.fn(),
}));

// The package is installed under apps/api only (not resolvable from tests/),
// so mock the ES module entry that the scheduler imports.
vi.mock(
  "../../../apps/api/node_modules/@sentry/node/build/esm/index.js",
  () => sentry,
);
vi.mock("../../../apps/api/src/scheduler/due-date-reminders", () => ({
  checkDueDateReminders: jobs.dueDate,
}));
vi.mock("../../../apps/api/src/scheduler/project-webhook-reminders", () => ({
  checkProjectWebhookReminders: jobs.webhook,
}));
vi.mock("../../../apps/api/src/scheduler/jira-status-poll", () => ({
  pollJiraStatuses: jobs.jira,
}));
vi.mock("../../../apps/api/src/scheduler/seat-reconciliation", () => ({
  reconcileWorkspaceSeats: jobs.seats,
}));
vi.mock("../../../apps/api/src/scheduler/trial-reminders", () => ({
  checkTrialReminders: jobs.trial,
}));
vi.mock("../../../apps/api/src/scheduler/activity-retention", () => ({
  enforceActivityRetention: jobs.retention,
}));

import {
  initializeScheduler,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler";

const MINUTE = 60_000;

// Local-time construction keeps the cron patterns ("42 3 * * *") independent
// of the time zone the tests run in.
function startAt(hour: number, minute: number) {
  vi.setSystemTime(new Date(2026, 9, 15, hour, minute, 0, 0));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const fn of Object.values(jobs)) fn.mockClear();
  sentry.captureCheckIn.mockClear();
  sentry.captureException.mockClear();
});

afterEach(() => {
  shutdownScheduler();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("scheduler job registration", () => {
  it("runs the 5-minute, hourly and daily jobs on their schedules", async () => {
    startAt(3, 0);
    initializeScheduler();

    // 03:05 .. 03:55 is eleven 5-minute ticks; 03:17 and 03:23 are the
    // hourly jobs; the daily job (03:42) has not been reached yet.
    await vi.advanceTimersByTimeAsync(41 * MINUTE);
    expect(jobs.dueDate).toHaveBeenCalledTimes(8);
    expect(jobs.webhook).toHaveBeenCalledTimes(8);
    expect(jobs.jira).toHaveBeenCalledTimes(8);
    expect(jobs.seats).toHaveBeenCalledTimes(1);
    expect(jobs.trial).toHaveBeenCalledTimes(1);
    expect(jobs.retention).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1 * MINUTE);
    expect(jobs.retention).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(18 * MINUTE);
    // the 04:00 tick is the 12th five-minute tick; seats and trial do not repeat
    // before 04:17 and 04:23.
    expect(jobs.dueDate).toHaveBeenCalledTimes(12);
    expect(jobs.seats).toHaveBeenCalledTimes(1);
    expect(jobs.trial).toHaveBeenCalledTimes(1);
    expect(jobs.retention).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(23 * MINUTE);
    expect(jobs.seats).toHaveBeenCalledTimes(2);
    expect(jobs.trial).toHaveBeenCalledTimes(2);
  });

  it("stops every job on shutdown and tolerates a second shutdown", async () => {
    startAt(3, 0);
    initializeScheduler();
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(jobs.dueDate).toHaveBeenCalledTimes(1);

    shutdownScheduler();
    shutdownScheduler();
    await vi.advanceTimersByTimeAsync(48 * 60 * MINUTE);

    for (const fn of Object.values(jobs)) {
      expect(fn.mock.calls.length).toBeLessThanOrEqual(1);
    }
    expect(jobs.seats).toHaveBeenCalledTimes(0);
    expect(jobs.retention).toHaveBeenCalledTimes(0);
  });
});

describe("scheduler Sentry check-ins", () => {
  async function runFirstTick() {
    startAt(3, 0);
    initializeScheduler();
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
  }

  it("reports in_progress and then ok for a job that finished cleanly", async () => {
    await runFirstTick();
    const due = sentry.captureCheckIn.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((c) => c.monitorSlug === "due-date-reminders");
    expect(due).toEqual([
      { monitorSlug: "due-date-reminders", status: "in_progress" },
      {
        checkInId: "check-in-1",
        monitorSlug: "due-date-reminders",
        status: "ok",
      },
    ]);
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("reports error for a degraded outcome without capturing an exception", async () => {
    jobs.dueDate.mockResolvedValueOnce({ degraded: true });
    await runFirstTick();

    const due = sentry.captureCheckIn.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((c) => c.monitorSlug === "due-date-reminders");
    expect(due.map((c) => c.status)).toEqual(["in_progress", "error"]);
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("captures a thrown error, marks the check-in failed and keeps the other jobs and later ticks running", async () => {
    const boom = new Error("boom");
    jobs.jira.mockRejectedValueOnce(boom);
    await runFirstTick();

    expect(sentry.captureException).toHaveBeenCalledWith(boom, {
      tags: { area: "cron", job: "jira-status-poll" },
    });
    const jira = sentry.captureCheckIn.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((c) => c.monitorSlug === "jira-status-poll");
    expect(jira.map((c) => c.status)).toEqual(["in_progress", "error"]);
    expect(console.error).toHaveBeenCalledWith(
      "Cron job jira-status-poll failed",
      boom,
    );
    // The other jobs of the same tick still ran.
    expect(jobs.dueDate).toHaveBeenCalledTimes(1);
    expect(jobs.webhook).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(jobs.jira).toHaveBeenCalledTimes(2);
    const later = sentry.captureCheckIn.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((c) => c.monitorSlug === "jira-status-poll");
    expect(later.at(-1)?.status).toBe("ok");
  });
});
