import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { toast } from "@/lib/toast";
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
let columnsError = false;
let columnsFetching = false;
const refetchColumns = vi.fn();
let projectColumns:
  | { id: string; slug: string; name: string; isFinal: boolean }[]
  | undefined;
let storedProject: { id: string; columns: unknown[] } | null = null;
let uploadAsset: ((file: File) => Promise<unknown>) | undefined;
const stageUpload = vi.fn();
let customFieldDefs: unknown[] | undefined;
vi.mock("@/lib/upload-draft-asset", () => ({
  uploadDraftAsset: (...args: unknown[]) => stageUpload(...args),
}));

beforeEach(() => {
  workspaceId = "workspace-1";
  projects = [
    { id: "project-1", name: "Alpha", slug: "alp" },
    { id: "project-2", name: "Beta", slug: "bet" },
  ];
  workspaceMembers = [];
  workspaceResources = [];
  storedProject = null;
  customFieldDefs = undefined;
  columnsError = false;
  columnsFetching = false;
  refetchColumns.mockImplementation(async () => ({
    data: projectColumns,
    isError: columnsError,
  }));
  projectColumns = [
    { id: "todo", slug: "to-do", name: "To Do", isFinal: false },
  ];
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
    uploadAsset: (file: File) => Promise<unknown>;
    onChange: (value: string) => void;
  }) => {
    uploadAsset = props.uploadAsset;
    return (
      <textarea
        data-testid="description-editor"
        data-task-id={props.taskId}
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
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

vi.mock("@/hooks/queries/label/use-get-labels-by-workspace", () => ({
  default: () => ({ data: [] }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: workspaceId, name: "WS" } }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-assignees", () => ({
  useUpdateTaskAssignees: () => ({ mutateAsync: updateTaskAssignees }),
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
      canUpdate?: boolean;
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
      canUpdateTasks: () => state.canUpdate ?? true,
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
  const { Dialog, DialogPopup, DialogTitle } =
    await import("@/components/ui/dialog");
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

const createTaskRelation = vi.fn(
  async (_input: Record<string, unknown>) => ({}),
);
vi.mock("@/hooks/mutations/task-relation/use-create-task-relation", () => ({
  default: () => ({ mutateAsync: createTaskRelation }),
}));

// The real picker searches tasks through queries; what matters here is what
// the modal does with a pick. The stand-in picks fixed tasks on click.
vi.mock("@/components/task/task-relation-picker", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/task/task-relation-picker")
    >();
  const { Dialog, DialogPopup, DialogTitle } =
    await import("@/components/ui/dialog");
  return {
    ...actual,
    default: (props: {
      open: boolean;
      projectId: string;
      excludedTaskIds: ReadonlySet<string>;
      onPick: (pick: unknown) => boolean | Promise<boolean>;
      onOpenChange: (open: boolean) => void;
    }) =>
      props.open ? (
        <Dialog open onOpenChange={props.onOpenChange}>
          <DialogPopup>
            <DialogTitle>relation-picker</DialogTitle>
            <span data-testid="picker-project">{props.projectId}</span>
            <span data-testid="picker-excluded">
              {[...props.excludedTaskIds].join(",")}
            </span>
            {[
              {
                id: "t-blocker",
                title: "Blocker task",
                relationType: "blocked_by",
                dependencyType: "ss",
                lagDays: 2,
              },
              {
                id: "t-blocked",
                title: "Blocked task",
                relationType: "blocks",
                dependencyType: "fs",
                lagDays: 0,
              },
              {
                id: "t-related",
                title: "Related task",
                relationType: "related",
                dependencyType: "fs",
                lagDays: 0,
              },
            ].map((pick) => (
              <button
                key={pick.id}
                type="button"
                onClick={async () => {
                  const close = await props.onPick({
                    task: {
                      id: pick.id,
                      title: pick.title,
                      number: 7,
                      status: "to-do",
                    },
                    projectSlug: "alp",
                    relationType: pick.relationType,
                    dependencyType: pick.dependencyType,
                    lagDays: pick.lagDays,
                  });
                  if (close) props.onOpenChange(false);
                }}
              >
                {`pick ${pick.title}`}
              </button>
            ))}
          </DialogPopup>
        </Dialog>
      ) : null,
  };
});

vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({
    data: projectColumns,
    isError: columnsError,
    isFetching: columnsFetching,
    refetch: refetchColumns,
  }),
}));

vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-fields-by-project",
  () => ({
    default: () => ({ data: customFieldDefs }),
  }),
);

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
      {
        target: { value: "Unsaved task" },
      },
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
      {
        target: { value: "Picked project task" },
      },
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

  it("creates Home tasks in the first open custom column and shows its name", async () => {
    projectColumns = [
      { id: "done", slug: "done", name: "Finished", isFinal: true },
      {
        id: "ready",
        slug: "ready-for-work",
        name: "Ready for work",
        isFinal: false,
      },
    ];
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    expect(screen.getByText("Ready for work")).toBeInTheDocument();
    enterTitle();
    submit();
    await vi.waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ status: "ready-for-work" }),
      ),
    );
  });

  it("waits for the chosen project's columns before submitting", async () => {
    projectColumns = undefined;
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    expect(
      screen.getByText("common:modals.createTask.createButton"),
    ).toBeDisabled();
    submit();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("uses fresh workflow columns when a cached open column became final", async () => {
    refetchColumns.mockResolvedValue({
      data: [
        { id: "todo", slug: "to-do", name: "Completed", isFinal: true },
        { id: "ready", slug: "ready", name: "Ready", isFinal: false },
      ],
      isError: false,
    });
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    submit();
    await vi.waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ status: "ready" }),
      ),
    );
  });

  it("does not create from cached columns when the submission refresh fails", async () => {
    refetchColumns.mockResolvedValue({ data: projectColumns, isError: true });
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    submit();
    await vi.waitFor(() => expect(refetchColumns).toHaveBeenCalledOnce());
    expect(createTask).not.toHaveBeenCalled();
  });

  it("waits for refreshing cached workflow columns", async () => {
    columnsFetching = true;
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    expect(
      screen.getByText("common:modals.createTask.createButton"),
    ).toBeDisabled();
    submit();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("does not publish after closing during workflow verification", async () => {
    let finish!: (value: unknown) => void;
    refetchColumns.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    submit();
    view.rerender(<CreateTaskModal open={false} onClose={vi.fn()} />);
    await act(async () => {
      finish({ data: projectColumns, isError: false });
    });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("offers a retry when project statuses could not be loaded", async () => {
    projectColumns = undefined;
    columnsError = true;
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "common:modals.createTask.statusLoadError",
    );
    fireEvent.click(screen.getByText("common:error.tryAgain"));
    expect(refetchColumns).toHaveBeenCalledOnce();
    submit();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("uses planned instead of an ambiguous open/final status slug", async () => {
    projectColumns = [
      { id: "done", slug: "shared", name: "Finished", isFinal: true },
      { id: "open", slug: "shared", name: "Open", isFinal: false },
    ];
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    submit();
    await vi.waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ status: "planned" }),
      ),
    );
  });

  it("uses planned when every column is final", async () => {
    projectColumns = [
      { id: "done", slug: "done", name: "Finished", isFinal: true },
    ];
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    submit();
    await vi.waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ status: "planned" }),
      ),
    );
  });

  it("keeps an explicit planned status even when the project has custom columns", async () => {
    projectColumns = [
      { id: "ready", slug: "ready", name: "Ready", isFinal: false },
    ];
    render(<CreateTaskModal open status="planned" onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    submit();
    await vi.waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ status: "planned" }),
      ),
    );
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
      await expect(uploadAsset?.(new File(["x"], "x.png"))).rejects.toThrow();
      expect(createTask).not.toHaveBeenCalled();
    },
  );

  it("stages attachments without creating a task and claims them only on submit", async () => {
    stageUpload.mockResolvedValue({
      id: "staged-1",
      url: "/asset/staged-1",
      kind: "image",
    });
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    await act(async () => {
      await uploadAsset?.(new File(["x"], "x.png"));
    });
    expect(createTask).not.toHaveBeenCalled();
    expect(updateTask).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("description-editor"), {
      target: { value: "![image](/asset/staged-1)" },
    });
    submit();
    await vi.waitFor(() => expect(createTask).toHaveBeenCalledOnce());
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        draftAssetIds: ["staged-1"],
        projectId: "project-2",
      }),
    );
  });

  it("does not submit while attachments are uploading", async () => {
    let finish!: (value: unknown) => void;
    stageUpload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    enterTitle();
    let pending!: Promise<unknown>;
    act(() => {
      pending = uploadAsset!(new File(["x"], "x.png"));
    });
    expect(
      screen.getByText("activity:comment.editor.uploadingFile"),
    ).toBeDisabled();
    submit();
    expect(createTask).not.toHaveBeenCalled();
    await act(async () => {
      finish({ id: "staged-2" });
      await pending;
    });
    submit();
    await vi.waitFor(() => expect(createTask).toHaveBeenCalledOnce());
  });

  it("closing after an upload creates no published task or deletion side effect", async () => {
    stageUpload.mockResolvedValue({ id: "staged-1" });
    const view = render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await chooseBeta();
    await act(async () => {
      await uploadAsset?.(new File(["x"], "x.png"));
    });
    view.rerender(<CreateTaskModal open={false} onClose={vi.fn()} />);
    expect(createTask).not.toHaveBeenCalled();
    expect(deleteTask).not.toHaveBeenCalled();
    expect(setProject).not.toHaveBeenCalled();
  });
});

const customField = (
  id: string,
  type: string,
  required: boolean,
  defaultValue: string | null = null,
) => ({
  id,
  projectId: "project-2",
  name: id,
  type,
  required,
  defaultValue,
  options: null,
  position: 0,
  createdAt: "",
  updatedAt: "",
});

describe("CreateTaskModal custom fields", () => {
  it("flags empty required fields instead of creating, then sends the filled values", async () => {
    customFieldDefs = [
      customField("customer", "text", true),
      customField("billable", "boolean", true, "false"),
      customField("points", "number", false),
    ];
    render(<CreateTaskModal open onClose={vi.fn()} projectId="project-2" />, {
      wrapper: createWrapper(),
    });
    enterTitle();
    submit();

    expect(
      await screen.findByText("tasks:customFields.missingRequired"),
    ).toBeInTheDocument();
    expect(createTask).not.toHaveBeenCalled();
    const customerChip = document.querySelector(
      '[data-custom-field="customer"]',
    ) as HTMLElement;
    expect(document.activeElement).toBe(customerChip);

    fireEvent.click(customerChip);
    const input = await screen.findByLabelText("customer");
    fireEvent.change(input, { target: { value: "Acme Corp" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() =>
      expect(
        screen.queryByText("tasks:customFields.missingRequired"),
      ).not.toBeInTheDocument(),
    );
    submit();
    await vi.waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          customFields: [
            { fieldId: "customer", value: "Acme Corp" },
            { fieldId: "billable", value: "false" },
          ],
        }),
      ),
    );
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

describe("CreateTaskModal effort estimate", () => {
  function renderInProject() {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
  }

  function setTitle(value: string) {
    fireEvent.change(
      screen.getByPlaceholderText(
        "common:modals.createTask.taskTitlePlaceholder",
      ),
      { target: { value } },
    );
  }

  async function setEstimate(amount: string, unit?: "days") {
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:popover.estimate.label" }),
    );
    const input = await screen.findByRole("textbox", {
      name: "tasks:popover.estimate.amountLabel",
    });
    if (unit) {
      fireEvent.click(
        screen.getByRole("button", {
          name: `tasks:popover.estimate.units.${unit}`,
        }),
      );
    }
    fireEvent.change(input, { target: { value: amount } });
    fireEvent.blur(input);
  }

  // The date picker menu lists quick dates first; the first one is enough.
  async function pickFirstDay(chipText: string) {
    fireEvent.click(screen.getByText(chipText));
    const options = await screen.findAllByRole("option");
    fireEvent.click(options[0]);
  }

  it("sends the entered estimate in the create request", async () => {
    renderInProject();
    setTitle("Estimated task");

    await setEstimate("2", "days");
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Estimated task",
          estimateMinutes: 960,
          estimateUnit: "days",
        }),
      );
    });
  });

  it("sends no estimate fields when none was entered", async () => {
    renderInProject();
    setTitle("Plain task");

    fireEvent.submit(document.querySelector("form") as HTMLFormElement);

    await vi.waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    const request = createTask.mock.calls[0]?.[0] ?? {};
    expect(request).not.toHaveProperty("estimateMinutes");
    expect(request).not.toHaveProperty("estimateUnit");
  });

  it("counts an entered estimate as unsaved input", async () => {
    renderInProject();

    await setEstimate("3");
    const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
    fireEvent.pointerDown(backdrop as Element);
    fireEvent.pointerUp(backdrop as Element);
    fireEvent.click(backdrop as Element);

    expect(
      await screen.findByText("common:modals.createTask.discardTitle"),
    ).toBeTruthy();
  });

  it("disables the due date picker once an estimate and a start date are set", async () => {
    renderInProject();

    await setEstimate("1");
    await pickFirstDay("common:modals.createTask.startDate");

    const dueChip = screen.getByRole("button", {
      name: "common:modals.createTask.dueDate",
    });
    expect(dueChip).toBeDisabled();
    expect(
      screen.getByText("tasks:popover.estimate.exclusiveHint"),
    ).toBeInTheDocument();
  });

  it("disables the start date picker when an estimate and a due date are set", async () => {
    renderInProject();

    await setEstimate("1");
    await pickFirstDay("common:modals.createTask.dueDate");

    expect(
      screen.getByRole("button", {
        name: "common:modals.createTask.startDate",
      }),
    ).toBeDisabled();
  });

  it("disables the estimate field with a hint when both dates are set", async () => {
    renderInProject();

    await pickFirstDay("common:modals.createTask.startDate");
    await pickFirstDay("common:modals.createTask.dueDate");

    expect(
      screen.getByRole("button", { name: "tasks:popover.estimate.label" }),
    ).toBeDisabled();
    expect(
      screen.getByText("tasks:popover.estimate.blockedByDates"),
    ).toBeInTheDocument();
  });

  it("keeps both dates pickable while there is no estimate", async () => {
    renderInProject();

    await pickFirstDay("common:modals.createTask.startDate");

    expect(
      screen.getByRole("button", { name: "common:modals.createTask.dueDate" }),
    ).not.toBeDisabled();
  });
});

describe("CreateTaskModal dependencies", () => {
  // The button also shows how many are pending, so match its name loosely.
  const dependenciesLabel = /common:modals\.createTask\.dependencies/;

  function renderInProject() {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
  }

  const pickDependency = async (title: string) => {
    fireEvent.click(
      await screen.findByRole("button", { name: dependenciesLabel }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: `pick ${title}` }),
    );
  };

  it("links the picked dependencies to the new task once it is created", async () => {
    renderInProject();

    await pickDependency("Blocker task");
    await pickDependency("Blocked task");
    await pickDependency("Related task");
    // Nothing is linked while the task does not exist.
    expect(createTaskRelation).not.toHaveBeenCalled();
    // A picked task cannot be picked twice.
    fireEvent.click(
      await screen.findByRole("button", { name: dependenciesLabel }),
    );
    expect((await screen.findByTestId("picker-excluded")).textContent).toBe(
      "t-blocker,t-blocked,t-related",
    );
    expect(screen.getByTestId("picker-project").textContent).toBe("project-1");

    enterTitle("Task with dependencies");
    submit();

    await vi.waitFor(() => expect(createTaskRelation).toHaveBeenCalledTimes(3));
    // "Blocked by": the picked task is the blocker (source).
    expect(createTaskRelation).toHaveBeenNthCalledWith(1, {
      sourceTaskId: "t-blocker",
      targetTaskId: "task-1",
      relationType: "blocks",
      dependencyType: "ss",
      lagDays: 2,
    });
    expect(createTaskRelation).toHaveBeenNthCalledWith(2, {
      sourceTaskId: "task-1",
      targetTaskId: "t-blocked",
      relationType: "blocks",
      dependencyType: "fs",
      lagDays: 0,
    });
    // A plain relation carries no dependency settings.
    expect(createTaskRelation).toHaveBeenNthCalledWith(3, {
      sourceTaskId: "task-1",
      targetTaskId: "t-related",
      relationType: "related",
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("removes a pending dependency before creating", async () => {
    renderInProject();

    await pickDependency("Blocker task");
    await pickDependency("Related task");
    const removeButtons = await screen.findAllByRole("button", {
      name: "common:modals.createTask.removeDependency",
    });
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]);
    expect(screen.queryByText("Blocker task")).toBeNull();

    enterTitle("Task");
    submit();

    await vi.waitFor(() => expect(createTaskRelation).toHaveBeenCalledTimes(1));
    expect(createTaskRelation).toHaveBeenCalledWith(
      expect.objectContaining({ targetTaskId: "t-related" }),
    );
  });

  it("keeps the task and the other links when one link fails, and says which", async () => {
    renderInProject();
    createTaskRelation
      .mockRejectedValueOnce(
        new Error("This dependency would create a circular dependency"),
      )
      .mockResolvedValueOnce({});

    await pickDependency("Blocker task");
    await pickDependency("Blocked task");

    enterTitle("Task with a bad link");
    submit();

    await vi.waitFor(() => expect(createTaskRelation).toHaveBeenCalledTimes(2));
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "common:modals.createTask.dependencyLinkError",
    );
    // The task itself was created and reported as such.
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "common:modals.createTask.successCreated",
        expect.anything(),
      ),
    );
  });

  it("counts pending dependencies as unsaved input", async () => {
    renderInProject();
    await pickDependency("Related task");

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.cancel" }),
    );
    expect(
      await screen.findByText("common:modals.createTask.discardTitle"),
    ).toBeTruthy();
  });

  it("is gone without the right to update tasks in the project", () => {
    projectPermissions.byProject["project-1"] = { canUpdate: false };
    renderInProject();

    expect(
      screen.queryByRole("button", { name: dependenciesLabel }),
    ).toBeNull();
  });

  it("is not offered before a project is chosen", () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1",
    });
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    expect(
      screen.queryByRole("button", { name: dependenciesLabel }),
    ).toBeNull();
  });

  it("clears pending dependencies when 'create more' resets the form", async () => {
    renderInProject();
    fireEvent.click(
      screen.getByLabelText("common:modals.createTask.createMore"),
    );
    await pickDependency("Related task");

    enterTitle("First");
    submit();
    await vi.waitFor(() => expect(createTaskRelation).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(screen.queryByText("Related task")).toBeNull(),
    );

    enterTitle("Second");
    submit();
    await vi.waitFor(() => expect(createTask).toHaveBeenCalledTimes(2));
    expect(createTaskRelation).toHaveBeenCalledTimes(1);
  });
});

describe("CreateTaskModal searchable pickers", () => {
  function renderInProject() {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
  }
  const searchPlaceholder = "tasks:picker.search";

  it("filters assignees by the typed first characters, ignoring case and diacritics", async () => {
    workspaceMembers = [
      { userId: "u1", user: { name: "Alice", image: null } },
      { userId: "u2", user: { name: "Łoś Kowalski", image: null } },
    ];
    renderInProject();

    fireEvent.click(screen.getByText("common:modals.createTask.assign"));
    const search = await screen.findByPlaceholderText(searchPlaceholder);
    expect(screen.getByText("Alice")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "lo" } });
    expect(screen.queryByText("Alice")).toBeNull();
    expect(screen.getByText("Łoś Kowalski")).toBeInTheDocument();
    // Searching hides "Unassigned": it is not a person.
    expect(
      screen.queryByText("common:modals.createTask.assignUnassigned"),
    ).toBeNull();

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("tasks:picker.noResults")).toBeInTheDocument();
  });

  it("filters resources with the same query and picks the first match on Enter", async () => {
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
    renderInProject();

    fireEvent.click(screen.getByText("common:modals.createTask.assign"));
    const search = await screen.findByPlaceholderText(searchPlaceholder);
    fireEvent.change(search, { target: { value: "dri" } });
    expect(screen.queryByText("Alice")).toBeNull();
    expect(screen.getByText("Drill")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "ali" } });
    expect(screen.queryByText("Drill")).toBeNull();
    fireEvent.keyDown(search, { key: "Enter" });

    enterTitle("Task");
    submit();
    await vi.waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1" }),
      ),
    );
  });

  it("filters the project picker and the priority picker", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1",
    });
    render(<CreateTaskModal open onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(screen.getByText("common:modals.createTask.selectProject"));
    const projectSearch = await screen.findByPlaceholderText(searchPlaceholder);
    fireEvent.change(projectSearch, { target: { value: "be" } });
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    fireEvent.change(projectSearch, { target: { value: "nope" } });
    expect(screen.getByText("tasks:picker.noResults")).toBeInTheDocument();
  });
});
