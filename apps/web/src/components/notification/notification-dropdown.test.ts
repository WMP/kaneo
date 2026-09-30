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

describe("workspace member added role", () => {
  const roleT = (key: string, options?: Record<string, unknown>) =>
    key.endsWith("workspace_member_added.content")
      ? `as ${options?.role}`
      : key;

  it("translates a built-in role name and capitalizes a custom one", () => {
    const base = { workspaceName: "Acme", inviterName: "Olivia" };
    expect(
      getNotificationContent(
        notification("workspace_member_added", { ...base, role: "member" }),
        roleT,
      ),
    ).toBe("as team:roles.member");
    expect(
      getNotificationContent(
        notification("workspace_member_added", { ...base, role: "qa-lead" }),
        roleT,
      ),
    ).toBe("as Qa-Lead");
  });
});

describe("notification display content", () => {
  it("renders the workspace member added notification from its event data", () => {
    const item = notification("workspace_member_added", {
      workspaceId: "ws-1",
      workspaceName: "Acme",
      inviterName: "Olivia",
      role: "member",
    });

    expect(getNotificationTitle(item, t)).toBe(
      "notifications:events.workspace_member_added.title",
    );
    expect(getNotificationContent(item, t)).toBe(
      "notifications:events.workspace_member_added.content",
    );
  });

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
});
