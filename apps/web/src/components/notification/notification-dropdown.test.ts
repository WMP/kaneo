import { describe, expect, it } from "vitest";
import type { Notification } from "@/types/notification";
import {
  getNotificationContent,
  getNotificationTitle,
} from "./notification-dropdown";

const t = (key: string, options?: Record<string, unknown>) => {
  if (key === "notifications:reminderLeadTime.days") {
    return `${options?.count} days`;
  }
  if (key === "notifications:events.due_date_reminder.content") {
    return `${options?.taskTitle} is due in ${options?.leadTime}`;
  }
  if (key === "notifications:events.jira_status_proposal.title") {
    return "Jira status changed";
  }
  if (key === "notifications:events.jira_status_proposal.content") {
    return `Jira issue ${options?.issueKey} is now "${options?.toStatus}" (task "${options?.taskTitle}")`;
  }
  if (key === "notifications:events.task_comment.title") {
    return `${options?.commenterName} commented on your task`;
  }
  if (key === "notifications:events.task_comment.content") {
    return `New comment on ${options?.taskTitle}: ${options?.commentPreview}`;
  }
  return key;
};

function notification(
  type: string,
  eventData: Record<string, unknown>,
): Notification {
  return {
    id: "notification-1",
    userId: "user-1",
    title: null,
    content: null,
    type,
    eventData,
    isRead: false,
    createdAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z",
  } as unknown as Notification;
}

describe("notification display content", () => {
  it("renders configured due-date lead times", () => {
    const item = notification("due_date_reminder", {
      taskTitle: "Launch website",
      leadTimeMinutes: 2880,
    });

    expect(getNotificationTitle(item, t)).toBe(
      "notifications:events.due_date_reminder.title",
    );
    expect(getNotificationContent(item, t)).toBe(
      "Launch website is due in 2 days",
    );
  });

  it("renders comment notifications with their preview", () => {
    const item = notification("task_comment", {
      taskTitle: "Launch website",
      commenterName: "Mina",
      commentPreview: "Ready for review",
    });

    expect(getNotificationTitle(item, t)).toBe("Mina commented on your task");
    expect(getNotificationContent(item, t)).toBe(
      "New comment on Launch website: Ready for review",
    );
  });

  it("renders a Jira status proposal from its event data", () => {
    const item = notification("jira_status_proposal", {
      taskTitle: "Launch website",
      projectId: "project-1",
      workspaceId: "workspace-1",
      issueKey: "PROJ-7",
      fromStatus: "In Progress",
      toStatus: "Done",
      proposedStatus: "done",
      proposalId: "proposal-1",
    });

    expect(getNotificationTitle(item, t)).toBe("Jira status changed");
    expect(getNotificationContent(item, t)).toBe(
      'Jira issue PROJ-7 is now "Done" (task "Launch website")',
    );
  });

  it("falls back to the stored text for a Jira proposal without event data", () => {
    const item = {
      ...notification("jira_status_proposal", {}),
      eventData: null,
      title: "Jira status changed",
      content: "The status of a linked Jira issue changed.",
    } as unknown as Notification;

    expect(getNotificationTitle(item, t)).toBe("Jira status changed");
    expect(getNotificationContent(item, t)).toBe(
      "The status of a linked Jira issue changed.",
    );
  });
});
