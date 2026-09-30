import enUS from "@i18n/en-US.json";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./members";

const routeParams = { workspaceId: "workspace-1" };

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    ...(options as Record<string, unknown>),
    useParams: () => routeParams,
  }),
}));

vi.mock("@/components/page-title", () => ({ default: () => null }));

vi.mock("@/components/common/workspace-layout", () => ({
  default: ({
    title,
    headerActions,
    children,
  }: {
    title: string;
    headerActions?: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      <div data-testid="header-actions">{headerActions}</div>
      {children}
    </div>
  ),
}));

// Resolves against the real en-US bundle so assertions fail if a key this
// component references stops matching what actually ships.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const [namespace, path] = key.split(":");
      const value = path
        .split(".")
        .reduce<unknown>(
          (acc, segment) =>
            acc && typeof acc === "object"
              ? (acc as Record<string, unknown>)[segment]
              : undefined,
          (enUS as Record<string, unknown>)[namespace],
        );
      return typeof value === "string" ? value : key;
    },
  }),
}));

let config: { userDirectoryEnabled: boolean } | undefined;
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: config }),
}));

let workspaceData:
  | { invitations: { id: string; status: string }[] }
  | undefined;
vi.mock("@/hooks/queries/workspace/use-get-full-workspace", () => ({
  default: () => ({ data: workspaceData }),
}));

const refetchPeople = vi.fn();
let peopleState: { data: unknown; isLoading: boolean };
vi.mock("@/hooks/queries/workspace/use-get-workspace-people", () => ({
  default: () => ({ ...peopleState, refetch: refetchPeople }),
}));

let permissions: {
  invite: boolean;
  add: boolean;
  cancel: boolean;
};
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canInviteUsers: () => permissions.invite,
    canAddMembers: () => permissions.add,
    canCancelInvitations: () => permissions.cancel,
  }),
}));

vi.mock("@/components/people/workspace-people-table", () => ({
  default: ({ people }: { people: unknown[] }) => (
    <div>people table: {people.length}</div>
  ),
}));
vi.mock("@/components/people/workspace-pending-invitations", () => ({
  default: ({ invitations }: { invitations: unknown[] }) => (
    <div>pending invitations: {invitations.length}</div>
  ),
}));
let dialogProps: Record<string, unknown> | undefined;
vi.mock("@/components/people/add-people-dialog", () => ({
  default: (props: Record<string, unknown> & { open: boolean }) => {
    dialogProps = props;
    return props.open ? <div>add people dialog</div> : null;
  },
}));

const Page = (Route as unknown as { component: ComponentType }).component;

beforeEach(() => {
  config = { userDirectoryEnabled: true };
  workspaceData = { invitations: [] };
  peopleState = { data: [{ id: "u1" }, { id: "u2" }], isLoading: false };
  permissions = { invite: true, add: true, cancel: true };
  dialogProps = undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("workspace members page", () => {
  it("lists the people and opens one Add people dialog for the workspace", () => {
    render(<Page />);

    expect(screen.getByText("people table: 2")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add people" }));

    expect(screen.getByText("add people dialog")).toBeVisible();
    expect(dialogProps).toMatchObject({
      context: { kind: "workspace", workspaceId: "workspace-1" },
      canAdd: true,
      canInvite: true,
    });
  });

  it("offers the button to somebody who can only add, or only invite", () => {
    permissions = { invite: false, add: true, cancel: false };
    const { unmount } = render(<Page />);
    expect(screen.getByRole("button", { name: "Add people" })).toBeVisible();
    expect(dialogProps).toMatchObject({ canAdd: true, canInvite: false });
    unmount();

    permissions = { invite: true, add: false, cancel: false };
    render(<Page />);
    expect(screen.getByRole("button", { name: "Add people" })).toBeVisible();
    expect(dialogProps).toMatchObject({ canAdd: false, canInvite: true });
  });

  it("has no button for somebody who can only add while the user directory is off", () => {
    config = { userDirectoryEnabled: false };
    permissions = { invite: false, add: true, cancel: false };
    render(<Page />);

    expect(screen.queryByRole("button", { name: "Add people" })).toBeNull();
  });

  it("keeps the button for somebody who can invite while the user directory is off", () => {
    config = { userDirectoryEnabled: false };
    permissions = { invite: true, add: true, cancel: false };
    render(<Page />);

    expect(screen.getByRole("button", { name: "Add people" })).toBeVisible();
  });

  it("has no button for somebody who can neither add nor invite", () => {
    permissions = { invite: false, add: false, cancel: false };
    render(<Page />);

    expect(screen.queryByRole("button", { name: "Add people" })).toBeNull();
  });

  it("shows a loading state and then an error with a retry", () => {
    peopleState = { data: undefined, isLoading: true };
    const { unmount } = render(<Page />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading people");
    unmount();

    peopleState = { data: undefined, isLoading: false };
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetchPeople).toHaveBeenCalledTimes(1);
  });

  it("shows the pending invitations to somebody who can act on them, or when some exist", () => {
    permissions = { invite: false, add: false, cancel: false };
    const { unmount } = render(<Page />);
    expect(screen.queryByText(/pending invitations:/)).toBeNull();
    unmount();

    permissions = { invite: true, add: false, cancel: false };
    const second = render(<Page />);
    expect(screen.getByText("pending invitations: 0")).toBeVisible();
    second.unmount();

    permissions = { invite: false, add: false, cancel: false };
    workspaceData = { invitations: [{ id: "i1", status: "pending" }] };
    render(<Page />);
    expect(screen.getByText("pending invitations: 1")).toBeVisible();
  });

  it("does not count accepted or cancelled invitations as pending", () => {
    permissions = { invite: false, add: false, cancel: false };
    workspaceData = {
      invitations: [
        { id: "i1", status: "accepted" },
        { id: "i2", status: "canceled" },
      ],
    };
    render(<Page />);

    expect(screen.queryByText(/pending invitations:/)).toBeNull();
  });
});
