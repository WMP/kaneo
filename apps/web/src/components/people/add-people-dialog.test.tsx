import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectMemberError } from "@/lib/project-member-error";
import { WorkspaceMemberError } from "@/lib/workspace-role-error";
import AddPeopleDialog from "./add-people-dialog";

const success = vi.fn();
const error = vi.fn();
const warning = vi.fn();
const onClose = vi.fn();

const addWorkspaceMember = vi.fn();
const addProjectMember = vi.fn();
const inviteWorkspaceUser = vi.fn();
const createProjectInvitation = vi.fn();

type Person = { id: string; name: string; email: string; image: null };
type Roles = { role: string; isDefault: boolean }[] | undefined;
type RolesState = { data: Roles; isLoading: boolean; isError: boolean };

const WORKSPACE_ROLES: Roles = [
  { role: "viewer", isDefault: true },
  { role: "member", isDefault: true },
  { role: "qa-lead", isDefault: false },
];
const PROJECT_ROLES: Roles = [
  { role: "viewer", isDefault: true },
  { role: "member", isDefault: true },
  { role: "tester", isDefault: false },
];

let config: { hasSmtp: boolean; userDirectoryEnabled: boolean } | undefined;
let workspaceRoles: RolesState;
let projectRoles: RolesState;
let candidates: { data: Person[] | undefined; isError?: boolean };
let directory: {
  data: Person[] | undefined;
  isFetching: boolean;
  isError: boolean;
};
const useSearchUserDirectory = vi.fn(
  (_workspaceId: string | undefined, _query: string, _options: unknown) =>
    directory,
);
const useGetMemberCandidates = vi.fn(
  (_projectId: string | undefined, _options: unknown) => ({
    ...candidates,
    isLoading: false,
    isError: candidates.isError ?? false,
    refetch: vi.fn(),
  }),
);

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (msg: string) => success(msg),
    error: (msg: string) => error(msg),
    warning: (msg: string) => warning(msg),
  },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.email ? `${key}|${options.email}` : key,
  }),
}));

vi.mock("@/hooks/use-debounced-value", () => ({
  useDebouncedValue: (value: unknown) => value,
}));

vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: config }),
}));

vi.mock("@/hooks/queries/workspace/use-get-assignable-roles", () => ({
  default: () => ({ ...workspaceRoles, refetch: vi.fn() }),
}));
vi.mock(
  "@/hooks/queries/project-member/use-get-project-assignable-roles",
  () => ({ default: () => ({ ...projectRoles, refetch: vi.fn() }) }),
);
vi.mock("@/hooks/queries/project-member/use-get-member-candidates", () => ({
  default: (projectId: string | undefined, options: unknown) =>
    useGetMemberCandidates(projectId, options),
}));
vi.mock("@/hooks/queries/workspace/use-search-user-directory", () => ({
  USER_DIRECTORY_MIN_QUERY_LENGTH: 2,
  default: (workspaceId: string | undefined, query: string, options: unknown) =>
    useSearchUserDirectory(workspaceId, query, options),
}));

vi.mock("@/hooks/mutations/workspace/use-add-workspace-member", () => ({
  default: () => ({ mutateAsync: addWorkspaceMember }),
}));
vi.mock("@/hooks/mutations/project-member/use-add-project-member", () => ({
  default: () => ({ mutateAsync: addProjectMember }),
}));
vi.mock("@/hooks/mutations/workspace-user/use-invite-workspace-user", () => ({
  default: () => ({ mutateAsync: inviteWorkspaceUser }),
}));
vi.mock(
  "@/hooks/mutations/project-invitation/use-create-project-invitation",
  () => ({ default: () => ({ mutateAsync: createProjectInvitation }) }),
);

vi.mock("@/components/team/invitation-link-field", () => ({
  default: ({ invitationId }: { invitationId: string }) => (
    <div>link:{invitationId}</div>
  ),
}));

const ada: Person = {
  id: "u-ada",
  name: "Ada Lovelace",
  email: "ada@example.com",
  image: null,
};
const grace: Person = {
  id: "u-grace",
  name: "Grace Hopper",
  email: "grace@example.com",
  image: null,
};
const carol: Person = {
  id: "u-carol",
  name: "Carol Workspace",
  email: "carol@example.com",
  image: null,
};

type Props = React.ComponentProps<typeof AddPeopleDialog>;

function renderWorkspace(props: Partial<Props> = {}) {
  return render(
    <AddPeopleDialog
      open
      onClose={onClose}
      context={{ kind: "workspace", workspaceId: "workspace-1" }}
      canAdd
      canInvite
      {...props}
    />,
  );
}

function renderProject(props: Partial<Props> = {}) {
  return render(
    <AddPeopleDialog
      open
      onClose={onClose}
      context={{
        kind: "project",
        workspaceId: "workspace-1",
        projectId: "project-1",
      }}
      canAdd
      canInvite
      canAddToWorkspace
      {...props}
    />,
  );
}

const field = () => screen.findByPlaceholderText("people:add.placeholder");

async function type(value: string) {
  fireEvent.change(await field(), { target: { value } });
}

const option = (name: string | RegExp) => screen.findByRole("option", { name });

async function choose(label: string, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const item = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerDown(item);
  fireEvent.click(item, { detail: 1 });
}

const submitButton = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  config = { hasSmtp: true, userDirectoryEnabled: true };
  workspaceRoles = { data: WORKSPACE_ROLES, isLoading: false, isError: false };
  projectRoles = { data: PROJECT_ROLES, isLoading: false, isError: false };
  candidates = { data: [carol] };
  directory = { data: [ada, grace], isFetching: false, isError: false };
  addWorkspaceMember.mockResolvedValue({
    emailAttempted: true,
    emailSent: true,
  });
  addProjectMember.mockResolvedValue({
    emailAttempted: false,
    emailSent: false,
    workspaceMemberAdded: false,
  });
  inviteWorkspaceUser.mockResolvedValue({ id: "inv-ws" });
  createProjectInvitation.mockResolvedValue({
    created: true,
    invitation: { id: "inv-pr", emailAttempted: true, emailSent: true },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AddPeopleDialog in a workspace", () => {
  it("suggests accounts from the user directory as you type and adds the picked one at once", async () => {
    renderWorkspace();

    await type("ad");
    expect(useSearchUserDirectory).toHaveBeenLastCalledWith(
      "workspace-1",
      "ad",
      { enabled: true },
    );
    fireEvent.click(await option(/Ada Lovelace/));

    // The role picker appears; `member` is preselected.
    expect(
      screen.getByRole("combobox", { name: "people:add.workspaceRoleLabel" }),
    ).toHaveTextContent("team:roles.member");
    expect(
      screen.queryByRole("combobox", {
        name: "people:add.projectRoleLabel",
      }),
    ).toBeNull();
    fireEvent.click(submitButton("people:add.add"));

    await waitFor(() =>
      expect(addWorkspaceMember).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        userId: "u-ada",
        role: "member",
      }),
    );
    expect(success).toHaveBeenCalledWith("people:add.addedEmailed");
    expect(onClose).toHaveBeenCalled();
    // Adding is immediate: no invitation is created.
    expect(inviteWorkspaceUser).not.toHaveBeenCalled();
  });

  it("adds with the role the caller picked", async () => {
    renderWorkspace();
    await type("ad");
    fireEvent.click(await option(/Ada Lovelace/));

    await choose("people:add.workspaceRoleLabel", "Qa-Lead");
    fireEvent.click(submitButton("people:add.add"));

    await waitFor(() =>
      expect(addWorkspaceMember).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        userId: "u-ada",
        role: "qa-lead",
      }),
    );
  });

  it("does not claim an email when there was none, and warns when it failed", async () => {
    addWorkspaceMember.mockResolvedValueOnce({
      emailAttempted: false,
      emailSent: false,
    });
    renderWorkspace();
    await type("ad");
    fireEvent.click(await option(/Ada Lovelace/));
    fireEvent.click(submitButton("people:add.add"));
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("people:add.added"),
    );

    cleanup();
    vi.clearAllMocks();
    addWorkspaceMember.mockResolvedValueOnce({
      emailAttempted: true,
      emailSent: false,
    });
    renderWorkspace();
    await type("gr");
    fireEvent.click(await option(/Grace Hopper/));
    fireEvent.click(submitButton("people:add.add"));
    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith("people:add.addedEmailFailed"),
    );
  });

  it("offers an invitation for a valid email nobody matches, and shows the link afterwards", async () => {
    directory = { data: [], isFetching: false, isError: false };
    renderWorkspace();

    await type("new.person@example.com");
    fireEvent.click(await option(/people:add\.inviteOption/));

    expect(
      screen.getByText("people:add.willInvite|new.person@example.com"),
    ).toBeVisible();
    fireEvent.click(submitButton("people:add.sendInvitation"));

    await waitFor(() =>
      expect(inviteWorkspaceUser).toHaveBeenCalledWith({
        email: "new.person@example.com",
        workspaceId: "workspace-1",
        role: "member",
      }),
    );
    expect(addWorkspaceMember).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith("team:inviteModal.success");
    // The dialog stays open on the copyable link.
    expect(await screen.findByText("link:inv-ws")).toBeVisible();
    expect(screen.getByText("team:inviteModal.createdTitle")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "team:inviteModal.done" }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("tells the truth about email delivery of an invitation", async () => {
    config = { hasSmtp: false, userDirectoryEnabled: true };
    directory = { data: [], isFetching: false, isError: false };
    renderWorkspace();

    await type("new@example.com");
    fireEvent.click(await option(/people:add\.inviteOption/));
    expect(screen.getByText("team:inviteModal.noSmtpNotice")).toBeVisible();
    fireEvent.click(submitButton("people:add.sendInvitation"));

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("team:inviteModal.successNoEmail"),
    );
    expect(
      await screen.findByText(
        "team:inviteModal.shareLinkDescriptionNoEmail|new@example.com",
      ),
    ).toBeVisible();
  });

  it("does not offer to invite an address that matches an account, it offers the account", async () => {
    renderWorkspace();

    await type("ada@example.com");

    expect(await option(/Ada Lovelace/)).toBeVisible();
    expect(
      screen.queryByRole("option", { name: /people:add\.inviteOption/ }),
    ).toBeNull();
  });

  it("holds back the invitation option while the directory answer is still loading", async () => {
    directory = { data: undefined, isFetching: true, isError: false };
    renderWorkspace();

    await type("new@example.com");

    expect(screen.getByText("people:add.searching")).toBeVisible();
    expect(
      screen.queryByRole("option", { name: /people:add\.inviteOption/ }),
    ).toBeNull();
  });

  it("still offers the invitation when the directory search failed", async () => {
    directory = { data: undefined, isFetching: false, isError: true };
    renderWorkspace();

    await type("new@example.com");

    expect(screen.getByText("people:add.searchError")).toBeVisible();
    expect(await option(/people:add\.inviteOption/)).toBeVisible();
  });

  it("with the directory switched off, asks only for an email and never searches", async () => {
    config = { hasSmtp: true, userDirectoryEnabled: false };
    renderWorkspace();

    expect(await screen.findByText("people:add.hintInviteOnly")).toBeVisible();
    await type("ad");
    expect(useSearchUserDirectory).toHaveBeenLastCalledWith(
      "workspace-1",
      "ad",
      { enabled: false },
    );
    // The hook's stale data is not shown.
    expect(screen.queryByRole("option", { name: /Ada Lovelace/ })).toBeNull();
    expect(screen.getByText("people:add.noMatchesInvite")).toBeVisible();

    await type("new@example.com");
    expect(await option(/people:add\.inviteOption/)).toBeVisible();
  });

  it("without the right to add, offers invitations only", async () => {
    renderWorkspace({ canAdd: false });

    await type("ad");
    expect(useSearchUserDirectory).toHaveBeenLastCalledWith(
      "workspace-1",
      "ad",
      { enabled: false },
    );
    expect(screen.queryByRole("option", { name: /Ada Lovelace/ })).toBeNull();
  });

  it("without the right to invite, never offers an invitation", async () => {
    directory = { data: [], isFetching: false, isError: false };
    renderWorkspace({ canInvite: false });

    await type("new@example.com");

    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.getByText("people:add.noMatches")).toBeVisible();
  });

  it("does not submit without a workspace role, and never picks one silently", async () => {
    workspaceRoles = {
      data: [{ role: "qa-lead", isDefault: false }],
      isLoading: false,
      isError: false,
    };
    renderWorkspace();
    await type("ad");
    fireEvent.click(await option(/Ada Lovelace/));

    expect(
      screen.getByText("people:add.roles.workspacePickRequired"),
    ).toBeVisible();
    expect(submitButton("people:add.add")).toBeDisabled();

    await choose("people:add.workspaceRoleLabel", "Qa-Lead");
    expect(submitButton("people:add.add")).toBeEnabled();
  });

  it("lets the caller change the pick", async () => {
    renderWorkspace();
    await type("ad");
    fireEvent.click(await option(/Ada Lovelace/));

    fireEvent.click(screen.getByRole("button", { name: "people:add.change" }));

    expect(await field()).toHaveValue("ad");
    expect(await option(/Grace Hopper/)).toBeVisible();
  });

  it("Enter picks the first suggestion and never submits", async () => {
    renderWorkspace();
    await type("a");
    // One character is too short for a search: nothing to pick.
    fireEvent.keyDown(await field(), { key: "Enter" });
    expect(screen.queryByRole("combobox")).toBeNull();

    await type("ad");
    fireEvent.keyDown(await field(), { key: "Enter" });
    expect(
      await screen.findByRole("combobox", {
        name: "people:add.workspaceRoleLabel",
      }),
    ).toBeVisible();
    expect(addWorkspaceMember).not.toHaveBeenCalled();
  });

  it("maps API errors of the add to translated messages", async () => {
    for (const [code, key] of [
      [
        "ROLE_EXCEEDS_YOUR_PERMISSIONS",
        "projectMembers:errors.roleExceedsYourPermissions",
      ],
      [
        "ALREADY_WORKSPACE_MEMBER",
        "projectInvitations:errors.alreadyWorkspaceMember",
      ],
      ["USER_NOT_FOUND", "people:errors.userNotFound"],
      ["USER_CANNOT_BE_ADDED", "people:errors.userCannotBeAdded"],
    ] as const) {
      cleanup();
      vi.clearAllMocks();
      addWorkspaceMember.mockRejectedValueOnce(
        new ProjectMemberError("raw english", { code, status: 403 }),
      );
      renderWorkspace();
      await type("ad");
      fireEvent.click(await option(/Ada Lovelace/));
      fireEvent.click(submitButton("people:add.add"));
      await waitFor(() => expect(error).toHaveBeenCalledWith(key));
      expect(onClose).not.toHaveBeenCalled();
    }
  });

  it("falls back to the generic message for an error without a code", async () => {
    addWorkspaceMember.mockRejectedValueOnce(
      new ProjectMemberError("", { status: 500 }),
    );
    renderWorkspace();
    await type("ad");
    fireEvent.click(await option(/Ada Lovelace/));
    fireEvent.click(submitButton("people:add.add"));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("people:add.addError"),
    );
  });

  it("maps a Better Auth invitation error and offers the pick again", async () => {
    directory = { data: [], isFetching: false, isError: false };
    inviteWorkspaceUser.mockRejectedValueOnce(
      new WorkspaceMemberError("raw", { code: "INVITATION_LIMIT_REACHED" }),
    );
    renderWorkspace();
    await type("new@example.com");
    fireEvent.click(await option(/people:add\.inviteOption/));
    fireEvent.click(submitButton("people:add.sendInvitation"));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("team:errors.invitationLimitReached"),
    );
    // Still on the pick, so it can be retried.
    expect(submitButton("people:add.sendInvitation")).toBeEnabled();
  });

  it("says so when the invited address already belongs to a member", async () => {
    directory = { data: [], isFetching: false, isError: false };
    inviteWorkspaceUser.mockRejectedValueOnce(
      new WorkspaceMemberError("raw", {
        code: "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
      }),
    );
    renderWorkspace();
    await type("member@example.com");
    fireEvent.click(await option(/people:add\.inviteOption/));
    fireEvent.click(submitButton("people:add.sendInvitation"));

    expect(
      await screen.findByText(
        "projectInvitations:errors.alreadyWorkspaceMember",
      ),
    ).toBeVisible();
    expect(error).not.toHaveBeenCalled();
  });

  it("starts from a prefilled invitation for 'Invite again'", async () => {
    directory = { data: [], isFetching: false, isError: false };
    renderWorkspace({
      prefill: { email: "Old@Example.com", workspaceRole: "qa-lead" },
    });

    expect(
      await screen.findByText("people:add.willInvite|old@example.com"),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "people:add.workspaceRoleLabel" }),
    ).toHaveTextContent("Qa-Lead");
    fireEvent.click(submitButton("people:add.sendInvitation"));
    await waitFor(() =>
      expect(inviteWorkspaceUser).toHaveBeenCalledWith({
        email: "old@example.com",
        workspaceId: "workspace-1",
        role: "qa-lead",
      }),
    );
  });

  it("renders nothing and does not search while closed", () => {
    renderWorkspace({ open: false });

    expect(screen.queryByText("people:add.title")).toBeNull();
    expect(useSearchUserDirectory).toHaveBeenLastCalledWith("workspace-1", "", {
      enabled: false,
    });
  });
});

describe("AddPeopleDialog in a project", () => {
  it("lists workspace members without access right away and filters them as you type", async () => {
    candidates = { data: [carol, { ...grace, id: "u-g2" }] };
    directory = { data: [], isFetching: false, isError: false };
    renderProject();

    expect(await option(/Carol Workspace/)).toBeVisible();
    expect(screen.getByRole("option", { name: /Grace Hopper/ })).toBeVisible();

    await type("carol");
    expect(await option(/Carol Workspace/)).toBeVisible();
    expect(screen.queryByRole("option", { name: /Grace Hopper/ })).toBeNull();
  });

  it("adds a workspace member with the project role only", async () => {
    renderProject();
    fireEvent.click(await option(/Carol Workspace/));

    // Only the project role is asked: the person is in the workspace already.
    expect(
      screen.getByRole("combobox", { name: "people:add.projectRoleLabel" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("combobox", { name: "people:add.workspaceRoleLabel" }),
    ).toBeNull();
    await choose("people:add.projectRoleLabel", "Tester");
    fireEvent.click(submitButton("people:add.add"));

    await waitFor(() =>
      expect(addProjectMember).toHaveBeenCalledWith({
        projectId: "project-1",
        userId: "u-carol",
        role: "tester",
      }),
    );
    expect(success).toHaveBeenCalledWith("people:add.added");
    expect(onClose).toHaveBeenCalled();
  });

  it("adds an account that is not in the workspace to the workspace and the project in one step", async () => {
    addProjectMember.mockResolvedValueOnce({
      workspaceMemberAdded: true,
      emailAttempted: true,
      emailSent: true,
    });
    renderProject();
    await type("ad");
    fireEvent.click(await option(/Ada Lovelace/));

    // Both roles are asked, and the account arrives as a directory pick.
    expect(
      screen.getByRole("combobox", { name: "people:add.workspaceRoleLabel" }),
    ).toHaveTextContent("team:roles.member");
    expect(
      screen.getByRole("combobox", { name: "people:add.projectRoleLabel" }),
    ).toHaveTextContent("team:roles.member");
    await choose("people:add.workspaceRoleLabel", "Qa-Lead");
    fireEvent.click(submitButton("people:add.add"));

    await waitFor(() =>
      expect(addProjectMember).toHaveBeenCalledWith({
        projectId: "project-1",
        userId: "u-ada",
        role: "member",
        workspaceRole: "qa-lead",
      }),
    );
    expect(addWorkspaceMember).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith("people:add.addedEmailed");
  });

  it("groups the suggestions and never offers a workspace member twice", async () => {
    directory = {
      data: [carol, ada],
      isFetching: false,
      isError: false,
    };
    renderProject();
    await type("a");
    await type("ar");

    const listbox = await screen.findByRole("listbox");
    const workspaceGroup = within(listbox).getByRole("group", {
      name: "people:add.groups.workspace",
    });
    expect(within(workspaceGroup).getByText("Carol Workspace")).toBeVisible();
    const directoryGroup = within(listbox).getByRole("group", {
      name: "people:add.groups.directory",
    });
    expect(within(directoryGroup).getByText("Ada Lovelace")).toBeVisible();
    expect(within(directoryGroup).queryByText("Carol Workspace")).toBeNull();
  });

  it("does not offer the directory without the right to add to the workspace", async () => {
    renderProject({ canAddToWorkspace: false });
    await type("ad");

    expect(useSearchUserDirectory).toHaveBeenLastCalledWith(
      "workspace-1",
      "ad",
      { enabled: false },
    );
    expect(screen.queryByRole("option", { name: /Ada Lovelace/ })).toBeNull();
  });

  it("does not offer the directory when the instance switched it off", async () => {
    config = { hasSmtp: true, userDirectoryEnabled: false };
    renderProject();
    await type("ad");

    expect(screen.queryByRole("option", { name: /Ada Lovelace/ })).toBeNull();
    // Workspace members are still offered.
    await type("car");
    expect(await option(/Carol Workspace/)).toBeVisible();
  });

  it("invites an unknown email with a workspace role and a project role", async () => {
    directory = { data: [], isFetching: false, isError: false };
    renderProject();
    await type("new@example.com");
    fireEvent.click(await option(/people:add\.inviteOption/));

    await choose("people:add.projectRoleLabel", "Tester");
    fireEvent.click(submitButton("people:add.sendInvitation"));

    await waitFor(() =>
      expect(createProjectInvitation).toHaveBeenCalledWith({
        projectId: "project-1",
        email: "new@example.com",
        workspaceRole: "member",
        projectRole: "tester",
      }),
    );
    expect(success).toHaveBeenCalledWith(
      "projectInvitations:invite.createdSent|new@example.com",
    );
    expect(await screen.findByText("link:inv-pr")).toBeVisible();
  });

  it("reports what happened to the email of a project invitation", async () => {
    const cases: [Record<string, unknown>, boolean, string][] = [
      [
        { emailAttempted: false, emailSent: false },
        true,
        "projectInvitations:invite.createdNotSent|new@example.com",
      ],
      [
        { emailAttempted: true, emailSent: false },
        true,
        "projectInvitations:invite.createdSendFailed|new@example.com",
      ],
      [
        { emailAttempted: false, emailSent: false },
        false,
        "projectInvitations:invite.addedToExisting|new@example.com",
      ],
    ];
    for (const [invitation, createdNew, message] of cases) {
      cleanup();
      vi.clearAllMocks();
      directory = { data: [], isFetching: false, isError: false };
      createProjectInvitation.mockResolvedValueOnce({
        created: createdNew,
        invitation: { id: "inv-pr", ...invitation },
      });
      renderProject();
      await type("new@example.com");
      fireEvent.click(await option(/people:add\.inviteOption/));
      fireEvent.click(submitButton("people:add.sendInvitation"));
      await waitFor(() => expect(success).toHaveBeenCalledWith(message));
    }
  });

  it("offers to add the person instead when the invited address already is a workspace member", async () => {
    directory = { data: [], isFetching: false, isError: false };
    candidates = { data: [] };
    createProjectInvitation.mockRejectedValueOnce(
      new ProjectMemberError("raw", {
        code: "ALREADY_WORKSPACE_MEMBER",
        status: 409,
      }),
    );
    renderProject();
    await type("carol@example.com");
    fireEvent.click(await option(/people:add\.inviteOption/));
    // The candidate list arrives only after the failed invitation (a stale
    // list): the button needs the person in it.
    candidates = { data: [carol] };
    fireEvent.click(submitButton("people:add.sendInvitation"));

    expect(
      await screen.findByText(
        "projectInvitations:errors.alreadyWorkspaceMember",
      ),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name: "projectInvitations:invite.addAsMember",
      }),
    );

    // The person is picked: project role only, and adding works.
    expect(
      await screen.findByRole("combobox", {
        name: "people:add.projectRoleLabel",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("combobox", { name: "people:add.workspaceRoleLabel" }),
    ).toBeNull();
    fireEvent.click(submitButton("people:add.add"));
    await waitFor(() =>
      expect(addProjectMember).toHaveBeenCalledWith({
        projectId: "project-1",
        userId: "u-carol",
        role: "member",
      }),
    );
  });

  it("does not submit a pick that left the candidate list meanwhile", async () => {
    const view = renderProject();
    fireEvent.click(await option(/Carol Workspace/));
    expect(submitButton("people:add.add")).toBeEnabled();

    // The list refreshed (somebody added the person elsewhere): the pick is
    // gone from it, so it cannot be submitted.
    candidates = { data: [] };
    view.rerender(
      <AddPeopleDialog
        open
        onClose={onClose}
        context={{
          kind: "project",
          workspaceId: "workspace-1",
          projectId: "project-1",
        }}
        canAdd
        canInvite
        canAddToWorkspace
      />,
    );
    expect(submitButton("people:add.add")).toBeDisabled();
  });

  it("maps the refusal of the combined add", async () => {
    addProjectMember.mockRejectedValueOnce(
      new ProjectMemberError("raw", {
        code: "INSUFFICIENT_PERMISSIONS",
        status: 403,
      }),
    );
    renderProject();
    await type("ad");
    fireEvent.click(await option(/Ada Lovelace/));
    fireEvent.click(submitButton("people:add.add"));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "projectMembers:errors.insufficientPermissions",
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("starts from an expired invitation for 'Invite again' with both roles", async () => {
    directory = { data: [], isFetching: false, isError: false };
    renderProject({
      prefill: {
        email: "old@example.com",
        workspaceRole: "viewer",
        projectRole: "tester",
      },
    });

    expect(
      await screen.findByText("people:add.willInvite|old@example.com"),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "people:add.workspaceRoleLabel" }),
    ).toHaveTextContent("team:roles.viewer");
    expect(
      screen.getByRole("combobox", { name: "people:add.projectRoleLabel" }),
    ).toHaveTextContent("Tester");
  });

  it("only reads the candidates for somebody who may add", () => {
    renderProject({ canAdd: false });

    expect(useGetMemberCandidates).toHaveBeenLastCalledWith("project-1", {
      enabled: false,
    });
    expect(
      screen.queryByRole("option", { name: /Carol Workspace/ }),
    ).toBeNull();
  });
});
