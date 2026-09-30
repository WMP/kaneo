import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CreateTaskModal from "./create-task-modal";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function createWrapper() {
  const queryClient = createTestQueryClient();

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const useLocation = vi.fn();
const deleteTask = vi.fn(async () => {});
const updateTask = vi.fn(async (input: Record<string, unknown>) => input);
const updateTaskAssignees = vi.fn(async () => ({}));
const setProject = vi.fn();
let workspaceId = "workspace-1";
let projects: { id: string; name: string; slug: string }[] | undefined;
let workspaceMembers: Array<{
  userId: string;
  user: { name: string; image: string | null };
}> = [];
let workspaceResources: Array<{
  id: string;
  workspaceId: string;
  kind: "person" | "equipment" | "material";
  name: string;
  email: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}> = [];
let storedProject: { id: string; columns: unknown[] } | null = null;
let ensureTaskId: (() => Promise<string | null>) | undefined;

beforeEach(() => {
  workspaceId = "workspace-1";
  projects = [
    { id: "project-1", name: "Alpha", slug: "alp" },
    { id: "project-2", name: "Beta", slug: "bet" },
  ];
  workspaceMembers = [];
  workspaceResources = [];
  storedProject = null;
  useLocation.mockReturnValue({ pathname: "/dashboard/workspace/workspace-1" });
});
const createTask = vi.fn(async (input: Record<string, unknown>) => ({
  id: "task-1",
  title: input.title,
  status: input.status,
  projectId: input.projectId,
  createdAt: "2026-08-05T00:00:00.000Z",
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  projectPermissions.byProject = {};
});

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => useLocation(),
  useParams: ({
    select,
  }: {
    select: (params: { workspaceId?: string }) => unknown;
  }) =>
    select({
      workspaceId: useLocation().pathname.match(/\/workspace\/([^/]+)/)?.[1],
    }),
}));

vi.mock("@/components/task/task-description-editor", () => ({
  default: (props: {
    taskId?: string;
    ensureTaskId: () => Promise<string | null>;
  }) => {
    ensureTaskId = props.ensureTaskId;
    return <div data-testid="description-editor" data-task-id={props.taskId} />;
  },
}));

vi.mock("@/hooks/mutations/label/use-create-label", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-create-task", () => ({
  default: () => ({ mutateAsync: createTask }),
}));

vi.mock("@/hooks/mutations/task/use-delete-task", () => ({
  useDeleteTask: () => ({ mutateAsync: deleteTask }),
}));

vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutateAsync: updateTask }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-assignees", () => ({
  useUpdateTaskAssignees: () => ({ mutateAsync: updateTaskAssignees }),
}));

vi.mock("@/hooks/queries/label/use-get-labels-by-workspace", () => ({
  default: () => ({ data: [] }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: workspaceId, name: "WS" } }),
}));

vi.mock("@/hooks/queries/project-member/use-project-members", () => ({
  useProjectMembers: () => ({ data: { members: workspaceMembers } }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateTasks: () => true,
    canCreateLabels: () => true,
    canUpdateProjects: () => true,
  }),
}));
// Per project: what the API said about the caller's rights in it.
const projectPermissions = vi.hoisted(() => ({
  byProject: {} as Record<
    string,
    {
      canCreate?: boolean;
      canInvite?: boolean;
      checking?: boolean;
      failed?: boolean;
    }
  >,
}));
vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: (projectId: string) => {
    const state = projectPermissions.byProject[projectId] ?? {};
    const allowed = state.canCreate ?? true;
    return {
      canCreateTasks: () => allowed && !state.failed && !state.checking,
      canCreateLabels: () => allowed,
      canInviteToProject: () => state.canInvite ?? true,
      isCheckingPermissions: state.checking ?? false,
      isError: state.failed ?? false,
    };
  },
}));

vi.mock("@/hooks/queries/resource/use-get-workspace-resources", () => ({
  default: () => ({ data: workspaceResources }),
}));

// The real dialog loads roles and projects; what matters here is what the
// modal hands it and that it stays open, nested in the modal, after the picker
// closes. The stand-in opens a real dialog popup like the original does.
const inviteDialog = vi.fn();
vi.mock("@/components/resource/resource-invite-dialog", async () => {
  const { Dialog, DialogPopup, DialogTitle } = await import(
    "@/components/ui/dialog"
  );
  return {
    default: (props: {
      resource: { name: string };
      workspaceId: string;
      defaultProjectIds?: string[];
      canLink: boolean;
      onClose: () => void;
    }) => {
      inviteDialog(props);
      return (
        <Dialog open onOpenChange={(next) => !next && props.onClose()}>
          <DialogPopup>
            <DialogTitle>{`invite ${props.resource.name}`}</DialogTitle>
            <button type="button" onClick={props.onClose}>
              close-invite
            </button>
          </DialogPopup>
        </Dialog>
      );
    },
  };
});

vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: projects }),
}));

vi.mock("@/store/project", () => ({
  default: () => ({ project: storedProject, setProject }),
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

describe("CreateTaskModal", () => {
  it("keeps unsaved input while discard confirmation is open", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    const onClose = vi.fn();

    render(<CreateTaskModal open onClose={onClose} />, {
      wrapper: createWrapper(),
    });

    const titleInput = screen.getByPlaceholderText(
      "common:modals.createTask.taskTitlePlaceholder",
    );
    fireEvent.change(titleInput, { target: { value: "Unsaved task" } });

    const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
    expect(backdrop).not.toBeNull();
    fireEvent.pointerDown(backdrop as Element);
    fireEvent.pointerUp(backdrop as Element);
    fireEvent.click(backdrop as Element);

    expect(onClose).not.toHaveBeenCalled();
    expect(
      await screen.findByText("common:modals.createTask.discardTitle"),
    ).toBeTruthy();
    expect(titleInput).toHaveValue("Unsaved task");

    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });

    expect(createTask).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes after the user confirms discarding unsaved input", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    const onClose = vi.fn();

    render(<CreateTaskModal open onClose={onClose} />, {
      wrapper: createWrapper(),
    });

    fireEvent.change(
      screen.getByPlaceholderText(
        "common:modals.createTask.taskTitlePlaceholder",
      ),
      { target: { value: "Unsaved task" } },
    );
    const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
    fireEvent.pointerDown(backdrop as Element);
    fireEvent.pointerUp(backdrop as Element);
    fireEvent.click(backdrop as Element);

    await screen.findByText("common:modals.createTask.discardTitle");

    fireEvent.click(screen.getByText("common:modals.createTask.discardButton"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("treats a selected project as unsaved input", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1",
    });

    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(screen.getByText("common:modals.createTask.selectProject"));
    fireEvent.click(await screen.findByText("Beta"));
    const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
    fireEvent.pointerDown(backdrop as Element);
    fireEvent.pointerUp(backdrop as Element);
    fireEvent.click(backdrop as Element);

    expect(
      await screen.findByText("common:modals.createTask.discardTitle"),
    ).toBeTruthy();
  });

  it("shows a project picker and creates the task in the chosen project", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1",
    });

    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    const pickerTrigger = screen.getByText(
      "common:modals.createTask.selectProject",
    );
    fireEvent.click(pickerTrigger);
    fireEvent.click(await screen.findByText("Beta"));

    fireEvent.change(
      screen.getByPlaceholderText(
        "common:modals.createTask.taskTitlePlaceholder",
      ),
      { target: { value: "Picked project task" } },
    );
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Picked project task",
          projectId: "project-2",
        }),
      );
    });
  });

  describe("when the chosen project does not allow creating tasks", () => {
    const createButton = () =>
      screen.getByRole("button", {
        name: "common:modals.createTask.createButton",
      });

    // The picker's trigger shows the chosen project (or the prompt).
    async function pick(name: string) {
      if (!screen.queryByRole("button", { name })) {
        const trigger = document.querySelector(
          "button.rounded-md.border-border",
        ) as HTMLElement;
        fireEvent.click(trigger);
      }
      fireEvent.click(await screen.findByRole("button", { name }));
    }

    it("keeps the dialog, explains why and lets the person pick another project", async () => {
      projectPermissions.byProject = { "project-2": { canCreate: false } };
      useLocation.mockReturnValue({
        pathname: "/dashboard/workspace/workspace-1",
      });
      render(<CreateTaskModal open onClose={vi.fn()} />, {
        wrapper: createWrapper(),
      });
      enterTitle();

      await pick("Beta");
      expect(
        screen.getByPlaceholderText(
          "common:modals.createTask.taskTitlePlaceholder",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "common:modals.createTask.noCreatePermission",
      );
      expect(createButton()).toBeDisabled();

      await pick("Alpha");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(createButton()).toBeEnabled();
    });

    it("says so when the permissions cannot be read", async () => {
      projectPermissions.byProject = { "project-2": { failed: true } };
      useLocation.mockReturnValue({
        pathname: "/dashboard/workspace/workspace-1",
      });
      render(<CreateTaskModal open onClose={vi.fn()} />, {
        wrapper: createWrapper(),
      });
      enterTitle();

      await pick("Beta");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "common:modals.createTask.permissionsUnavailable",
      );
      expect(createButton()).toBeDisabled();
    });

    it("disables Create while the project's permissions load, without an error", async () => {
      projectPermissions.byProject = { "project-2": { checking: true } };
      useLocation.mockReturnValue({
        pathname: "/dashboard/workspace/workspace-1",
      });
      render(<CreateTaskModal open onClose={vi.fn()} />, {
        wrapper: createWrapper(),
      });
      enterTitle();

      await pick("Beta");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(createButton()).toBeDisabled();
      fireEvent.submit(document.querySelector("form") as HTMLFormElement);
      expect(createTask).not.toHaveBeenCalled();
    });
  });

  it("hides the picker when a project is in scope from the route", () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });

    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    expect(
      screen.queryByText("common:modals.createTask.selectProject"),
    ).toBeNull();
  });
});

function enterTitle(title = "Private task") {
  fireEvent.change(
    screen.getByPlaceholderText(
      "common:modals.createTask.taskTitlePlaceholder",
    ),
    {
      target: { value: title },
    },
  );
}

async function chooseBeta() {
  fireEvent.click(screen.getByText("common:modals.createTask.selectProject"));
  fireEvent.click(await screen.findByText("Beta"));
}

function submit() {
  fireEvent.submit(document.querySelector("form") as HTMLFormElement);
}

function pendingCreate() {
  let resolve!: (task: never) => void;
  createTask.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  return () =>
    resolve({
      id: "old-draft",
      title: "Draft",
      status: "planned",
      projectId: "project-2",
      createdAt: "2026-08-05T00:00:00.000Z",
    } as never);
}

describe("CreateTaskModal context isolation", () => {
  it("never falls back to the last globally visited project", () => {
    storedProject = { id: "foreign-project", columns: [] };
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    enterTitle();
    expect(
      screen.getByText("common:modals.createTask.createButton"),
    ).toBeDisabled();
    submit();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("clears selected project and private fields after close and reopen", async () => {
    const props = { open: true, onClose: vi.fn() };
    const view = render(<CreateTaskModal {...props} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    view.rerender(<CreateTaskModal {...props} open={false} />);
    view.rerender(<CreateTaskModal {...props} />);
    expect(
      screen.getByPlaceholderText(
        "common:modals.createTask.taskTitlePlaceholder",
      ),
    ).toHaveValue("");
    enterTitle("New task");
    submit();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("clears workspace A's selection when workspace B becomes active", async () => {
    const view = render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    workspaceId = "workspace-2";
    projects = [{ id: "project-3", name: "Gamma", slug: "gam" }];
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-2",
    });
    view.rerender(<CreateTaskModal open onClose={vi.fn()} />);
    enterTitle("Workspace B secret");
    submit();
    expect(createTask).not.toHaveBeenCalled();
    expect(
      screen.getByText("common:modals.createTask.selectProject"),
    ).toBeInTheDocument();
  });

  it("does not expose the previous workspace while the route's workspace is loading", async () => {
    const view = render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-2",
    });
    view.rerender(<CreateTaskModal open onClose={vi.fn()} />);
    expect(screen.queryByTestId("description-editor")).toBeNull();
    expect(createTask).not.toHaveBeenCalled();
  });

  it.each([undefined, []])(
    "rejects explicit project IDs until current workspace query proves membership (%s)",
    async (data) => {
      projects = data;
      render(<CreateTaskModal open projectId="project-2" onClose={vi.fn()} />, {
        wrapper: createWrapper(),
      });
      enterTitle();
      submit();
      await expect(ensureTaskId?.()).resolves.toBeNull();
      expect(createTask).not.toHaveBeenCalled();
    },
  );

  it("deletes a late draft after navigation without handing its ID to an upload", async () => {
    const finish = pendingCreate();
    const view = render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    let pending!: Promise<string | null>;
    act(() => {
      pending = ensureTaskId?.() as Promise<string | null>;
    });
    workspaceId = "workspace-2";
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-2",
    });
    view.rerender(<CreateTaskModal open onClose={vi.fn()} />);
    await act(async () => {
      finish();
      await pending;
    });
    await expect(pending).resolves.toBeNull();
    expect(deleteTask).toHaveBeenCalledExactlyOnceWith("old-draft");
    expect(screen.getByTestId("description-editor")).not.toHaveAttribute(
      "data-task-id",
    );
    expect(updateTask).not.toHaveBeenCalled();
    expect(setProject).not.toHaveBeenCalled();
  });

  it("waits for the upload draft on submit and saves that task only once", async () => {
    const finish = pendingCreate();
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    let pending!: Promise<string | null>;
    act(() => {
      pending = ensureTaskId?.() as Promise<string | null>;
    });
    submit();
    submit();
    expect(updateTask).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await pending;
    });
    await vi.waitFor(() =>
      expect(updateTask).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          id: "old-draft",
          projectId: "project-2",
          title: "Private task",
        }),
      ),
    );
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it("discards an existing draft on close and never puts it into another project's store", async () => {
    storedProject = { id: "project-1", columns: [] };
    const view = render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    await act(async () => {
      await ensureTaskId?.();
    });
    view.rerender(<CreateTaskModal open={false} onClose={vi.fn()} />);
    expect(deleteTask).toHaveBeenCalledExactlyOnceWith("task-1");
    expect(setProject).not.toHaveBeenCalled();
  });
});

describe("CreateTaskModal multiple assignees", () => {
  it("submits the first selected assignee as the primary userId and pushes the rest via the assignees endpoint", async () => {
    workspaceMembers = [
      { userId: "u1", user: { name: "Alice", image: null } },
      { userId: "u2", user: { name: "Bob", image: null } },
    ];
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });

    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(screen.getByText("common:modals.createTask.assign"));
    fireEvent.click(await screen.findByText("Alice"));
    fireEvent.click(screen.getByText("Bob"));

    enterTitle("Task with two assignees");
    submit();

    await vi.waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1" }),
      );
    });

    await vi.waitFor(() => {
      expect(updateTaskAssignees).toHaveBeenCalledWith({
        taskId: "task-1",
        projectId: "project-1",
        userIds: ["u1", "u2"],
        resourceIds: [],
      });
    });
  });

  it("doesn't call the assignees endpoint when only one assignee is selected", async () => {
    workspaceMembers = [{ userId: "u1", user: { name: "Alice", image: null } }];
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });

    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(screen.getByText("common:modals.createTask.assign"));
    fireEvent.click(await screen.findByText("Alice"));

    enterTitle("Task with one assignee");
    submit();

    await vi.waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1" }),
      );
    });

    expect(updateTaskAssignees).not.toHaveBeenCalled();
  });

  it("toggling a selected member back off removes them from the submitted set", async () => {
    workspaceMembers = [
      { userId: "u1", user: { name: "Alice", image: null } },
      { userId: "u2", user: { name: "Bob", image: null } },
    ];
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });

    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(screen.getByText("common:modals.createTask.assign"));
    fireEvent.click(await screen.findByText("Alice"));
    fireEvent.click(screen.getByText("Bob"));
    // Toggle Bob back off before submitting.
    fireEvent.click(screen.getByText("Bob"));

    enterTitle("Task with one assignee after toggling");
    submit();

    await vi.waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1" }),
      );
    });

    expect(updateTaskAssignees).not.toHaveBeenCalled();
  });

  it("assigns a workspace resource alongside the primary user assignee", async () => {
    workspaceMembers = [{ userId: "u1", user: { name: "Alice", image: null } }];
    workspaceResources = [
      {
        id: "r1",
        workspaceId: "workspace-1",
        kind: "equipment",
        name: "Drill",
        email: null,
        userId: null,
        createdAt: "2026-08-05T00:00:00.000Z",
        updatedAt: "2026-08-05T00:00:00.000Z",
      },
    ];
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });

    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(screen.getByText("common:modals.createTask.assign"));
    fireEvent.click(await screen.findByText("Alice"));
    fireEvent.click(screen.getByText("Drill"));

    enterTitle("Task with a resource assignee");
    submit();

    await vi.waitFor(() => {
      expect(updateTaskAssignees).toHaveBeenCalledWith({
        taskId: "task-1",
        projectId: "project-1",
        userIds: ["u1"],
        resourceIds: ["r1"],
      });
    });
  });
});

describe("CreateTaskModal inviting a person resource", () => {
  const inviteLabel = "tasks:popover.assignee.inviteResource";
  const nina = {
    id: "r2",
    workspaceId: "workspace-1",
    kind: "person" as const,
    name: "Nina",
    email: "nina@example.com",
    userId: null,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
  };

  const openPicker = async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    workspaceResources = [nina];

    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(screen.getByText("common:modals.createTask.assign"));
    await screen.findByText("Nina");
  };

  it("opens the invite dialog for the project the task is created in, closing only the picker", async () => {
    await openPicker();

    fireEvent.click(screen.getByRole("button", { name: inviteLabel }));

    expect(
      await screen.findByRole("dialog", { name: "invite Nina" }),
    ).toBeVisible();
    expect(inviteDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({ id: "r2", name: "Nina" }),
        workspaceId: "workspace-1",
        defaultProjectIds: ["project-1"],
        canLink: false,
      }),
    );
    // The picker is closed; the task being written is still there.
    await vi.waitFor(() => expect(screen.queryByText("Nina")).toBeNull());
    expect(
      screen.getByPlaceholderText(
        "common:modals.createTask.taskTitlePlaceholder",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "close-invite" }));
    expect(screen.queryByRole("dialog", { name: "invite Nina" })).toBeNull();
  });

  it("offers no invitation without invitation:create in the project", async () => {
    projectPermissions.byProject["project-1"] = { canInvite: false };
    await openPicker();

    expect(screen.getByText("Nina")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: inviteLabel })).toBeNull();
  });
});
