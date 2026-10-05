import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import TaskRelations from "./task-relations";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  canUpdateTasks: vi.fn(),
  createRelation: vi.fn(),
  deleteRelation: vi.fn(),
  taskRelations: vi.fn(),
  projectTasks: vi.fn(),
  project: vi.fn(),
  globalSearch: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { project?: string; defaultValue?: string }) =>
      opts?.project ? `${key}:${opts.project}` : (opts?.defaultValue ?? key),
  }),
}));
vi.mock("@/hooks/mutations/task-relation/use-create-task-relation", () => ({
  default: () => ({ mutateAsync: mocks.createRelation }),
}));
vi.mock("@/hooks/mutations/task-relation/use-delete-task-relation", () => ({
  default: () => ({ mutate: mocks.deleteRelation }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => mocks.project(),
}));
vi.mock("@/hooks/queries/search/use-global-search", () => ({
  default: (params: unknown) => mocks.globalSearch(params),
}));
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: () => mocks.projectTasks(),
}));
vi.mock("@/hooks/queries/task-relation/use-get-task-relations", () => ({
  default: () => mocks.taskRelations(),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));
vi.mock("@/hooks/queries/project-member/use-project-members", () => ({
  useProjectMembers: () => ({ data: { members: [] } }),
}));
vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: () => ({ canUpdateTasks: mocks.canUpdateTasks }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));
vi.mock("./subtask-status-popover", () => ({
  default: (props: { projectId: string; children: React.ReactNode }) => (
    <div data-testid="status-popover" data-project-id={props.projectId}>
      {props.children}
    </div>
  ),
}));
vi.mock("./task-relation-dependency-popover", () => ({
  default: (props: {
    projectId: string | undefined;
    children: React.ReactNode;
  }) => (
    <div data-testid="dependency-popover" data-project-id={props.projectId}>
      {props.children}
    </div>
  ),
}));
vi.mock("./subtask-assignee-popover", () => ({
  default: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));

const CURRENT_PROJECT_ID = "project-current";

// A column of the CURRENT project happens to share its id/slug with the
// other project's status below — the fixture that makes it obvious whether
// a fix compares project ids or merely looks the status id up by string.
const CURRENT_PROJECT_COLUMNS = [
  {
    id: "done",
    icon: "check-circle",
    isFinal: true,
    tasks: [],
  },
];

function otherProjectRelation() {
  return {
    id: "relation-1",
    relationType: "related",
    sourceTaskId: "task-current",
    targetTaskId: "task-other",
    sourceTask: null,
    targetTask: {
      id: "task-other",
      title: "Fix the other project's bug",
      status: "done",
      priority: null,
      number: 7,
      projectId: "project-other",
      projectSlug: "OTHER",
      userId: null,
      assigneeName: null,
    },
  };
}

function sameProjectRelation() {
  return {
    id: "relation-2",
    relationType: "related",
    sourceTaskId: "task-current",
    targetTaskId: "task-same",
    sourceTask: null,
    targetTask: {
      id: "task-same",
      title: "Fix a bug here",
      status: "to-do",
      priority: null,
      number: 3,
      projectId: CURRENT_PROJECT_ID,
      projectSlug: "CUR",
      userId: null,
      assigneeName: null,
    },
  };
}

beforeEach(() => {
  mocks.canUpdateTasks.mockReturnValue(true);
  mocks.project.mockReturnValue({ data: { slug: "CUR" } });
  mocks.projectTasks.mockReturnValue({
    data: { columns: CURRENT_PROJECT_COLUMNS },
  });
  mocks.globalSearch.mockReturnValue({ data: undefined });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderRelations() {
  render(
    <TaskRelations
      taskId="task-current"
      projectId={CURRENT_PROJECT_ID}
      workspaceId="workspace-1"
    />,
  );
}

function blockingRelation(direction: "blocks" | "blocked_by") {
  const current = {
    id: "task-current",
    title: "Current task",
    status: "to-do",
    priority: null,
    number: 1,
    projectId: CURRENT_PROJECT_ID,
    projectSlug: "CUR",
    userId: null,
    assigneeName: null,
  };
  const other = {
    id: "task-other",
    title: "Other project's task",
    status: "to-do",
    priority: null,
    number: 7,
    projectId: "project-other",
    projectSlug: "OTHER",
    userId: null,
    assigneeName: null,
  };
  const blocks = direction === "blocks";
  return {
    id: "relation-blocking",
    relationType: "blocks",
    dependencyType: "fs",
    lagDays: 0,
    sourceTaskId: blocks ? current.id : other.id,
    targetTaskId: blocks ? other.id : current.id,
    sourceTask: blocks ? current : other,
    targetTask: blocks ? other : current,
  };
}

describe("TaskRelations dependency editing", () => {
  it("edits a blocks dependency with the rights of this task's project", () => {
    mocks.taskRelations.mockReturnValue({ data: [blockingRelation("blocks")] });
    renderRelations();
    expect(screen.getByTestId("dependency-popover")).toHaveAttribute(
      "data-project-id",
      CURRENT_PROJECT_ID,
    );
  });

  it("edits a blocked_by dependency with the rights of the related task's project, the source of the relation", () => {
    mocks.taskRelations.mockReturnValue({
      data: [blockingRelation("blocked_by")],
    });
    renderRelations();
    expect(screen.getByTestId("dependency-popover")).toHaveAttribute(
      "data-project-id",
      "project-other",
    );
  });
});

describe("TaskRelations cross-project correctness", () => {
  it("navigates using the related task's own project id, not the current one", () => {
    mocks.taskRelations.mockReturnValue({ data: [otherProjectRelation()] });

    renderRelations();
    // The button's accessible name now also carries the task key (see the
    // cross-project key regression below), so match the title as a substring.
    fireEvent.click(
      screen.getByRole("button", { name: /Fix the other project's bug/ }),
    );

    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          workspaceId: "workspace-1",
          projectId: "project-other",
          taskId: "task-other",
        }),
      }),
    );
  });

  it("shows the assignee of a related task from another project by the name the relation carries", () => {
    const base = otherProjectRelation();
    const relation = {
      ...base,
      targetTask: {
        ...base.targetTask,
        userId: "user-elsewhere" as string | null,
        assigneeName: "Carol Smith" as string | null,
      },
    };
    mocks.taskRelations.mockReturnValue({ data: [relation] });

    renderRelations();

    // The project member list is empty: the initials come from the relation.
    expect(screen.getByText("CS")).toBeInTheDocument();
  });

  it("navigates using the current project id for a same-project relation", () => {
    mocks.taskRelations.mockReturnValue({ data: [sameProjectRelation()] });

    renderRelations();
    fireEvent.click(screen.getByRole("button", { name: /Fix a bug here/ }));

    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          projectId: CURRENT_PROJECT_ID,
          taskId: "task-same",
        }),
      }),
    );
  });

  it("makes the status control read-only for a task from another project", () => {
    mocks.taskRelations.mockReturnValue({ data: [otherProjectRelation()] });

    renderRelations();

    // No editable popover wired up for the cross-project item...
    expect(screen.queryByTestId("status-popover")).not.toBeInTheDocument();
    // ...but a (non-interactive) status button is still shown.
    expect(
      screen.getByTitle("tasks:relations.crossProjectStatusReadOnly"),
    ).toBeInTheDocument();
  });

  it("keeps the editable status popover, scoped to the current project, for a same-project item", () => {
    mocks.taskRelations.mockReturnValue({ data: [sameProjectRelation()] });

    renderRelations();

    const popover = screen.getByTestId("status-popover");
    expect(popover).toHaveAttribute("data-project-id", CURRENT_PROJECT_ID);
  });

  it("does not strike through or reuse the current project's column icon for a same-id status in another project", () => {
    // task-other's status ("done") collides with a FINAL column id in the
    // CURRENT project; a fix that only compares status strings (not
    // projectId) would incorrectly treat it as final here too.
    mocks.taskRelations.mockReturnValue({ data: [otherProjectRelation()] });

    renderRelations();

    const title = screen.getByText("Fix the other project's bug");
    expect(title.className).not.toContain("line-through");
  });

  it("shows the task key (SLUG-number) for a cross-project related task", () => {
    mocks.taskRelations.mockReturnValue({ data: [otherProjectRelation()] });

    renderRelations();

    // The other project's own slug, not this board's, so the row reads as
    // belonging elsewhere.
    expect(screen.getByText("OTHER-7")).toBeInTheDocument();
  });

  it("shows the task key for a same-project related task too", () => {
    mocks.taskRelations.mockReturnValue({ data: [sameProjectRelation()] });

    renderRelations();

    expect(screen.getByText("CUR-3")).toBeInTheDocument();
  });

  it("trims the search query before sending it to global search", () => {
    mocks.taskRelations.mockReturnValue({ data: [] });
    renderRelations();

    fireEvent.click(screen.getByRole("button", { name: "" }));
    const input = screen.getByPlaceholderText(
      "tasks:relations.searchPlaceholder",
    );
    fireEvent.change(input, { target: { value: "  bug  " } });

    const lastCall =
      mocks.globalSearch.mock.calls[mocks.globalSearch.mock.calls.length - 1];
    expect(lastCall[0]).toEqual(expect.objectContaining({ q: "bug" }));
  });
});

describe("TaskRelations inline remove control", () => {
  it("shows the inline remove (X) button for an editable relation and removes it on click", () => {
    mocks.canUpdateTasks.mockReturnValue(true);
    mocks.taskRelations.mockReturnValue({ data: [sameProjectRelation()] });

    renderRelations();

    const removeButton = screen.getByRole("button", {
      name: "tasks:relations.removeRelation",
    });
    fireEvent.click(removeButton);

    expect(mocks.deleteRelation).toHaveBeenCalledWith("relation-2");
  });

  it("does not navigate to the related task when the inline remove button is clicked", () => {
    mocks.canUpdateTasks.mockReturnValue(true);
    mocks.taskRelations.mockReturnValue({ data: [sameProjectRelation()] });

    renderRelations();

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:relations.removeRelation" }),
    );

    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("hides the inline remove button when the viewer cannot edit tasks", () => {
    mocks.canUpdateTasks.mockReturnValue(false);
    mocks.taskRelations.mockReturnValue({ data: [sameProjectRelation()] });

    renderRelations();

    expect(
      screen.queryByRole("button", { name: "tasks:relations.removeRelation" }),
    ).not.toBeInTheDocument();
  });
});

describe("TaskRelations link errors", () => {
  function availableTask() {
    return {
      id: "task-b",
      title: "Task B",
      status: "done",
      priority: null,
      number: 2,
      projectId: CURRENT_PROJECT_ID,
      userId: null,
      assigneeName: null,
    };
  }

  function openPickerAndLinkTask() {
    renderRelations();
    fireEvent.click(screen.getByRole("button", { name: "" }));
    fireEvent.click(screen.getByText("Task B"));
  }

  beforeEach(() => {
    mocks.taskRelations.mockReturnValue({ data: [] });
    mocks.projectTasks.mockReturnValue({
      data: {
        columns: [{ ...CURRENT_PROJECT_COLUMNS[0], tasks: [availableTask()] }],
      },
    });
  });

  it("shows the circular-dependency message for a 409 that would close a cycle", async () => {
    mocks.createRelation.mockRejectedValueOnce(
      new HttpError(409, "This dependency would create a circular dependency"),
    );

    openPickerAndLinkTask();

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "tasks:relations.circularDependencyError",
      ),
    );
  });

  it("falls back to the generic link-error message for any other failure", async () => {
    mocks.createRelation.mockRejectedValueOnce(
      new HttpError(409, "This relation already exists"),
    );

    openPickerAndLinkTask();

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "tasks:relations.linkError",
      ),
    );
  });
});

describe("TaskRelations link creation direction", () => {
  const sameProjectTask = {
    id: "task-b",
    title: "Task B",
    status: "done",
    priority: null,
    number: 2,
    projectId: CURRENT_PROJECT_ID,
    userId: null,
    assigneeName: null,
  };

  function openPicker() {
    renderRelations();
    fireEvent.click(screen.getByRole("button", { name: "" }));
  }

  beforeEach(() => {
    mocks.taskRelations.mockReturnValue({ data: [] });
    mocks.createRelation.mockResolvedValue(undefined);
    mocks.projectTasks.mockReturnValue({
      data: {
        columns: [{ ...CURRENT_PROJECT_COLUMNS[0], tasks: [sameProjectTask] }],
      },
    });
  });

  it("creates a related link from this task to the picked one by default", async () => {
    openPicker();
    fireEvent.click(screen.getByText("Task B"));

    await waitFor(() =>
      expect(mocks.createRelation).toHaveBeenCalledWith({
        sourceTaskId: "task-current",
        targetTaskId: "task-b",
        relationType: "related",
      }),
    );
  });

  it("creates a blocks dependency from this task to the picked one for Blocks", async () => {
    openPicker();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:relations.blocks" }),
    );
    fireEvent.click(screen.getByText("Task B"));

    await waitFor(() =>
      expect(mocks.createRelation).toHaveBeenCalledWith({
        sourceTaskId: "task-current",
        targetTaskId: "task-b",
        relationType: "blocks",
        dependencyType: "fs",
        lagDays: 0,
      }),
    );
  });

  it("creates a blocks relation with the ends swapped for Blocked by", async () => {
    openPicker();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:relations.blockedBy" }),
    );
    fireEvent.click(screen.getByText("Task B"));

    // The picked task is the blocker (source); this task is blocked (target).
    await waitFor(() =>
      expect(mocks.createRelation).toHaveBeenCalledWith({
        sourceTaskId: "task-b",
        targetTaskId: "task-current",
        relationType: "blocks",
        dependencyType: "fs",
        lagDays: 0,
      }),
    );
  });

  it("sends the chosen dependency type and lag for Blocked by", async () => {
    openPicker();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:relations.blockedBy" }),
    );
    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: "tasks:relations.dependency.lagLabel",
      }),
      { target: { value: "2" } },
    );
    fireEvent.click(screen.getByText("Task B"));

    await waitFor(() =>
      expect(mocks.createRelation).toHaveBeenCalledWith({
        sourceTaskId: "task-b",
        targetTaskId: "task-current",
        relationType: "blocks",
        dependencyType: "fs",
        lagDays: 2,
      }),
    );
  });

  it("shows the dependency controls for Blocks and Blocked by, but not for Related", () => {
    openPicker();
    const lag = () =>
      screen.queryByRole("spinbutton", {
        name: "tasks:relations.dependency.lagLabel",
      });

    expect(lag()).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:relations.blocks" }),
    );
    expect(lag()).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:relations.blockedBy" }),
    );
    expect(lag()).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:relations.related" }),
    );
    expect(lag()).not.toBeInTheDocument();
  });

  it("shows the circular-dependency message when Blocked by would close a cycle", async () => {
    mocks.createRelation.mockRejectedValueOnce(
      new HttpError(409, "This dependency would create a circular dependency"),
    );
    openPicker();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:relations.blockedBy" }),
    );
    fireEvent.click(screen.getByText("Task B"));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "tasks:relations.circularDependencyError",
      ),
    );
  });

  it("shows the generic link error for a duplicate Blocked by relation", async () => {
    mocks.createRelation.mockRejectedValueOnce(
      new HttpError(409, "This relation already exists"),
    );
    openPicker();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:relations.blockedBy" }),
    );
    fireEvent.click(screen.getByText("Task B"));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "tasks:relations.linkError",
      ),
    );
  });
});
