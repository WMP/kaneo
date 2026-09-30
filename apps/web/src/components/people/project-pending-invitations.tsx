import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ProjectInvitationListItem } from "@/fetchers/project-invitation/get-project-invitations";
import useCancelProjectInvitation from "@/hooks/mutations/project-invitation/use-cancel-project-invitation";
import useResendProjectInvitation from "@/hooks/mutations/project-invitation/use-resend-project-invitation";
import {
  getInvitationEmailMessageKey,
  useInvitationEmailDelivery,
} from "@/hooks/use-invitation-email-delivery";
import { getProjectMemberErrorMessage } from "@/lib/project-member-error";
import { toast } from "@/lib/toast";
import PendingInvitations, {
  type PendingInvitation,
} from "./pending-invitations";

type Props = {
  projectId: string;
  workspaceId: string;
  invitations: ProjectInvitationListItem[];
  canInvite: boolean;
  canCancel: boolean;
  /** Project roles the caller may assign; undefined until loaded. */
  projectRoles: { role: string }[] | undefined;
  /** Workspace roles the caller may assign; undefined until loaded. */
  workspaceRoles: { role: string }[] | undefined;
  rolesFailed: boolean;
  onRetryRoles: () => void;
  /** Open the add people dialog from an expired invitation. */
  onInviteAgain: (invitation: ProjectInvitationListItem) => void;
};

/** The pending invitations of a project, as the shared pending invitations section. */
function ProjectPendingInvitations({
  projectId,
  workspaceId,
  invitations,
  canInvite,
  canCancel,
  projectRoles,
  workspaceRoles,
  rolesFailed,
  onRetryRoles,
  onInviteAgain,
}: Props) {
  const { t } = useTranslation();
  const emailDelivery = useInvitationEmailDelivery();
  const { mutateAsync: resendInvitation, isPending: isResending } =
    useResendProjectInvitation(workspaceId);
  const { mutateAsync: cancelInvitation, isPending: isCancelling } =
    useCancelProjectInvitation(workspaceId);

  const projectRoleSet = new Set((projectRoles ?? []).map((r) => r.role));
  const workspaceRoleSet = new Set((workspaceRoles ?? []).map((r) => r.role));
  const showRolesLoadError =
    canInvite &&
    rolesFailed &&
    (projectRoles === undefined || workspaceRoles === undefined);

  const byId = new Map(
    invitations.map((invitation) => [invitation.id, invitation]),
  );
  const pending: PendingInvitation[] = invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    status: invitation.status === "live" ? "live" : "expired",
    expiresAt: invitation.expiresAt,
    workspaceRole: invitation.workspaceRole,
    projectRole: invitation.projectRole,
  }));

  // The API re-sends only when both roles of the invitation are within the
  // caller's own permissions; the same lists decide what is offered here.
  const rolesWithinReach = (invitation: PendingInvitation) =>
    projectRoleSet.has(invitation.projectRole ?? "") &&
    workspaceRoleSet.has(invitation.workspaceRole);

  const handleResend = async (invitation: PendingInvitation) => {
    try {
      const result = await resendInvitation({
        projectId,
        invitationId: invitation.id,
      });
      if (result.emailSent) {
        toast.success(t(getInvitationEmailMessageKey("renewed", "sent")));
      } else if (result.emailAttempted) {
        toast.warning(t("projectInvitations:list.resendNotDelivered"));
      } else {
        toast.success(
          t(
            getInvitationEmailMessageKey(
              "renewed",
              emailDelivery === "sent" ? "not-sent" : emailDelivery,
            ),
          ),
        );
      }
    } catch (error) {
      toast.error(
        getProjectMemberErrorMessage(
          error,
          t,
          emailDelivery === "sent"
            ? "projectInvitations:list.resendError"
            : "projectInvitations:list.renewError",
        ),
      );
    }
  };

  const handleCancel = async (invitation: PendingInvitation) => {
    try {
      const result = await cancelInvitation({
        projectId,
        invitationId: invitation.id,
      });
      toast.success(
        result.canceled
          ? t("projectInvitations:list.cancelSuccess")
          : t("projectInvitations:list.cancelSuccessOtherProjects"),
      );
    } catch (error) {
      toast.error(
        getProjectMemberErrorMessage(
          error,
          t,
          "projectInvitations:list.cancelError",
        ),
      );
    }
  };

  return (
    <PendingInvitations
      context="project"
      invitations={pending}
      isBusy={isResending || isCancelling}
      onResend={handleResend}
      onInviteAgain={(invitation) => {
        const original = byId.get(invitation.id);
        if (original) onInviteAgain(original);
      }}
      onCancel={handleCancel}
      getAbilities={(invitation) => {
        const isLive = invitation.status === "live";
        return {
          copyLink: isLive,
          resend: isLive && canInvite && rolesWithinReach(invitation),
          inviteAgain: !isLive && canInvite && rolesWithinReach(invitation),
          cancel: canCancel,
        };
      }}
      notice={
        showRolesLoadError ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 border-b px-6 py-3 text-sm text-destructive"
          >
            <span>{t("projectInvitations:list.rolesLoadError")}</span>
            <Button variant="outline" size="xs" onClick={onRetryRoles}>
              {t("projectInvitations:list.rolesRetry")}
            </Button>
          </div>
        ) : null
      }
    />
  );
}

export default ProjectPendingInvitations;
