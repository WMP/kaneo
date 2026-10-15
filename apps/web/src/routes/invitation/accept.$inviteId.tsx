import {
  createFileRoute,
  Link,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { Loader2, TriangleAlert, UserCheckIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthDetails } from "@/components/auth/auth-details";
import { AuthFormSkeleton } from "@/components/auth/auth-form-skeleton";
import { authLinkClassName } from "@/components/auth/auth-link-class";
import { AuthPage } from "@/components/auth/auth-page";
import { useSettledSession } from "@/components/auth/use-settled-session";
import PageTitle from "@/components/page-title";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { InvitationProject } from "@/fetchers/invitation/get-invitation-details";
import { useGetInvitationDetails } from "@/hooks/queries/invitation/use-get-invitation-details";
import { authClient } from "@/lib/auth-client";
import {
  clearAutoAcceptMarker,
  consumeAutoAcceptMarker,
  hasFreshAutoAcceptMarker,
  writeAutoAcceptMarker,
} from "@/lib/auto-accept-invitation";
import { formatDateMedium } from "@/lib/format";
import { toast } from "@/lib/toast";
import { getWorkspaceRoleLabel } from "@/lib/workspace-role-label";

export const Route = createFileRoute("/invitation/accept/$inviteId")({
  component: AcceptInvitation,
});

// What accepting adds the person to besides the workspace. Absent for a plain
// workspace invitation.
function InvitedProjects({ projects }: { projects?: InvitationProject[] }) {
  const { t } = useTranslation();
  if (!projects || projects.length === 0) return null;
  if (projects.length === 1) {
    const [project] = projects;
    return (
      <p className="text-foreground text-sm">
        {t("projectInvitations:accept.invitedToProject", {
          project: project.name,
          role: getWorkspaceRoleLabel(project.role, t),
        })}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-foreground text-sm">
      <p>{t("projectInvitations:accept.invitedToProjects")}</p>
      <ul className="list-inside list-disc">
        {projects.map((project) => (
          <li key={project.id}>
            {t("projectInvitations:accept.projectRole", {
              project: project.name,
              role: getWorkspaceRoleLabel(project.role, t),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AcceptInvitation() {
  const { t } = useTranslation();
  const { inviteId } = useParams({ from: "/invitation/accept/$inviteId" });
  const navigate = useNavigate();
  const [isAccepting, setIsAccepting] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [hasAccepted, setHasAccepted] = useState(false);
  // The signed-in person already belongs to the workspace, so the invitation
  // cannot add them to its project (409 ALREADY_WORKSPACE_MEMBER).
  const [isAlreadyMember, setIsAlreadyMember] = useState(false);
  // True from the first render when this browser holds a fresh auto-accept
  // marker, until the automatic accept fails or the effect below decides not
  // to run it. It lets the page show an "accepting" state instead of flashing
  // the manual actions, so nothing can navigate away and race the request.
  const [isAutoAccepting, setIsAutoAccepting] = useState(() =>
    hasFreshAutoAcceptMarker(inviteId),
  );
  const { session, isLoading: isSessionLoading } = useSettledSession();
  const {
    data: invitationData,
    isLoading: isInvitationLoading,
    error: invitationError,
  } = useGetInvitationDetails(inviteId);
  const invitation = invitationData?.invitation;

  // Both flows forward the invitation id, which is what allows account
  // creation on instances running with DISABLE_REGISTRATION=true, and leave a
  // marker so the accept page can join the person after signing in or up.
  const goToAuth = (to: "/auth/sign-in" | "/auth/sign-up") => {
    writeAutoAcceptMarker(inviteId);
    navigate({
      to,
      search: { invitationId: inviteId, email: invitation?.email },
    });
  };

  const sessionUserName = session?.user?.name;
  const sessionEmail = session?.user?.email;
  const isSignedIn = !!session?.user;

  const accept = useCallback(async () => {
    setIsAccepting(true);

    let result: Awaited<
      ReturnType<typeof authClient.organization.acceptInvitation>
    >;
    try {
      result = await authClient.organization.acceptInvitation({
        invitationId: inviteId,
      });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("auth:invitation.toast.acceptFailed"),
      );
      setIsAccepting(false);
      setIsAutoAccepting(false);
      return;
    }

    const { data, error } = result;
    if (error) {
      if (error.code === "ALREADY_WORKSPACE_MEMBER") {
        // Nothing to retry: show what to do instead of an error toast.
        clearAutoAcceptMarker(inviteId);
        setIsAlreadyMember(true);
      } else if (error.code === "PROJECT_INVITATION_NOT_APPLIED") {
        // The invitation is usable again; the manual button stays for a retry.
        toast.error(t("projectInvitations:errors.notApplied"));
      } else {
        toast.error(error.message || t("auth:invitation.toast.acceptFailed"));
      }
      setIsAccepting(false);
      setIsAutoAccepting(false);
      return;
    }

    // The user is a member from here on. Show the success state (with its way
    // on) right away and never bring the manual "Join" back; everything that
    // follows is best effort and cannot leave the page stuck. A click on the
    // dashboard link while the workspace is still being activated is fine.
    clearAutoAcceptMarker(inviteId);
    setHasAccepted(true);
    setIsAccepting(false);
    toast.success(t("auth:invitation.toast.acceptSuccess"), {
      icon: UserCheckIcon,
    });

    try {
      await authClient.organization.setActive({
        organizationId: data?.invitation.organizationId,
      });
    } catch {
      // Making it the active workspace is a convenience; the dashboard
      // resolves a workspace on its own.
    }

    try {
      if (sessionUserName) {
        await navigate({
          to: "/dashboard/workspace/$workspaceId",
          params: { workspaceId: data?.invitation.organizationId || "" },
        });
      } else {
        await navigate({ to: "/profile-setup" });
      }
    } catch {
      // The success state already links to the dashboard.
    }
  }, [inviteId, navigate, sessionUserName, t]);

  // Joins the workspace without another click, but only for a user who just
  // signed in or up from this page (see writeAutoAcceptMarker). The ref keeps
  // React StrictMode's second effect run from accepting twice.
  const autoAcceptAttemptedFor = useRef<string | null>(null);
  const acceptableInvitation = invitationData?.valid
    ? (invitationData.invitation ?? null)
    : null;

  useEffect(() => {
    if (autoAcceptAttemptedFor.current === inviteId) return;
    // Signed in but without an email: there is nothing to match against, so
    // this can never auto-accept. Show the manual UI instead of spinning.
    if (isSignedIn && !sessionEmail) {
      setIsAutoAccepting(false);
      return;
    }
    if (!sessionEmail || !acceptableInvitation) return;
    autoAcceptAttemptedFor.current = inviteId;

    if (!consumeAutoAcceptMarker(inviteId)) {
      setIsAutoAccepting(false);
      return;
    }

    const emailsMatch =
      sessionEmail.trim().toLowerCase() ===
      acceptableInvitation.email.trim().toLowerCase();
    // A different account is signed in: keep the manual UI and its wording.
    if (!emailsMatch) {
      setIsAutoAccepting(false);
      return;
    }

    void accept();
  }, [inviteId, isSignedIn, sessionEmail, acceptableInvitation, accept]);

  const goToKaneo = (
    <p className="pt-8 text-muted-foreground text-sm">
      <Link to="/dashboard" className={authLinkClassName}>
        {t("auth:invitation.goToKaneo")}
      </Link>
    </p>
  );

  if (isSessionLoading || isInvitationLoading) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleAccept")} />
        <AuthPage title={t("auth:invitation.pageTitleAccept")}>
          <AuthFormSkeleton />
        </AuthPage>
      </>
    );
  }

  if (invitationError || !invitationData) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleError")} />
        <AuthPage
          title={t("auth:invitation.loadFailed.title")}
          description={t("auth:invitation.loadFailed.description")}
        >
          {goToKaneo}
        </AuthPage>
      </>
    );
  }

  if (!invitationData.valid || !invitation) {
    const expired = invitation?.expired;
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleInvalid")} />
        <AuthPage
          title={
            expired
              ? t("auth:invitation.expired.title")
              : t("auth:invitation.invalid.title")
          }
          description={
            expired
              ? t("auth:invitation.expired.description", {
                  inviterName: invitation.inviterName,
                  workspaceName: invitation.workspaceName,
                })
              : t("auth:invitation.invalid.description")
          }
        >
          {goToKaneo}
        </AuthPage>
      </>
    );
  }

  const title = t("auth:invitation.joinWorkspace", {
    workspaceName: invitation.workspaceName,
  });
  const description = t("auth:invitation.description", {
    inviterName: invitation.inviterName,
  });
  const invitedBy = {
    label: t("auth:invitation.invitedBy"),
    value: invitation.inviterName,
  };
  const expires = {
    label: t("auth:invitation.expires"),
    value: formatDateMedium(invitation.expiresAt),
  };

  if (!session?.user) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleAccept")} />
        <AuthPage title={title} description={description}>
          <div className="flex flex-col gap-4">
            <InvitedProjects projects={invitation.projects} />
            <AuthDetails
              rows={[
                invitedBy,
                {
                  label: t("auth:invitation.sentTo"),
                  value: invitation.email,
                },
                expires,
              ]}
            />
            <Button
              size="lg"
              className="w-full"
              onClick={() => goToAuth("/auth/sign-up")}
            >
              {t("auth:invitation.createAccount")}
            </Button>
          </div>
          <p className="pt-8 text-muted-foreground text-sm">
            {t("auth:signUp.toggleMessage")}{" "}
            <button
              type="button"
              className={authLinkClassName}
              onClick={() => goToAuth("/auth/sign-in")}
            >
              {t("auth:invitation.signIn")}
            </button>
          </p>
        </AuthPage>
      </>
    );
  }

  const isRecipient =
    sessionEmail?.toLowerCase() === invitation.email.toLowerCase();

  const switchAccount = async () => {
    setIsSwitching(true);
    try {
      await authClient.signOut();
      goToAuth("/auth/sign-in");
    } catch {
      setIsSwitching(false);
    }
  };

  if (isAlreadyMember) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleAccept")} />
        <AuthPage
          title={t("projectInvitations:accept.alreadyMemberTitle")}
          description={t("projectInvitations:accept.alreadyMemberDescription", {
            workspaceName: invitation.workspaceName,
          })}
        >
          <div role="status">
            <InvitedProjects projects={invitation.projects} />
          </div>
          {goToKaneo}
        </AuthPage>
      </>
    );
  }

  // Accepted: a success state with a way on, whatever happens to navigation.
  if (hasAccepted) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleAccept")} />
        <AuthPage
          title={title}
          description={
            <span role="status">
              {t("auth:invitation.toast.acceptSuccess")}
            </span>
          }
        >
          {goToKaneo}
        </AuthPage>
      </>
    );
  }

  // Automatic accept in flight: nothing else to click, so no other action can
  // navigate away and race the request.
  if (isAutoAccepting) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleAccept")} />
        <AuthPage title={title}>
          <div
            className="flex items-center gap-2 text-muted-foreground text-sm"
            role="status"
            aria-live="polite"
          >
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            <p>{t("auth:invitation.autoAccepting")}</p>
          </div>
        </AuthPage>
      </>
    );
  }

  return (
    <>
      <PageTitle title={t("auth:invitation.pageTitleAccept")} />
      <AuthPage title={title} description={description}>
        <div className="flex flex-col gap-4">
          <InvitedProjects projects={invitation.projects} />
          {isRecipient ? (
            <AuthDetails
              rows={[
                invitedBy,
                {
                  label: t("auth:invitation.signedInAs"),
                  value: session.user.email,
                },
                expires,
              ]}
            />
          ) : (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertTitle>{t("auth:invitation.mismatch.title")}</AlertTitle>
              <AlertDescription>
                {t("auth:invitation.mismatch.description", {
                  invitedEmail: invitation.email,
                  email: session.user.email,
                })}
              </AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="lg"
              disabled={isAccepting || isSwitching}
              render={<Link to="/dashboard" />}
            >
              {t("auth:invitation.notNow")}
            </Button>
            {isRecipient ? (
              <Button size="lg" loading={isAccepting} onClick={accept}>
                {t("auth:invitation.join")}
              </Button>
            ) : (
              <Button size="lg" loading={isSwitching} onClick={switchAccount}>
                {t("auth:invitation.switchAccount")}
              </Button>
            )}
          </div>
        </div>
      </AuthPage>
    </>
  );
}
