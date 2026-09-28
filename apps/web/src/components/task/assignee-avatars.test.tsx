import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssigneeAvatars, resolveTaskAssignees } from "./assignee-avatars";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const t = vi.fn((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}::${JSON.stringify(opts)}` : key,
);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t }),
}));

const assignees = [
  { userId: "u1", name: "Alice", image: null },
  { userId: "u2", name: "Bob", image: null },
  { userId: "u3", name: "Carol", image: null },
  { userId: "u4", name: "Dana", image: null },
  { userId: "u5", name: "Eve", image: null },
];

describe("AssigneeAvatars", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<AssigneeAvatars assignees={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders up to max avatars and a +K overflow bubble for the rest", () => {
    const { container } = render(
      <AssigneeAvatars assignees={assignees} max={3} />,
    );

    expect(container.querySelectorAll('[data-slot="avatar"]')).toHaveLength(3);
    expect(screen.getByText("+2")).toBeVisible();
  });

  it("renders every avatar and no overflow bubble when within max", () => {
    const { container } = render(
      <AssigneeAvatars assignees={assignees.slice(0, 2)} max={3} />,
    );

    expect(container.querySelectorAll('[data-slot="avatar"]')).toHaveLength(2);
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("labels the group with every assignee's name, including overflow ones", () => {
    render(<AssigneeAvatars assignees={assignees} max={3} />);

    expect(t).toHaveBeenCalledWith("tasks:assignee.assignedAriaLabel", {
      names: "Alice, Bob, Carol, Dana, Eve",
    });
  });
});

describe("resolveTaskAssignees", () => {
  it("returns the assignees array when present", () => {
    const task = {
      assignees: [{ userId: "u1", name: "Alice", image: null }],
      userId: "u9",
      assigneeId: "u9",
      assigneeName: "Someone else",
      assigneeImage: null,
    };

    expect(resolveTaskAssignees(task)).toEqual(task.assignees);
  });

  it("falls back to the single primary assignee when the array is absent", () => {
    const task = {
      userId: "u9",
      assigneeId: "u9",
      assigneeName: "Someone",
      assigneeImage: "https://example.com/img.png",
    };

    expect(resolveTaskAssignees(task)).toEqual([
      {
        userId: "u9",
        name: "Someone",
        image: "https://example.com/img.png",
      },
    ]);
  });

  it("falls back to the single primary assignee when the array is empty", () => {
    const task = {
      assignees: [],
      userId: "u9",
      assigneeId: "u9",
      assigneeName: "Someone",
      assigneeImage: null,
    };

    expect(resolveTaskAssignees(task)).toEqual([
      { userId: "u9", name: "Someone", image: null },
    ]);
  });

  it("returns an empty list when the task is unassigned", () => {
    expect(resolveTaskAssignees({})).toEqual([]);
  });
});
