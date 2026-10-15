import { retryStorageCleanup } from "../storage/cleanup-queue";
import { cleanupDraftUploads } from "./draft-upload-cleanup";
import { replayDeferredIssueEdits } from "../plugins/github/services/deferred-issue-edits";
import * as Sentry from "@sentry/node";
import { Cron } from "croner";
import { enforceActivityRetention } from "./activity-retention";
import { checkDueDateReminders } from "./due-date-reminders";
import { pollJiraStatuses } from "./jira-status-poll";
import { checkProjectWebhookReminders } from "./project-webhook-reminders";
import { reconcileWorkspaceSeats } from "./seat-reconciliation";
import { checkTrialReminders } from "./trial-reminders";

const jobs: Cron[] = [];

type JobOutcome = { degraded?: boolean };

// Cron jobs swallow their operational failures (per-item try/catch) so they
// can keep processing the rest of the batch. Reporting Sentry status purely
// from the thrown-rejection channel would always show "ok" for any partially
// failed run. Inspect the returned outcome instead so handled failures light
// up the monitor without aborting the rest of the work. Unexpected throws are
// captured as exception events and swallowed so one bad tick can't take down
// the scheduler via an unhandled rejection.
function withCheckIn<T>(name: string, fn: () => Promise<T>) {
  return async (): Promise<void> => {
    const checkInId = Sentry.captureCheckIn({
      monitorSlug: name,
      status: "in_progress",
    });
    try {
      const result = await fn();
      const degraded = Boolean(
        (result as JobOutcome | null | undefined)?.degraded,
      );
      Sentry.captureCheckIn({
        checkInId,
        monitorSlug: name,
        status: degraded ? "error" : "ok",
      });
    } catch (error) {
      Sentry.captureException(error, { tags: { area: "cron", job: name } });
      Sentry.captureCheckIn({
        checkInId,
        monitorSlug: name,
        status: "error",
      });
      console.error(`Cron job ${name} failed`, error);
    }
  };
}

export function initializeScheduler(): void {
  jobs.push(
    new Cron(
      "* * * * *",
      withCheckIn("deferred-issue-edits", replayDeferredIssueEdits),
    ),
  );
  jobs.push(
    new Cron(
      "*/5 * * * *",
      { protect: true },
      withCheckIn("storage-cleanup", retryStorageCleanup),
    ),
  );
  jobs.push(
    new Cron(
      "31 * * * *",
      { protect: true },
      withCheckIn("draft-upload-cleanup", cleanupDraftUploads),
    ),
  );
  jobs.push(
    new Cron(
      "*/5 * * * *",
      withCheckIn("due-date-reminders", checkDueDateReminders),
    ),
  );
  jobs.push(
    new Cron(
      "*/5 * * * *",
      withCheckIn("project-webhook-reminders", checkProjectWebhookReminders),
    ),
  );
  // Reads the Jira issues linked to tasks under a job lease, so one instance
  // polls at a time (see scheduler/jira-status-poll.ts).
  jobs.push(
    new Cron("*/5 * * * *", withCheckIn("jira-status-poll", pollJiraStatuses)),
  );
  jobs.push(
    new Cron(
      "17 * * * *",
      withCheckIn("seat-reconciliation", reconcileWorkspaceSeats),
    ),
  );
  jobs.push(
    new Cron("23 * * * *", withCheckIn("trial-reminders", checkTrialReminders)),
  );
  // Retention is day-granularity (activityRetentionDays), so once a day is
  // enough; ACTIVITY_RETENTION_ENABLED=false disables it without touching
  // the schedule (see scheduler/activity-retention.ts).
  jobs.push(
    new Cron(
      "42 3 * * *",
      withCheckIn("activity-retention", enforceActivityRetention),
    ),
  );
  console.log(
    "⏰ Scheduler started (deferred integration edits every minute, reminders and Jira status polling every 5 minutes, seat reconciliation and trial reminders hourly, activity retention daily)",
  );
}

export function shutdownScheduler(): void {
  for (const job of jobs) {
    job.stop();
  }
  jobs.length = 0;
}
