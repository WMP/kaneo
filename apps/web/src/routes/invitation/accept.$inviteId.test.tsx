import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import {
  readAutoAcceptMarker,
  writeAutoAcceptMarker,
} from "@/lib/auto-accept-invitation";
import { toast } from "@/lib/toast";
import { Route } from "./accept.$inviteId";

const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  session: { data: null as unknown, isPending: false },
  details: {} as Record<string, unknown>,
  acceptInvitation: vi.fn(),
  setActive: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => m.navigate,
  useParams: () => ({ inviteId: "invitation-1" }),
}));
vi.mock("@/hooks/queries/invitation/use-get-invitation-details", () => ({
  useGetInvitationDetails: () => m.details,
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: undefined }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => m.session,
    signOut: m.signOut,
    organization: {
      acceptInvitation: m.acceptInvitation,
      setActive: m.setActive,
    },
  },
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/lib/format", () => ({ formatDateMedium: () => "Jan 1, 2999" }));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const AcceptInvitation = (Route as unknown as { component: ComponentType })
  .component;

const invitation = {
  id: "invitation-1",
  email: "invitee@kaneo.test",
  workspaceName: "Kaneo",
  inviterName: "Ada",
  expiresAt: "2999-01-01T00:00:00.000Z",
  status: "pending",
  expired: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.session = { data: null, isPending: false };
  m.details = {
    data: { valid: true, invitation },
    isLoading: false,
    error: null,
  };
  m.acceptInvitation.mockResolvedValue({
    data: { invitation: { organizationId: "workspace-1" } },
    error: null,
  });
  m.signOut.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("signed-out invitee", () => {
  it("sends an invitee without an account to sign-up with the invitation", () => {
    render(<AcceptInvitation />);
    fireEvent.click(
      screen.getByRole("button", { name: "auth:invitation.createAccount" }),
    );
    expect(m.navigate).toHaveBeenCalledWith({
      to: "/auth/sign-up",
      search: { invitationId: "invitation-1", email: "invitee@kaneo.test" },
    });
  });

  it("leaves an auto-accept marker for the sign-up and sign-in flows", () => {
    render(<AcceptInvitation />);
    fireEvent.click(
      screen.getByRole("button", { name: "auth:invitation.createAccount" }),
    );
    expect(readAutoAcceptMarker("invitation-1")).not.toBeNull();
  });

  it("keeps the sign-in route for invitees who already have an account", () => {
    render(<AcceptInvitation />);
    fireEvent.click(
      screen.getByRole("button", { name: "auth:invitation.signIn" }),
    );
    expect(m.navigate).toHaveBeenCalledWith({
      to: "/auth/sign-in",
      search: { invitationId: "invitation-1", email: "invitee@kaneo.test" },
    });
  });
});

describe("signed-in invitee", () => {
  it("joins the workspace when the invited email is signed in", async () => {
    m.session = {
      data: { user: { email: "Invitee@kaneo.test", name: "Invitee" } },
      isPending: false,
    };
    render(<AcceptInvitation />);
    fireEvent.click(
      screen.getByRole("button", { name: "auth:invitation.join" }),
    );
    await waitFor(() =>
      expect(m.navigate).toHaveBeenCalledWith({
        to: "/dashboard/workspace/$workspaceId",
        params: { workspaceId: "workspace-1" },
      }),
    );
    expect(m.acceptInvitation).toHaveBeenCalledWith({
      invitationId: "invitation-1",
    });
    expect(m.setActive).toHaveBeenCalledWith({ organizationId: "workspace-1" });
  });

  it("offers to switch accounts instead of a join that would fail", async () => {
    m.session = {
      data: { user: { email: "someone@else.test", name: "Someone" } },
      isPending: false,
    };
    render(<AcceptInvitation />);
    expect(screen.getByText("auth:invitation.mismatch.title")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "auth:invitation.join" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "auth:invitation.switchAccount" }),
    );
    await waitFor(() =>
      expect(m.navigate).toHaveBeenCalledWith({
        to: "/auth/sign-in",
        search: { invitationId: "invitation-1", email: "invitee@kaneo.test" },
      }),
    );
    expect(m.signOut).toHaveBeenCalledTimes(1);
    expect(m.acceptInvitation).not.toHaveBeenCalled();
  });
});

function signIn(email: string | null = "invitee@kaneo.test") {
  m.session = { data: { user: { email, name: "Ada" } }, isPending: false };
}

describe("automatic accept after sign-in", () => {
  beforeEach(() => {
    m.setActive.mockResolvedValue({});
  });

  it("shows an accepting state without the other actions while it runs", async () => {
    let resolveAccept: (value: unknown) => void = () => {};
    m.acceptInvitation.mockReturnValue(
      new Promise((resolve) => {
        resolveAccept = resolve;
      }),
    );
    writeAutoAcceptMarker("invitation-1");
    signIn();

    render(<AcceptInvitation />);

    expect(screen.getByText("auth:invitation.autoAccepting")).toBeVisible();
    expect(screen.queryByText("auth:invitation.notNow")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "auth:invitation.join" }),
    ).toBeNull();
    await waitFor(() => expect(m.acceptInvitation).toHaveBeenCalledTimes(1));
    expect(m.acceptInvitation).toHaveBeenCalledWith({
      invitationId: "invitation-1",
    });

    resolveAccept({
      data: { invitation: { organizationId: "workspace-1" } },
      error: null,
    });
    await waitFor(() =>
      expect(m.navigate).toHaveBeenCalledWith({
        to: "/dashboard/workspace/$workspaceId",
        params: { workspaceId: "workspace-1" },
      }),
    );
    // The manual "Join" is never offered again once the user has joined.
    expect(
      screen.queryByRole("button", { name: "auth:invitation.join" }),
    ).toBeNull();
    expect(readAutoAcceptMarker("invitation-1")).toBeNull();
  });

  it("works from a marker written in another tab", async () => {
    // localStorage is shared across tabs; sessionStorage is not.
    writeAutoAcceptMarker("invitation-1");
    expect(sessionStorage.length).toBe(0);
    signIn();

    render(<AcceptInvitation />);

    await waitFor(() => expect(m.acceptInvitation).toHaveBeenCalledTimes(1));
  });

  it("returns to the manual actions when the automatic accept fails", async () => {
    m.acceptInvitation.mockResolvedValue({
      data: null,
      error: { message: "nope" },
    });
    writeAutoAcceptMarker("invitation-1");
    signIn();

    render(<AcceptInvitation />);

    expect(await screen.findByText("auth:invitation.notNow")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "auth:invitation.join" }),
    ).toBeVisible();
    expect(m.navigate).not.toHaveBeenCalled();
  });

  it("does not accept without a marker and keeps the manual actions", () => {
    signIn();
    render(<AcceptInvitation />);

    expect(screen.getByText("auth:invitation.notNow")).toBeVisible();
    expect(m.acceptInvitation).not.toHaveBeenCalled();
  });

  it("does not accept for a different signed-in email and drops the marker", async () => {
    writeAutoAcceptMarker("invitation-1");
    signIn("someone-else@kaneo.test");

    render(<AcceptInvitation />);

    expect(await screen.findByText("auth:invitation.notNow")).toBeVisible();
    expect(m.acceptInvitation).not.toHaveBeenCalled();
    expect(readAutoAcceptMarker("invitation-1")).toBeNull();
  });

  it("does not accept with an expired marker", () => {
    writeAutoAcceptMarker("invitation-1", Date.now() - 31 * 60 * 1000);
    signIn();

    render(<AcceptInvitation />);

    expect(screen.getByText("auth:invitation.notNow")).toBeVisible();
    expect(m.acceptInvitation).not.toHaveBeenCalled();
  });

  it("drops the accepting state and shows the manual UI when the session has no email", async () => {
    writeAutoAcceptMarker("invitation-1");
    signIn(null);

    render(<AcceptInvitation />);

    expect(await screen.findByText("auth:invitation.notNow")).toBeVisible();
    expect(screen.queryByText("auth:invitation.autoAccepting")).toBeNull();
    expect(m.acceptInvitation).not.toHaveBeenCalled();
  });

  it("still counts as joined when activating the workspace throws", async () => {
    m.setActive.mockRejectedValue(new Error("boom"));
    writeAutoAcceptMarker("invitation-1");
    signIn();

    render(<AcceptInvitation />);

    await waitFor(() =>
      expect(m.navigate).toHaveBeenCalledWith({
        to: "/dashboard/workspace/$workspaceId",
        params: { workspaceId: "workspace-1" },
      }),
    );
    expect(
      screen.queryByRole("button", { name: "auth:invitation.join" }),
    ).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("switches to the success state as soon as the invitation is accepted", async () => {
    let resolveSetActive: (value: unknown) => void = () => {};
    m.setActive.mockReturnValue(
      new Promise((resolve) => {
        resolveSetActive = resolve;
      }),
    );
    writeAutoAcceptMarker("invitation-1");
    signIn();

    render(<AcceptInvitation />);

    await waitFor(() => expect(m.setActive).toHaveBeenCalledTimes(1));
    // Activation is still pending, yet the page is already in the success
    // state: a way on is visible and the manual join is gone.
    expect(m.navigate).not.toHaveBeenCalled();
    expect(await screen.findByText("auth:invitation.goToKaneo")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "auth:invitation.join" }),
    ).toBeNull();
    expect(readAutoAcceptMarker("invitation-1")).toBeNull();
    expect(toast.success).toHaveBeenCalledWith(
      "auth:invitation.toast.acceptSuccess",
      expect.anything(),
    );

    resolveSetActive({});
    await waitFor(() => expect(m.navigate).toHaveBeenCalledTimes(1));
  });

  it("ends in the success state after a manual accept too, without a stuck spinner", async () => {
    m.setActive.mockReturnValue(new Promise(() => {}));
    signIn();
    render(<AcceptInvitation />);

    fireEvent.click(
      screen.getByRole("button", { name: "auth:invitation.join" }),
    );

    expect(await screen.findByText("auth:invitation.goToKaneo")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "auth:invitation.join" }),
    ).toBeNull();
  });

  it("still ends in the success state when navigating throws after joining", async () => {
    m.navigate.mockImplementationOnce(() => {
      throw new Error("router exploded");
    });
    writeAutoAcceptMarker("invitation-1");
    signIn();

    render(<AcceptInvitation />);

    await waitFor(() => expect(m.navigate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("auth:invitation.goToKaneo")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "auth:invitation.join" }),
    ).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("project invitations", () => {
  const oneProject = [{ id: "project-1", name: "Apollo", role: "member" }];
  const twoProjects = [
    { id: "project-1", name: "Apollo", role: "member" },
    { id: "project-2", name: "Zephyr", role: "viewer" },
  ];

  function renderWithProjects({
    signedIn,
    projects,
  }: {
    signedIn: boolean;
    projects?: { id: string; name: string; role: string }[];
  }) {
    if (signedIn) signIn();
    m.details = {
      data: { valid: true, invitation: { ...invitation, projects } },
      isLoading: false,
      error: null,
    };
    render(<AcceptInvitation />);
  }

  it("names the project and the role for a signed-in invitee", () => {
    renderWithProjects({ signedIn: true, projects: oneProject });

    expect(
      screen.getByText("projectInvitations:accept.invitedToProject"),
    ).toBeVisible();
  });

  it("lists every project of the invitation for a signed-out invitee", () => {
    renderWithProjects({ signedIn: false, projects: twoProjects });

    expect(
      screen.getByText("projectInvitations:accept.invitedToProjects"),
    ).toBeVisible();
    expect(
      screen.getAllByText("projectInvitations:accept.projectRole"),
    ).toHaveLength(2);
  });

  it("shows no project line for a plain workspace invitation", () => {
    renderWithProjects({ signedIn: true, projects: [] });

    expect(
      screen.queryByText("projectInvitations:accept.invitedToProject"),
    ).toBeNull();
    expect(
      screen.queryByText("projectInvitations:accept.invitedToProjects"),
    ).toBeNull();
  });

  it("explains what to do when the person already is a workspace member", async () => {
    m.acceptInvitation.mockResolvedValue({
      data: null,
      error: {
        code: "ALREADY_WORKSPACE_MEMBER",
        message: "You are already a member of this workspace.",
      },
    });
    writeAutoAcceptMarker("invitation-1");

    renderWithProjects({ signedIn: true, projects: oneProject });

    expect(
      await screen.findByText("projectInvitations:accept.alreadyMemberTitle"),
    ).toBeVisible();
    expect(
      screen.getByText("projectInvitations:accept.alreadyMemberDescription"),
    ).toBeVisible();
    // It is a state of its own, not an error toast, and nothing to retry.
    expect(toast.error).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "auth:invitation.join" }),
    ).toBeNull();
    expect(readAutoAcceptMarker("invitation-1")).toBeNull();
  });

  it("keeps the join button and says so when the project access was not applied", async () => {
    m.acceptInvitation.mockResolvedValue({
      data: null,
      error: {
        code: "PROJECT_INVITATION_NOT_APPLIED",
        message: "The project access of the invitation could not be applied.",
      },
    });
    renderWithProjects({ signedIn: true, projects: oneProject });

    fireEvent.click(
      screen.getByRole("button", { name: "auth:invitation.join" }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "projectInvitations:errors.notApplied",
      ),
    );
    // The same link can be used again.
    expect(
      screen.getByRole("button", { name: "auth:invitation.join" }),
    ).toBeEnabled();
  });
});

describe("unusable invitations", () => {
  it("names the inviter when the invitation expired", () => {
    m.details = {
      data: {
        valid: false,
        invitation: { ...invitation, expired: true },
        error: "This invitation has expired",
      },
      isLoading: false,
      error: null,
    };
    render(<AcceptInvitation />);
    expect(screen.getByText("auth:invitation.expired.title")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("explains an invitation that was accepted or canceled", () => {
    m.details = {
      data: { valid: false, error: "This invitation has been canceled" },
      isLoading: false,
      error: null,
    };
    render(<AcceptInvitation />);
    expect(screen.getByText("auth:invitation.invalid.title")).toBeVisible();
  });
});
