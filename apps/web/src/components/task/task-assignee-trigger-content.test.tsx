import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import { TaskAssigneeTriggerContent } from "./task-assignee-trigger-content";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "count" in options ? `${key}|${options.count}` : key,
  }),
}));

afterEach(cleanup);

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  title: "Task",
  number: 1,
  description: null,
  status: "to-do",
  priority: null,
  startDate: null,
  dueDate: null,
  progress: 0,
  isMilestone: false,
  baselineStartDate: null,
  baselineDueDate: null,
  position: 1,
  createdAt: "2026-07-17T00:00:00.000Z",
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
  ...overrides,
});

const resource = (id: string, name: string) => ({
  userId: null,
  resourceId: id,
  kind: "person" as const,
  name,
  image: null,
  units: 100,
  work: null,
});

const user = (id: string, name: string) => ({
  userId: id,
  name,
  image: null,
  units: 100,
  work: null,
});

describe("TaskAssigneeTriggerContent", () => {
  it("shows the placeholder and the unassigned label for a task nobody is assigned to", () => {
    render(<TaskAssigneeTriggerContent task={makeTask()} />);

    expect(screen.getByText("?")).toBeInTheDocument();
    expect(
      screen.getByText("tasks:popover.assignee.unassigned"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows the name of a resource that is the only assignee, not the unassigned label", () => {
    render(
      <TaskAssigneeTriggerContent
        task={makeTask({ assignees: [resource("r1", "Marcin Baran")] })}
      />,
    );

    expect(screen.getByText("Marcin Baran")).toBeInTheDocument();
    expect(screen.queryByText("?")).toBeNull();
    expect(screen.queryByText("tasks:popover.assignee.unassigned")).toBeNull();
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("shows a count when several users and resources are assigned", () => {
    render(
      <TaskAssigneeTriggerContent
        task={makeTask({
          userId: "u1",
          assigneeId: "u1",
          assigneeName: "Alice",
          assignees: [
            {
              userId: "u1",
              name: "Alice",
              image: null,
              units: 100,
              work: null,
            },
            resource("r1", "Marcin Baran"),
          ],
        })}
      />,
    );

    expect(
      screen.getByText("tasks:popover.assignee.assignedCount|2"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Alice")).toBeNull();
    expect(screen.queryByText("tasks:popover.assignee.unassigned")).toBeNull();
  });

  it("shows at most two full-size avatars with readable initials and a +N badge for the rest", () => {
    const { container } = render(
      <TaskAssigneeTriggerContent
        task={makeTask({
          assignees: [
            user("u1", "Carol Irving"),
            user("u2", "Mark Moss"),
            user("u3", "Anna Rose"),
            resource("r1", "Marcin Baran"),
          ],
        })}
      />,
    );

    const avatars = container.querySelectorAll('[data-slot="avatar"]');
    expect(avatars).toHaveLength(2);
    for (const avatar of avatars) {
      expect(avatar).toHaveClass("size-5");
      expect(avatar).not.toHaveClass("size-4");
    }
    expect(screen.getByText("CI")).toBeInTheDocument();
    expect(screen.getByText("MM")).toBeInTheDocument();
    expect(screen.queryByText("AR")).toBeNull();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(
      screen.getByText("tasks:popover.assignee.assignedCount|4"),
    ).toBeInTheDocument();
  });

  it("shows no +N badge when every assignee fits", () => {
    render(
      <TaskAssigneeTriggerContent
        task={makeTask({
          assignees: [resource("r1", "Marcin Baran"), resource("r2", "Ola")],
        })}
      />,
    );

    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("counts several resources when no user is assigned", () => {
    render(
      <TaskAssigneeTriggerContent
        task={makeTask({
          assignees: [resource("r1", "Marcin Baran"), resource("r2", "Ola")],
        })}
      />,
    );

    expect(
      screen.getByText("tasks:popover.assignee.assignedCount|2"),
    ).toBeInTheDocument();
  });

  it("prefers the project member's current name over the one the task carries", () => {
    render(
      <TaskAssigneeTriggerContent
        task={makeTask({
          userId: "u1",
          assigneeId: "u1",
          assigneeName: "Old Name",
          assignees: [
            {
              userId: "u1",
              name: "Old Name",
              image: null,
              units: 100,
              work: null,
            },
          ],
        })}
        assignee={{ userId: "u1", user: { name: "New Name", image: null } }}
      />,
    );

    expect(screen.getByText("New Name")).toBeInTheDocument();
    expect(screen.queryByText("Old Name")).toBeNull();
  });

  it("falls back to the assignee's own name when the member has none", () => {
    render(
      <TaskAssigneeTriggerContent
        task={makeTask({
          userId: "u1",
          assigneeId: "u1",
          assignees: [
            {
              userId: "u1",
              name: "Alice",
              image: null,
              units: 100,
              work: null,
            },
          ],
        })}
        assignee={{ userId: "u1", user: { name: null, image: null } }}
      />,
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("uses the primary assignee of a task that has no assignees list", () => {
    render(
      <TaskAssigneeTriggerContent
        task={makeTask({
          userId: "u1",
          assigneeId: "u1",
          assigneeName: "Alice",
        })}
      />,
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("tasks:popover.assignee.unassigned")).toBeNull();
  });

  it("does not apply the member's name to a different assignee", () => {
    render(
      <TaskAssigneeTriggerContent
        task={makeTask({ assignees: [resource("r1", "Marcin Baran")] })}
        assignee={{ userId: "u1", user: { name: "Someone Else", image: null } }}
      />,
    );

    expect(screen.getByText("Marcin Baran")).toBeInTheDocument();
    expect(screen.queryByText("Someone Else")).toBeNull();
  });
});
