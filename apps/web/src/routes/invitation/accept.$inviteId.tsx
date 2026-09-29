import {
  createFileRoute,
  Link,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  LogIn,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useGetInvitationDetails } from "@/hooks/queries/invitation/use-get-invitation-details";
import { authClient } from "@/lib/auth-client";
import {
  clearAutoAcceptMarker,
  consumeAutoAcceptMarker,
  hasFreshAutoAcceptMarker,
  writeAutoAcceptMarker,
} from "@/lib/auto-accept-invitation";
import { toast } from "@/lib/toast";
import { AuthLayout } from "../../components/auth/layout";

export const Route = createFileRoute("/invitation/accept/$inviteId")({
  component: AcceptInvitation,
});

function AcceptInvitation() {
  const { t } = useTranslation();
  const { inviteId } = useParams({
    from: "/invitation/accept/$inviteId",
  });
  const navigate = useNavigate();
  const [isAccepting, setIsAccepting] = useState(false);
  const [hasAccepted, setHasAccepted] = useState(false);
  // True from the first render when this browser holds a fresh auto-accept
  // marker, until the automatic accept fails or the effect below decides not
  // to run it. It lets the page show an "accepting" state instead of flashing
  // the manual actions, so nothing can navigate away and race the request.
  const [isAutoAccepting, setIsAutoAccepting] = useState(() =>
    hasFreshAutoAcceptMarker(inviteId),
  );

  const { data: session, isPending: isSessionLoading } =
    authClient.useSession();
  const {
    data: invitationData,
    isLoading: isInvitationLoading,
    error: invitationError,
  } = useGetInvitationDetails(inviteId);

  const isLoading = isSessionLoading || isInvitationLoading;
  const isSignedIn = !!session?.user;

  const sessionUserName = session?.user?.name;

  const handleAcceptInvitation = useCallback(async () => {
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
        error instanceof Error
          ? error.message
          : t("auth:invitation.toast.acceptFailed"),
      );
      setIsAccepting(false);
      setIsAutoAccepting(false);
      return;
    }

    const { data, error } = result;
    if (error) {
      toast.error(error.message || t("auth:invitation.toast.acceptFailed"));
      setIsAccepting(false);
      setIsAutoAccepting(false);
      return;
    }

    // From here on the user is a member, so the manual "Accept" never returns.
    // Every action stays hidden (isAccepting) until navigation has been issued,
    // and only then does the success view take over as a fallback.
    clearAutoAcceptMarker(inviteId);

    try {
      await authClient.organization.setActive({
        organizationId: data?.invitation.organizationId,
      });
    } catch {
      // Making it the active workspace is a convenience; the dashboard
      // resolves a workspace on its own.
    }

    toast.success(t("auth:invitation.toast.acceptSuccess"));

    if (sessionUserName) {
      void navigate({
        to: "/dashboard/workspace/$workspaceId",
        params: { workspaceId: data?.invitation.organizationId || "" },
      });
    } else {
      void navigate({ to: "/profile-setup" });
    }
    setHasAccepted(true);
    setIsAccepting(false);
  }, [inviteId, navigate, sessionUserName, t]);

  // Joins the workspace without another click, but only for a user who just
  // signed in or up from this page (see writeAutoAcceptMarker). The ref keeps
  // React StrictMode's second effect run from accepting twice.
  const autoAcceptAttemptedFor = useRef<string | null>(null);
  const sessionEmail = session?.user?.email;
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

    void handleAcceptInvitation();
  }, [
    inviteId,
    isSignedIn,
    sessionEmail,
    acceptableInvitation,
    handleAcceptInvitation,
  ]);

  const handleSignIn = () => {
    const email = invitationData?.invitation?.email;
    writeAutoAcceptMarker(inviteId);
    navigate({
      to: "/auth/sign-in",
      search: { invitationId: inviteId, email },
    });
  };

  // Invitees without an account need the sign-up page: sign-in cannot create
  // one. Both flows forward the invitation id, which is what allows account
  // creation on instances running with DISABLE_REGISTRATION=true.
  const handleCreateAccount = () => {
    const email = invitationData?.invitation?.email;
    writeAutoAcceptMarker(inviteId);
    navigate({
      to: "/auth/sign-up",
      search: { invitationId: inviteId, email },
    });
  };

  if (isLoading) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleAccept")} />
        <AuthLayout title={t("auth:invitation.loadingTitle")}>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        </AuthLayout>
      </>
    );
  }

  if (invitationError || !invitationData) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleError")} />
        <AuthLayout title={t("auth:invitation.errorTitle")}>
          <div className="space-y-4 mt-4">
            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-destructive/10 rounded-full">
              <XCircle className="w-6 h-6 text-destructive" />
            </div>
            <Alert variant="error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {t("auth:invitation.errorLoadDescription")}
              </AlertDescription>
            </Alert>
            <Button
              render={<Link to="/auth/sign-in" />}
              variant="outline"
              className="w-full"
            >
              {t("auth:invitation.goToSignIn")}
            </Button>
          </div>
        </AuthLayout>
      </>
    );
  }

  if (!invitationData.valid) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleInvalid")} />
        <AuthLayout title={t("auth:invitation.invalidTitle")}>
          <div className="space-y-4 mt-4">
            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-destructive/10 rounded-full">
              {invitationData.invitation?.expired ? (
                <Clock className="w-6 h-6 text-destructive" />
              ) : (
                <XCircle className="w-6 h-6 text-destructive" />
              )}
            </div>

            <div className="space-y-3 text-center">
              <h2 className="text-lg font-semibold text-foreground">
                {invitationData.invitation?.expired
                  ? t("auth:invitation.invitationExpired")
                  : t("auth:invitation.invalidTitle")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {invitationData.error}
              </p>
              {invitationData.invitation && (
                <p className="text-xs text-muted-foreground">
                  {t("auth:invitation.workspaceLabel", {
                    workspaceName: invitationData.invitation.workspaceName,
                  })}
                </p>
              )}
            </div>

            <Button
              render={<Link to="/auth/sign-in" />}
              variant="outline"
              className="w-full"
            >
              {t("auth:invitation.goToSignIn")}
            </Button>
          </div>
        </AuthLayout>
      </>
    );
  }

  const invitation = invitationData.invitation ?? null;

  if (!invitation) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleInvalid")} />
        <AuthLayout title={t("auth:invitation.invalidTitle")}>
          <div className="space-y-4 mt-4">
            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-destructive/10 rounded-full">
              <XCircle className="w-6 h-6 text-destructive" />
            </div>
          </div>
        </AuthLayout>
      </>
    );
  }

  // Accepted: a success state with a way on, whatever happens to navigation.
  if (isSignedIn && hasAccepted) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleAccept")} />
        <AuthLayout title={t("auth:invitation.pageTitleAccept")}>
          <div className="space-y-4 mt-4">
            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-primary/10 rounded-full">
              <CheckCircle className="w-6 h-6 text-primary" />
            </div>
            <p
              className="text-center text-sm text-muted-foreground"
              role="status"
            >
              {t("auth:invitation.toast.acceptSuccess")}
            </p>
            <Button
              render={<Link to="/dashboard" />}
              variant="outline"
              className="w-full"
            >
              {t("auth:invitation.goToDashboard")}
            </Button>
          </div>
        </AuthLayout>
      </>
    );
  }

  // Automatic accept in flight: nothing else to click, so no other action can
  // navigate away and race the request.
  if (isSignedIn && isAutoAccepting) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleAccept")} />
        <AuthLayout title={t("auth:invitation.pageTitleAccept")}>
          <div
            className="flex flex-col items-center gap-3 py-8"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {t("auth:invitation.autoAccepting")}
            </p>
          </div>
        </AuthLayout>
      </>
    );
  }

  if (isSignedIn) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleAccept")} />
        <AuthLayout title={t("auth:invitation.pageTitleAccept")}>
          <div className="space-y-4 mt-4">
            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-primary/10 rounded-full">
              <Users className="w-6 h-6 text-primary" />
            </div>

            <div className="space-y-3 text-center">
              <h2 className="text-lg font-semibold text-foreground">
                {t("auth:invitation.joinWorkspace", {
                  workspaceName: invitation.workspaceName,
                })}
              </h2>
              <p className="text-sm text-muted-foreground">
                <Trans
                  i18nKey="auth:invitation.inviteBodySignedIn"
                  values={{ inviterName: invitation.inviterName }}
                  components={{ inviter: <strong /> }}
                />
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <Button
                onClick={handleAcceptInvitation}
                disabled={isAccepting}
                className="w-full"
              >
                {isAccepting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t("auth:invitation.accepting")}
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {t("auth:invitation.acceptInvitation")}
                  </>
                )}
              </Button>

              {isAccepting ? null : (
                <Button
                  render={<Link to="/dashboard" />}
                  variant="outline"
                  className="w-full"
                >
                  {t("auth:invitation.goToDashboard")}
                </Button>
              )}
            </div>

            <div className="pt-4 border-t border-border">
              <p className="text-xs text-center text-muted-foreground">
                <Trans
                  i18nKey="auth:invitation.signedInAs"
                  values={{ email: session.user.email }}
                  components={{ email: <strong /> }}
                />
              </p>
            </div>
          </div>
        </AuthLayout>
      </>
    );
  }

  return (
    <>
      <PageTitle title={t("auth:invitation.pageTitleAccept")} />
      <AuthLayout title={t("auth:invitation.youveBeenInvited")}>
        <div className="space-y-4 mt-4">
          <div className="flex items-center justify-center w-12 h-12 mx-auto bg-primary/10 rounded-full">
            <Users className="w-6 h-6 text-primary" />
          </div>

          <div className="space-y-3 text-center">
            <h2 className="text-lg font-semibold text-foreground">
              {t("auth:invitation.joinWorkspace", {
                workspaceName: invitation.workspaceName,
              })}
            </h2>
            <p className="text-sm text-muted-foreground">
              <Trans
                i18nKey="auth:invitation.inviteBodySignedOut"
                values={{ inviterName: invitation.inviterName }}
                components={{ inviter: <strong /> }}
              />
            </p>
            <p className="text-sm text-muted-foreground">
              {t("auth:invitation.createAccountOrSignIn")}
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <Button onClick={handleCreateAccount} className="w-full">
              <UserPlus className="w-4 h-4 mr-2" />
              {t("auth:invitation.createAccount")}
            </Button>

            <Button onClick={handleSignIn} variant="outline" className="w-full">
              <LogIn className="w-4 h-4 mr-2" />
              {t("auth:invitation.signIn")}
            </Button>
          </div>

          <div className="pt-4 border-t border-border">
            <div className="text-center space-y-1">
              <p className="text-xs text-muted-foreground">
                <Trans
                  i18nKey="auth:invitation.invitationFor"
                  values={{ email: invitation.email }}
                  components={{ email: <strong /> }}
                />
              </p>
            </div>
          </div>
        </div>
      </AuthLayout>
    </>
  );
}
