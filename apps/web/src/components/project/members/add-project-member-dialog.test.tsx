import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectMemberError } from "@/lib/project-member-error";
import AddProjectMemberDialog from "./add-project-member-dialog";

const success = vi.fn();
const error = vi.fn();
const addMember = vi.fn();
const onClose = vi.fn();

type Query<T> = { data: T | undefined; isLoading: boolean; isError: boolean };
let candidates: Query<{ id: string; name: string; email: string }[]>;
let roles: Query<{ role: string; isDefault: boolean }[]>;

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (msg: string) => success(msg),
    error: (msg: string) => error(msg),
  },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/mutations/project-member/use-add-project-member", () => ({
  default: () => ({ mutateAsync: addMember, isPending: false }),
}));

vi.mock("@/hooks/queries/project-member/use-get-member-candidates", () => ({
  default: () => ({ ...candidates, refetch: vi.fn() }),
}));

vi.mock(
  "@/hooks/queries/project-member/use-get-project-assignable-roles",
  () => ({ default: () => ({ ...roles, refetch: vi.fn() }) }),
);

const CANDIDATES = [
  { id: "u-1", name: "Alice", email: "alice@example.com", image: null },
  { id: "u-2", name: "Bob", email: "bob@example.com", image: null },
];

function renderDialog(
  props: Partial<React.ComponentProps<typeof AddProjectMemberDialog>> = {},
) {
  return render(
    <AddProjectMemberDialog
      open
      onClose={onClose}
      projectId="project-1"
      workspaceId="workspace-1"
      {...props}
    />,
  );
}

const submit = () =>
  screen.getByRole("button", { name: "projectMembers:addDialog.submit" });

beforeEach(() => {
  candidates = { data: CANDIDATES, isLoading: false, isError: false };
  roles = {
    data: [
      { role: "viewer", isDefault: true },
      { role: "member", isDefault: true },
      { role: "qa-lead", isDefault: false },
    ],
    isLoading: false,
    isError: false,
  };
  addMember.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AddProjectMemberDialog", () => {
  it("cannot be submitted before a person is chosen", () => {
    renderDialog();

    expect(submit()).toBeDisabled();
  });

  it("adds the chosen person with the default member role", async () => {
    renderDialog();

    fireEvent.click(screen.getByRole("option", { name: /Bob/ }));
    fireEvent.click(submit());

    await waitFor(() =>
      expect(addMember).toHaveBeenCalledWith({
        projectId: "project-1",
        userId: "u-2",
        role: "member",
      }),
    );
    expect(success).toHaveBeenCalledWith("projectMembers:addDialog.success");
    expect(onClose).toHaveBeenCalled();
  });

  it("sends the role picked from the project assignable roles", async () => {
    renderDialog();

    fireEvent.click(screen.getByRole("option", { name: /Alice/ }));
    fireEvent.click(
      screen.getByRole("combobox", {
        name: "projectMembers:addDialog.roleLabel",
      }),
    );
    const option = await screen.findByRole("option", { name: "Qa-Lead" });
    fireEvent.pointerDown(option);
    fireEvent.click(option, { detail: 1 });
    fireEvent.click(submit());

    await waitFor(() =>
      expect(addMember).toHaveBeenCalledWith({
        projectId: "project-1",
        userId: "u-1",
        role: "qa-lead",
      }),
    );
  });

  it("filters the people by name or email", () => {
    renderDialog();

    fireEvent.change(
      screen.getByPlaceholderText("projectMembers:addDialog.searchPlaceholder"),
      { target: { value: "bob@" } },
    );

    expect(screen.queryByRole("option", { name: /Alice/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Bob/ })).toBeVisible();
  });

  it("says when nobody matches the search", () => {
    renderDialog();

    fireEvent.change(
      screen.getByPlaceholderText("projectMembers:addDialog.searchPlaceholder"),
      { target: { value: "zzz" } },
    );

    expect(
      screen.getByText("projectMembers:addDialog.noMatches"),
    ).toBeVisible();
  });

  it("preselects the person and role it was opened with", async () => {
    renderDialog({ initial: { userId: "u-2", role: "qa-lead" } });

    expect(screen.getByRole("option", { name: /Bob/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(submit());
    await waitFor(() =>
      expect(addMember).toHaveBeenCalledWith({
        projectId: "project-1",
        userId: "u-2",
        role: "qa-lead",
      }),
    );
  });

  it("keeps the dialog open and maps a refusal to a translated message", async () => {
    addMember.mockRejectedValue(
      new ProjectMemberError("User already has full access to this project", {
        code: "USER_HAS_FULL_ACCESS",
        status: 409,
      }),
    );
    renderDialog();

    fireEvent.click(screen.getByRole("option", { name: /Alice/ }));
    fireEvent.click(submit());

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "projectMembers:errors.userHasFullAccess",
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says when everybody already has access", () => {
    candidates = { data: [], isLoading: false, isError: false };
    renderDialog();

    expect(
      screen.getByText("projectMembers:addDialog.noCandidates"),
    ).toBeVisible();
    expect(submit()).toBeDisabled();
  });

  it("shows a load error for the people list", () => {
    candidates = { data: undefined, isLoading: false, isError: true };
    renderDialog();

    expect(
      screen.getByText("projectMembers:addDialog.loadError"),
    ).toBeVisible();
  });

  it("says no role can be assigned when the list is empty", () => {
    roles = { data: [], isLoading: false, isError: false };
    renderDialog();

    fireEvent.click(screen.getByRole("option", { name: /Alice/ }));

    expect(
      screen.getByText("projectMembers:addDialog.noAssignableRoles"),
    ).toBeVisible();
    expect(submit()).toBeDisabled();
  });
});
