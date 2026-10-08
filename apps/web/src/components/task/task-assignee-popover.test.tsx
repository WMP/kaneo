import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import type Resource from "@/types/resource";
import type Task from "@/types/task";
import TaskAssigneePopover from "./task-assignee-popover";

afterEach(() => {
  permissions.canAssign = true;
  permissions.canInvite = true;
  permissions.canUpdateProjects = true;
  permissions.projectId = undefined;
  permissions.membersProjectId = undefined;
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const updateTaskAssignees = vi.fn();
const toastError = vi.fn();
const createResource = vi.fn();
const inviteDialog = vi.fn();

vi.mock("@/hooks/mutations/task/use-update-task-assignees", () => ({
  useUpdateTaskAssignees: () => ({ mutateAsync: updateTaskAssignees }),
}));

vi.mock("@/hooks/mutations/resource/use-create-resource", () => ({
  default: () => ({ mutateAsync: createResource, isPending: false }),
}));

const workspaceUsers = {
  members: [
    { userId: "u1", user: { name: "Alice", image: null } },
    { userId: "u2", user: { name: "Bob", image: null } },
  ],
};

const workspaceResources: Resource[] = [
  {
    id: "r1",
    workspaceId: "workspace-1",
    kind: "equipment",
    name: "Drill",
    email: null,
    userId: null,
    linked: false,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  },
  {
    id: "r3",
    workspaceId: "workspace-1",
    kind: "person",
    name: "Nina",
    email: "nina@example.com",
    userId: null,
    linked: false,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  },
];

vi.mock("@/hooks/queries/project-member/use-project-members", () => ({
  useProjectMembers: (projectId: string) => {
    permissions.membersProjectId = projectId;
    return { data: workspaceUsers };
  },
}));

vi.mock("@/hooks/queries/resource/use-get-workspace-resources", () => ({
  default: () => ({ data: workspaceResources }),
}));

vi.mock("@/hooks/use-numbered-shortcuts", () => ({
  useNumberedShortcuts: vi.fn(),
}));

// Assigning is decided by the task's project; creating a resource is a
// workspace-level action and stays with the workspace role.
const permissions = vi.hoisted(() => ({
  canAssign: true,
  canInvite: true,
  canUpdateProjects: true,
  projectId: undefined as string | undefined,
  membersProjectId: undefined as string | undefined,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateProjects: () => permissions.canUpdateProjects,
  }),
}));
vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: (projectId: string) => {
    permissions.projectId = projectId;
    return {
      canAssignTasks: () => permissions.canAssign,
      canInviteToProject: () => permissions.canInvite,
    };
  },
}));

// The real dialog loads roles and projects; what matters here is what the
// popover hands it and that it outlives the popover.
vi.mock("@/components/resource/resource-invite-dialog", () => ({
  default: (props: {
    resource: Resource;
    workspaceId: string;
    defaultProjectIds?: string[];
    canLink: boolean;
    onClose: () => void;
  }) => {
    inviteDialog(props);
    return (
      <div role="dialog" aria-label="invite">
        <span>{props.resource.name}</span>
        <button type="button" onClick={props.onClose}>
          close-invite
        </button>
      </div>
    );
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const baseTask: Task = {
  id: "task-1",
  title: "Task with two assignees",
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
  userId: "u1",
  assigneeId: "u1",
  assigneeName: "Alice",
  projectId: "project-1",
  assignees: [
    { userId: "u1", name: "Alice", image: null, units: 100, work: null },
  ],
};

describe("TaskAssigneePopover", () => {
  it("asks the task's own project for the right to assign and for the people to pick", () => {
    render(
      <TaskAssigneePopover task={baseTask} workspaceId="workspace-1">
        <Button>Assignee</Button>
      </TaskAssigneePopover>,
    );

    expect(permissions.projectId).toBe("project-1");
    expect(permissions.membersProjectId).toBe("project-1");
  });

  it("keeps an assignee who is no longer a project member in the list, marked, so they can be unassigned", async () => {
    updateTaskAssignees.mockResolvedValue(undefined);
    const task: Task = {
      ...baseTask,
      userId: "gone",
      assigneeId: "gone",
      assigneeName: "Carol",
      assignees: [
        { userId: "gone", name: "Carol", image: null, units: 100, work: null },
      ],
    };

    render(
      <TaskAssigneePopover task={task} workspaceId="workspace-1">
        <Button>Assignee</Button>
      </TaskAssigneePopover>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));

    const carol = await screen.findByRole("button", { name: /Carol/ });
    expect(carol).toHaveTextContent("tasks:popover.assignee.notInProject");
    // Current project members carry no such hint.
    expect(screen.getByRole("button", { name: /Alice/ })).not.toHaveTextContent(
      "notInProject",
    );

    fireEvent.click(carol);
    await waitFor(() =>
      expect(updateTaskAssignees).toHaveBeenCalledWith(
        expect.objectContaining({ userIds: [] }),
      ),
    );
  });

  it("renders only the trigger when the project does not allow assigning", () => {
    permissions.canAssign = false;

    render(
      <TaskAssigneePopover task={baseTask} workspaceId="workspace-1">
        <Button>Assignee</Button>
      </TaskAssigneePopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));
    expect(screen.queryByRole("button", { name: /Alice/ })).toBeNull();
  });

  it("shows a check on every currently assigned member, falling back to the primary assignee", async () => {
    updateTaskAssignees.mockResolvedValue(undefined);

    render(
      <TaskAssigneePopover task={baseTask} workspaceId="workspace-1">
        <Button>Assignee</Button>
      </TaskAssigneePopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));

    const aliceButton = await screen.findByRole("button", { name: /Alice/ });
    const bobButton = screen.getByRole("button", { name: /Bob/ });

    // Alice (the task's sole assignee) is checked; her shortcut number is
    // replaced by the check, so "2" (her would-be shortcut) isn't shown.
    expect(aliceButton.textContent).not.toContain("2");
    // Bob isn't assigned yet, so his shortcut number ("3") is still visible.
    expect(bobButton.textContent).toContain("3");
  });

  it("toggles a member in and submits the full resulting userIds list", async () => {
    updateTaskAssignees.mockResolvedValue(undefined);

    render(
      <TaskAssigneePopover task={baseTask} workspaceId="workspace-1">
        <Button>Assignee</Button>
      </TaskAssigneePopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));

    const bobButton = await screen.findByRole("button", { name: /Bob/ });
    fireEvent.click(bobButton);

    expect(updateTaskAssignees).toHaveBeenCalledWith({
      taskId: "task-1",
      projectId: "project-1",
      userIds: ["u1", "u2"],
      resourceIds: [],
    });
  });

  it("toggles a member out, submitting the set without them", async () => {
    updateTaskAssignees.mockResolvedValue(undefined);

    const twoAssignees: Task = {
      ...baseTask,
      assignees: [
        { userId: "u1", name: "Alice", image: null, units: 100, work: null },
        { userId: "u2", name: "Bob", image: null, units: 100, work: null },
      ],
    };

    render(
      <TaskAssigneePopover task={twoAssignees} workspaceId="workspace-1">
        <Button>Assignee</Button>
      </TaskAssigneePopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));

    const aliceButton = await screen.findByRole("button", { name: /Alice/ });
    fireEvent.click(aliceButton);

    expect(updateTaskAssignees).toHaveBeenCalledWith({
      taskId: "task-1",
      projectId: "project-1",
      userIds: ["u2"],
      resourceIds: [],
    });
  });

  it("clears every assignee when Unassign all is clicked", async () => {
    updateTaskAssignees.mockResolvedValue(undefined);

    render(
      <TaskAssigneePopover task={baseTask} workspaceId="workspace-1">
        <Button>Assignee</Button>
      </TaskAssigneePopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));

    const unassignAllButton = await screen.findByRole("button", {
      name: /tasks:popover.assignee.unassignAll/,
    });
    fireEvent.click(unassignAllButton);

    expect(updateTaskAssignees).toHaveBeenCalledWith({
      taskId: "task-1",
      projectId: "project-1",
      userIds: [],
      resourceIds: [],
    });
  });

  it("reverts the optimistic selection and shows a toast when the mutation fails", async () => {
    updateTaskAssignees.mockRejectedValue(new Error("network down"));

    render(
      <TaskAssigneePopover task={baseTask} workspaceId="workspace-1">
        <Button>Assignee</Button>
      </TaskAssigneePopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));

    const bobButton = await screen.findByRole("button", { name: /Bob/ });
    fireEvent.click(bobButton);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("network down");
    });
  });

  it("toggles a workspace resource in and submits it alongside the user assignees", async () => {
    updateTaskAssignees.mockResolvedValue(undefined);

    render(
      <TaskAssigneePopover task={baseTask} workspaceId="workspace-1">
        <Button>Assignee</Button>
      </TaskAssigneePopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));

    const drillButton = await screen.findByRole("button", { name: /Drill/ });
    fireEvent.click(drillButton);

    expect(updateTaskAssignees).toHaveBeenCalledWith({
      taskId: "task-1",
      projectId: "project-1",
      userIds: ["u1"],
      resourceIds: ["r1"],
    });
  });

  it("creates a new resource inline and assigns it to the task", async () => {
    updateTaskAssignees.mockResolvedValue(undefined);
    createResource.mockResolvedValue({
      id: "r2",
      workspaceId: "workspace-1",
      kind: "person",
      name: "Contractor",
      email: null,
      userId: null,
      linked: false,
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    });

    render(
      <TaskAssigneePopover task={baseTask} workspaceId="workspace-1">
        <Button>Assignee</Button>
      </TaskAssigneePopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));

    const addResourceButton = await screen.findByRole("button", {
      name: /tasks:popover.assignee.addResource/,
    });
    fireEvent.click(addResourceButton);

    const nameInput = screen.getByPlaceholderText(
      "tasks:popover.assignee.newResourceNamePlaceholder",
    );
    fireEvent.change(nameInput, { target: { value: "Contractor" } });

    const createButton = screen.getByRole("button", {
      name: "tasks:popover.assignee.createResource",
    });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(createResource).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        kind: "person",
        name: "Contractor",
        email: undefined,
      });
    });

    await waitFor(() => {
      expect(updateTaskAssignees).toHaveBeenCalledWith({
        taskId: "task-1",
        projectId: "project-1",
        userIds: ["u1"],
        resourceIds: ["r2"],
      });
    });
  });
  describe("inviting a person resource", () => {
    const inviteLabel = "tasks:popover.assignee.inviteResource";

    const openPicker = async () => {
      render(
        <TaskAssigneePopover task={baseTask} workspaceId="workspace-1">
          <Button>Assignee</Button>
        </TaskAssigneePopover>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Assignee" }));
      await screen.findByRole("button", { name: /Drill/ });
    };

    it("opens the invite dialog from a resource row, closing the picker but not the dialog", async () => {
      await openPicker();

      fireEvent.click(screen.getByRole("button", { name: inviteLabel }));

      expect(
        await screen.findByRole("dialog", { name: "invite" }),
      ).toBeVisible();
      expect(inviteDialog).toHaveBeenLastCalledWith(
        expect.objectContaining({
          resource: expect.objectContaining({ id: "r3", name: "Nina" }),
          workspaceId: "workspace-1",
          defaultProjectIds: ["project-1"],
          canLink: false,
        }),
      );
      // The picker is gone, the dialog stays and inviting assigns nobody.
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: /Drill/ })).toBeNull(),
      );
      expect(screen.getByRole("dialog", { name: "invite" })).toBeVisible();
      expect(updateTaskAssignees).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "close-invite" }));
      expect(screen.queryByRole("dialog", { name: "invite" })).toBeNull();
    });

    it("opens the invite dialog right after a person is created inline with an email", async () => {
      updateTaskAssignees.mockResolvedValue(undefined);
      createResource.mockResolvedValue({
        id: "r4",
        workspaceId: "workspace-1",
        kind: "person",
        name: "Olek",
        email: "olek@example.com",
        userId: null,
        linked: false,
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:00.000Z",
      });
      await openPicker();

      fireEvent.click(
        screen.getByRole("button", {
          name: /tasks:popover.assignee.addResource/,
        }),
      );
      fireEvent.change(
        screen.getByPlaceholderText(
          "tasks:popover.assignee.newResourceNamePlaceholder",
        ),
        { target: { value: "Olek" } },
      );
      fireEvent.change(
        screen.getByPlaceholderText(
          "tasks:popover.assignee.newResourceEmailPlaceholder",
        ),
        { target: { value: "olek@example.com" } },
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: "tasks:popover.assignee.createResource",
        }),
      );

      expect(
        await screen.findByRole("dialog", { name: "invite" }),
      ).toBeVisible();
      expect(inviteDialog).toHaveBeenLastCalledWith(
        expect.objectContaining({
          resource: expect.objectContaining({ id: "r4", name: "Olek" }),
          defaultProjectIds: ["project-1"],
        }),
      );
      // The new resource is still assigned to the task.
      await waitFor(() =>
        expect(updateTaskAssignees).toHaveBeenCalledWith({
          taskId: "task-1",
          projectId: "project-1",
          userIds: ["u1"],
          resourceIds: ["r4"],
        }),
      );
    });

    it("does not open the invite dialog for a person created without an email", async () => {
      updateTaskAssignees.mockResolvedValue(undefined);
      createResource.mockResolvedValue({
        id: "r5",
        workspaceId: "workspace-1",
        kind: "person",
        name: "Contractor",
        email: null,
        userId: null,
        linked: false,
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:00.000Z",
      });
      await openPicker();

      fireEvent.click(
        screen.getByRole("button", {
          name: /tasks:popover.assignee.addResource/,
        }),
      );
      fireEvent.change(
        screen.getByPlaceholderText(
          "tasks:popover.assignee.newResourceNamePlaceholder",
        ),
        { target: { value: "Contractor" } },
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: "tasks:popover.assignee.createResource",
        }),
      );

      await waitFor(() => expect(updateTaskAssignees).toHaveBeenCalled());
      expect(screen.queryByRole("dialog", { name: "invite" })).toBeNull();
      expect(inviteDialog).not.toHaveBeenCalled();
    });

    it("offers no invitation without invitation:create in the task's project", async () => {
      permissions.canInvite = false;
      await openPicker();

      expect(screen.getByRole("button", { name: /Nina/ })).toBeVisible();
      expect(screen.queryByRole("button", { name: inviteLabel })).toBeNull();
    });

    it("offers no invitation without the workspace permission to manage resources", async () => {
      permissions.canUpdateProjects = false;
      await openPicker();

      expect(screen.getByRole("button", { name: /Nina/ })).toBeVisible();
      expect(screen.queryByRole("button", { name: inviteLabel })).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: /tasks:popover.assignee.addResource/,
        }),
      ).toBeNull();
    });
  });
});

describe("TaskAssigneePopover search", () => {
  const withMembers = (
    extra: Array<{ userId: string; user: { name: string; image: null } }>,
  ) => {
    const original = workspaceUsers.members.slice();
    workspaceUsers.members.push(...extra);
    return () => {
      workspaceUsers.members.splice(
        0,
        workspaceUsers.members.length,
        ...original,
      );
    };
  };

  const openPopover = async () => {
    render(
      <TaskAssigneePopover task={baseTask} workspaceId="workspace-1">
        <Button>Assignee</Button>
      </TaskAssigneePopover>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));
    return screen.findByPlaceholderText("tasks:picker.search");
  };

  it("filters people by the typed first characters, ignoring case and diacritics", async () => {
    const restore = withMembers([
      { userId: "u3", user: { name: "Łoś Kowalski", image: null } },
    ]);
    try {
      const search = await openPopover();
      expect(screen.getByRole("button", { name: /Alice/ })).toBeVisible();

      fireEvent.change(search, { target: { value: "lo" } });
      expect(
        screen.getByRole("button", { name: /Łoś Kowalski/ }),
      ).toBeVisible();
      expect(screen.queryByRole("button", { name: /Alice/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Bob/ })).toBeNull();
      // "Unassign all" is not a match for a person and is hidden while searching.
      expect(
        screen.queryByRole("button", {
          name: /tasks:popover.assignee.unassignAll/,
        }),
      ).toBeNull();

      fireEvent.change(search, { target: { value: "ALI" } });
      expect(screen.getByRole("button", { name: /Alice/ })).toBeVisible();
      expect(screen.queryByRole("button", { name: /Łoś/ })).toBeNull();
    } finally {
      restore();
    }
  });

  it("searches every person, not only the ones rendered so far", async () => {
    const many = Array.from({ length: 120 }, (_, index) => ({
      userId: `bulk-${index}`,
      user: { name: `Person ${String(index).padStart(3, "0")}`, image: null },
    }));
    const restore = withMembers(many);
    try {
      const search = await openPopover();
      // Only the first page is rendered without a query.
      expect(screen.queryByRole("button", { name: /Person 119/ })).toBeNull();

      fireEvent.change(search, { target: { value: "person 119" } });
      expect(screen.getByRole("button", { name: /Person 119/ })).toBeVisible();
    } finally {
      restore();
    }
  });

  it("filters resources with the same query and shows an empty state", async () => {
    const search = await openPopover();

    fireEvent.change(search, { target: { value: "dri" } });
    expect(screen.getByRole("button", { name: /Drill/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Alice/ })).toBeNull();

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("tasks:picker.noResults")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Drill/ })).toBeNull();
  });

  it("toggles the first match on Enter", async () => {
    updateTaskAssignees.mockResolvedValue(undefined);
    const search = await openPopover();

    fireEvent.change(search, { target: { value: "bo" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(updateTaskAssignees).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ["u1", "u2"] }),
    );
  });

  it("starts with an empty query every time it opens", async () => {
    const search = await openPopover();
    fireEvent.change(search, { target: { value: "bo" } });

    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("tasks:picker.search")).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));

    const reopened = await screen.findByPlaceholderText("tasks:picker.search");
    expect((reopened as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: /Alice/ })).toBeVisible();
  });
});
