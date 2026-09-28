import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import { useTaskFilters } from "./use-task-filters";

function makeTask(overrides: Partial<Task> & Pick<Task, "id">): Task {
  return {
    title: overrides.id,
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
    position: 0,
    createdAt: "2026-08-31T00:00:00.000Z",
    userId: null,
    assigneeId: null,
    assigneeName: null,
    projectId: "project-1",
    ...overrides,
  };
}

function makeProject(tasks: Task[]): ProjectWithTasks {
  return {
    id: "project-1",
    name: "Project",
    slug: "PROJ",
    icon: null,
    description: null,
    isPublic: false,
    workspaceId: "workspace-1",
    columns: [
      {
        id: "todo",
        slug: "to-do",
        name: "To Do",
        icon: null,
        isFinal: false,
        tasks,
      },
    ],
    plannedTasks: [],
    archivedTasks: [],
  };
}

describe("useTaskFilters assignee filter", () => {
  const storageKey = "kaneo:board-filters:project-1";

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("matches a task by a non-primary assignee", () => {
    const primaryOnly = makeTask({
      id: "task-primary",
      userId: "user-1",
      assigneeId: "user-1",
    });
    const multiAssignee = makeTask({
      id: "task-multi",
      userId: "user-1",
      assigneeId: "user-1",
      assignees: [
        {
          userId: "user-1",
          name: "Alice",
          image: null,
          units: 100,
          work: null,
        },
        { userId: "user-2", name: "Bob", image: null, units: 100, work: null },
      ],
    });
    const unrelated = makeTask({
      id: "task-unrelated",
      userId: "user-3",
      assigneeId: "user-3",
    });
    const unassigned = makeTask({ id: "task-unassigned" });

    const project = makeProject([
      primaryOnly,
      multiAssignee,
      unrelated,
      unassigned,
    ]);

    const { result } = renderHook(() => useTaskFilters(project, "project-1"));

    act(() => {
      result.current.updateFilter("assignee", ["user-2"]);
    });

    const filteredIds = result.current.filteredProject?.columns[0]?.tasks.map(
      (task) => task.id,
    );

    expect(filteredIds).toEqual(["task-multi"]);
  });

  it("matches a task by a resource assignee", () => {
    const resourceAssigned = makeTask({
      id: "task-resource",
      assignees: [
        {
          userId: null,
          resourceId: "resource-1",
          kind: "equipment",
          name: "Drill",
          image: null,
          units: 100,
          work: null,
        },
      ],
    });
    const unrelated = makeTask({ id: "task-unrelated", userId: "user-3" });

    const project = makeProject([resourceAssigned, unrelated]);

    const { result } = renderHook(() => useTaskFilters(project, "project-1"));

    act(() => {
      result.current.updateFilter("assignee", ["resource-1"]);
    });

    const filteredIds = result.current.filteredProject?.columns[0]?.tasks.map(
      (task) => task.id,
    );

    expect(filteredIds).toEqual(["task-resource"]);
  });

  it("keeps the unassigned case excluded when a real user is selected", () => {
    const unassigned = makeTask({ id: "task-unassigned" });
    const assigned = makeTask({
      id: "task-assigned",
      userId: "user-1",
      assigneeId: "user-1",
    });

    const project = makeProject([unassigned, assigned]);

    const { result } = renderHook(() => useTaskFilters(project, "project-1"));

    act(() => {
      result.current.updateFilter("assignee", ["user-1"]);
    });

    const filteredIds = result.current.filteredProject?.columns[0]?.tasks.map(
      (task) => task.id,
    );

    expect(filteredIds).toEqual(["task-assigned"]);
  });

  // Sanity check that this test's storage key matches the one the hook
  // actually persists to, so a future rename here doesn't silently start
  // reading/writing the wrong key.
  it("persists filters under the expected storage key", () => {
    const project = makeProject([]);
    const { result } = renderHook(() => useTaskFilters(project, "project-1"));

    act(() => {
      result.current.updateFilter("assignee", ["user-1"]);
    });

    expect(window.localStorage.getItem(storageKey)).toContain("user-1");
  });
});
