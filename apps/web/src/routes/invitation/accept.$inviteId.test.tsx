import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readAutoAcceptMarker,
  writeAutoAcceptMarker,
} from "@/lib/auto-accept-invitation";
import { toast } from "@/lib/toast";
import { Route } from "./accept.$inviteId";

const navigate = vi.fn();
const useSession = vi.fn();
const useGetInvitationDetails = vi.fn();
const acceptInvitation = vi.fn();
const setActive = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => navigate,
  useParams: () => ({ inviteId: "invitation-1" }),
}));

vi.mock("@/hooks/queries/invitation/use-get-invitation-details", () => ({
  useGetInvitationDetails: (invitationId: string) =>
    useGetInvitationDetails(invitationId),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => useSession(),
    organization: {
      acceptInvitation: (args: unknown) => acceptInvitation(args),
      setActive: (args: unknown) => setActive(args),
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));

const AcceptInvitation = (Route as unknown as { component: ComponentType })
  .component;

function renderSignedOutInvitation() {
  useSession.mockReturnValue({ data: null, isPending: false });
  useGetInvitationDetails.mockReturnValue({
    data: {
      valid: true,
      invitation: {
        id: "invitation-1",
        email: "invitee@kaneo.test",
        workspaceName: "Kaneo",
        inviterName: "Ada",
        expiresAt: "2999-01-01T00:00:00.000Z",
        status: "pending",
        expired: false,
      },
    },
    isLoading: false,
    error: null,
  });

  render(<AcceptInvitation />);
}

function renderSignedInInvitation(email: string | null = "invitee@kaneo.test") {
  useSession.mockReturnValue({
    data: { user: { email, name: "Ada" } },
    isPending: false,
  });
  useGetInvitationDetails.mockReturnValue({
    data: {
      valid: true,
      invitation: {
        id: "invitation-1",
        email: "invitee@kaneo.test",
        workspaceName: "Kaneo",
        inviterName: "Ada",
        expiresAt: "2999-01-01T00:00:00.000Z",
        status: "pending",
        expired: false,
      },
    },
    isLoading: false,
    error: null,
  });

  render(<AcceptInvitation />);
}

afterEach(() => {
  cleanup();
  navigate.mockReset();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  acceptInvitation.mockReset();
  setActive.mockReset();
  localStorage.clear();
});

describe("AcceptInvitation", () => {
  it("sends an invitee without an account to sign-up with the invitation", () => {
    renderSignedOutInvitation();

    fireEvent.click(
      screen.getByRole("button", { name: "auth:invitation.createAccount" }),
    );

    expect(navigate).toHaveBeenCalledWith({
      to: "/auth/sign-up",
      search: { invitationId: "invitation-1", email: "invitee@kaneo.test" },
    });
  });

  it("keeps the sign-in route for invitees who already have an account", () => {
    renderSignedOutInvitation();

    fireEvent.click(
      screen.getByRole("button", { name: "auth:invitation.signIn" }),
    );

    expect(navigate).toHaveBeenCalledWith({
      to: "/auth/sign-in",
      search: { invitationId: "invitation-1", email: "invitee@kaneo.test" },
    });
  });

  describe("automatic accept after sign-in", () => {
    beforeEach(() => {
      setActive.mockResolvedValue({});
      acceptInvitation.mockResolvedValue({
        data: { invitation: { organizationId: "workspace-1" } },
        error: null,
      });
    });

    it("shows an accepting state without the other actions while it runs", async () => {
      let resolveAccept: (value: unknown) => void = () => {};
      acceptInvitation.mockReturnValue(
        new Promise((resolve) => {
          resolveAccept = resolve;
        }),
      );
      writeAutoAcceptMarker("invitation-1");

      renderSignedInInvitation();

      expect(screen.getByText("auth:invitation.autoAccepting")).toBeVisible();
      expect(screen.queryByText("auth:invitation.goToDashboard")).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: "auth:invitation.acceptInvitation",
        }),
      ).toBeNull();
      await waitFor(() => expect(acceptInvitation).toHaveBeenCalledTimes(1));
      expect(acceptInvitation).toHaveBeenCalledWith({
        invitationId: "invitation-1",
      });

      resolveAccept({
        data: { invitation: { organizationId: "workspace-1" } },
        error: null,
      });
      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith({
          to: "/dashboard/workspace/$workspaceId",
          params: { workspaceId: "workspace-1" },
        }),
      );
      // The manual "Accept" is never offered again once the user has joined.
      expect(
        screen.queryByRole("button", {
          name: "auth:invitation.acceptInvitation",
        }),
      ).toBeNull();
      expect(readAutoAcceptMarker("invitation-1")).toBeNull();
    });

    it("works from a marker written in another tab", async () => {
      // localStorage is shared across tabs; sessionStorage is not.
      writeAutoAcceptMarker("invitation-1");
      expect(sessionStorage.length).toBe(0);

      renderSignedInInvitation();

      await waitFor(() => expect(acceptInvitation).toHaveBeenCalledTimes(1));
    });

    it("returns to the manual actions when the automatic accept fails", async () => {
      acceptInvitation.mockResolvedValue({
        data: null,
        error: { message: "nope" },
      });
      writeAutoAcceptMarker("invitation-1");

      renderSignedInInvitation();

      expect(
        await screen.findByText("auth:invitation.goToDashboard"),
      ).toBeVisible();
      expect(navigate).not.toHaveBeenCalled();
    });

    it("does not accept without a marker and keeps the manual actions", () => {
      renderSignedInInvitation();

      expect(screen.getByText("auth:invitation.goToDashboard")).toBeVisible();
      expect(acceptInvitation).not.toHaveBeenCalled();
    });

    it("does not accept for a different signed-in email and drops the marker", async () => {
      writeAutoAcceptMarker("invitation-1");

      renderSignedInInvitation("someone-else@kaneo.test");

      expect(
        await screen.findByText("auth:invitation.goToDashboard"),
      ).toBeVisible();
      expect(acceptInvitation).not.toHaveBeenCalled();
      expect(readAutoAcceptMarker("invitation-1")).toBeNull();
    });

    it("does not accept with an expired marker", async () => {
      writeAutoAcceptMarker("invitation-1", Date.now() - 31 * 60 * 1000);

      renderSignedInInvitation();

      expect(screen.getByText("auth:invitation.goToDashboard")).toBeVisible();
      expect(acceptInvitation).not.toHaveBeenCalled();
    });

    it("hides the dashboard link while a manual accept is running", async () => {
      acceptInvitation.mockReturnValue(new Promise(() => {}));
      renderSignedInInvitation();

      fireEvent.click(
        screen.getByRole("button", {
          name: "auth:invitation.acceptInvitation",
        }),
      );

      await waitFor(() =>
        expect(screen.queryByText("auth:invitation.goToDashboard")).toBeNull(),
      );
    });

    it("drops the accepting state and shows the manual UI when the session has no email", async () => {
      writeAutoAcceptMarker("invitation-1");

      renderSignedInInvitation(null);

      expect(
        await screen.findByText("auth:invitation.goToDashboard"),
      ).toBeVisible();
      expect(screen.queryByText("auth:invitation.autoAccepting")).toBeNull();
      expect(acceptInvitation).not.toHaveBeenCalled();
    });

    it("still counts as joined when activating the workspace throws", async () => {
      setActive.mockRejectedValue(new Error("boom"));
      writeAutoAcceptMarker("invitation-1");

      renderSignedInInvitation();

      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith({
          to: "/dashboard/workspace/$workspaceId",
          params: { workspaceId: "workspace-1" },
        }),
      );
      expect(
        screen.queryByRole("button", {
          name: "auth:invitation.acceptInvitation",
        }),
      ).toBeNull();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("switches to the success state as soon as the invitation is accepted", async () => {
      let resolveSetActive: (value: unknown) => void = () => {};
      setActive.mockReturnValue(
        new Promise((resolve) => {
          resolveSetActive = resolve;
        }),
      );
      writeAutoAcceptMarker("invitation-1");

      renderSignedInInvitation();

      await waitFor(() => expect(setActive).toHaveBeenCalledTimes(1));
      // Activation is still pending, yet the page is already in the success
      // state: a way on is visible and the manual accept is gone.
      expect(navigate).not.toHaveBeenCalled();
      expect(
        await screen.findByText("auth:invitation.goToDashboard"),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", {
          name: "auth:invitation.acceptInvitation",
        }),
      ).toBeNull();
      expect(readAutoAcceptMarker("invitation-1")).toBeNull();
      expect(toast.success).toHaveBeenCalledWith(
        "auth:invitation.toast.acceptSuccess",
      );

      resolveSetActive({});
      await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    });

    it("ends in the success state after a manual accept too, without a stuck spinner", async () => {
      setActive.mockReturnValue(new Promise(() => {}));
      renderSignedInInvitation();

      fireEvent.click(
        screen.getByRole("button", {
          name: "auth:invitation.acceptInvitation",
        }),
      );

      expect(
        await screen.findByText("auth:invitation.goToDashboard"),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "auth:invitation.accepting" }),
      ).toBeNull();
    });

    it("still ends in the success state when navigating throws after joining", async () => {
      navigate.mockImplementationOnce(() => {
        throw new Error("router exploded");
      });
      writeAutoAcceptMarker("invitation-1");

      renderSignedInInvitation();

      await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
      expect(
        await screen.findByText("auth:invitation.goToDashboard"),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", {
          name: "auth:invitation.acceptInvitation",
        }),
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
      useSession.mockReturnValue(
        signedIn
          ? {
              data: { user: { email: "invitee@kaneo.test", name: "Ada" } },
              isPending: false,
            }
          : { data: null, isPending: false },
      );
      useGetInvitationDetails.mockReturnValue({
        data: {
          valid: true,
          invitation: {
            id: "invitation-1",
            email: "invitee@kaneo.test",
            workspaceName: "Kaneo",
            inviterName: "Ada",
            expiresAt: "2999-01-01T00:00:00.000Z",
            status: "pending",
            expired: false,
            projects,
          },
        },
        isLoading: false,
        error: null,
      });
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
      acceptInvitation.mockResolvedValue({
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
        screen.queryByRole("button", {
          name: "auth:invitation.acceptInvitation",
        }),
      ).toBeNull();
      expect(readAutoAcceptMarker("invitation-1")).toBeNull();
    });

    it("keeps the accept button and says so when the project access was not applied", async () => {
      acceptInvitation.mockResolvedValue({
        data: null,
        error: {
          code: "PROJECT_INVITATION_NOT_APPLIED",
          message: "The project access of the invitation could not be applied.",
        },
      });
      renderWithProjects({ signedIn: true, projects: oneProject });

      fireEvent.click(
        screen.getByRole("button", {
          name: "auth:invitation.acceptInvitation",
        }),
      );

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "projectInvitations:errors.notApplied",
        ),
      );
      // The same link can be used again.
      expect(
        screen.getByRole("button", {
          name: "auth:invitation.acceptInvitation",
        }),
      ).toBeEnabled();
    });
  });
});
