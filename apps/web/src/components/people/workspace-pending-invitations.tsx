import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import useCancelInvitation from "@/hooks/mutations/workspace-user/use-cancel-invitation";
import useInviteWorkspaceUser from "@/hooks/mutations/workspace-user/use-invite-workspace-user";
import useGetAssignableRoles from "@/hooks/queries/workspace/use-get-assignable-roles";
import useGetWorkspaceInvitationProjects from "@/hooks/queries/workspace/use-get-workspace-invitation-projects";
import {
  getInvitationEmailMessageKey,
  useInvitationEmailDelivery,
} from "@/hooks/use-invitation-email-delivery";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import { getWorkspaceMemberErrorMessage } from "@/lib/workspace-role-error";
import type { WorkspaceUserInvitation } from "@/types/workspace-user";
import PendingInvitations, {
  type PendingInvitation,
} from "./pending-invitations";

type Props = {
  workspaceId: string;
  invitations: WorkspaceUserInvitation[];
};

// Better Auth renews an invitation only while it is pending and unexpired. Any
// other row cannot be resent: inviting again would leave the old row behind, so
// those get "Invite again", which replaces it. Expiry is judged with the
// browser clock; a skewed clock can at worst offer the wrong action near the
// boundary, and the API decides the outcome either way.
function toPending(
  invitation: WorkspaceUserInvitation,
  projects: PendingInvitation["projects"],
): PendingInvitation {
  const isLive =
    invitation.status === "pending" &&
    new Date(invitation.expiresAt).getTime() > Date.now();
  return {
    id: invitation.id,
    email: invitation.email,
    status:
      invitation.status === "rejected"
        ? "rejected"
        : isLive
          ? "live"
          : "expired",
    expiresAt: invitation.expiresAt,
    workspaceRole: invitation.role,
    projects,
  };
}

/**
 * The pending workspace invitations, as the shared pending invitations section.
 * Rows that were accepted or cancelled are not pending and are left out.
 */
function WorkspacePendingInvitations({ workspaceId, invitations }: Props) {
  const { t } = useTranslation();
  const emailDelivery = useInvitationEmailDelivery();
  const { mutateAsync: cancelInvitation, isPending: isCancelling } =
    useCancelInvitation();
  const { mutateAsync: inviteMember, isPending: isInviting } =
    useInviteWorkspaceUser();
  const {
    data: assignableRoles,
    isError: assignableRolesFailed,
    refetch: refetchAssignableRoles,
  } = useGetAssignableRoles(workspaceId);
  // What a project invitation grants (Better Auth's list knows nothing of it).
  const { data: invitationProjects } =
    useGetWorkspaceInvitationProjects(workspaceId);
  const projectsByInvitation = new Map(
    (invitationProjects ?? []).map((entry) => [
      entry.invitationId,
      entry.projects,
    ]),
  );
  const { canInviteUsers, canCancelInvitations } = useWorkspacePermission();
  const canInvite = Boolean(canInviteUsers());
  // Cancelling is its own permission in Better Auth, and "Invite again" needs
  // it on top of the right to invite (it creates one invitation and cancels
  // another).
  const canCancel = Boolean(canCancelInvitations());
  const assignableRoleSet = new Set((assignableRoles ?? []).map((r) => r.role));
  // No data at all (not merely a failed background refetch): resend and invite
  // again would vanish from the rows, so say so and offer a retry.
  const showRolesLoadError =
    canInvite && assignableRolesFailed && assignableRoles === undefined;

  const pending = invitations
    .filter(
      (invitation) =>
        invitation.status !== "accepted" && invitation.status !== "canceled",
    )
    .map((invitation) =>
      toPending(invitation, projectsByInvitation.get(invitation.id)),
    );

  const handleResend = async (invitation: PendingInvitation) => {
    try {
      await inviteMember({
        email: invitation.email,
        role: invitation.workspaceRole,
        workspaceId,
        resend: true,
      });
      toast.success(t(getInvitationEmailMessageKey("renewed", emailDelivery)));
    } catch (error) {
      toast.error(
        getWorkspaceMemberErrorMessage(
          error,
          t,
          emailDelivery === "sent"
            ? "team:invitations.resendError"
            : "team:invitations.renewError",
        ),
      );
    }
  };

  // The new invitation comes first: Better Auth ignores expired and non-pending
  // rows, so it is created without conflict, and a failure at this step leaves
  // the old row untouched. Cancelling the old row afterwards is tidy-up; if
  // that fails the new invitation is kept.
  const handleInviteAgain = async (invitation: PendingInvitation) => {
    try {
      await inviteMember({
        email: invitation.email,
        role: invitation.workspaceRole,
        workspaceId,
      });
    } catch (error) {
      toast.error(
        getWorkspaceMemberErrorMessage(
          error,
          t,
          "team:invitations.inviteAgainError",
        ),
      );
      return;
    }
    // The new invitation exists from here on, so say so the way email delivery
    // allows, whatever happens to the cleanup below.
    toast.success(t(getInvitationEmailMessageKey("created", emailDelivery)));
    try {
      await cancelInvitation({ invitationId: invitation.id, workspaceId });
    } catch {
      toast.error(t("team:invitations.inviteAgainCancelError"));
    }
  };

  const handleCancel = async (invitation: PendingInvitation) => {
    try {
      await cancelInvitation({ invitationId: invitation.id, workspaceId });
      toast.success(t("team:membersTable.cancelInviteSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("team:membersTable.cancelInviteError"),
      );
    }
  };

  return (
    <PendingInvitations
      context="workspace"
      invitations={pending}
      isBusy={isCancelling || isInviting}
      onResend={handleResend}
      onInviteAgain={handleInviteAgain}
      onCancel={handleCancel}
      getAbilities={(invitation) => {
        const isLive = invitation.status === "live";
        // Resending re-sends the invitation's own role, which the API rejects
        // unless the caller could grant it.
        const roleWithinReach = assignableRoleSet.has(invitation.workspaceRole);
        const hasMenu = canInvite && (isLive || canCancel);
        return {
          copyLink: hasMenu && isLive,
          resend: hasMenu && isLive && roleWithinReach,
          inviteAgain:
            hasMenu && !isLive && canInvite && canCancel && roleWithinReach,
          cancel: hasMenu && canCancel,
        };
      }}
      notice={
        showRolesLoadError ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 border-b px-6 py-3 text-sm text-destructive"
          >
            <span>{t("team:membersTable.rolesLoadError")}</span>
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                void refetchAssignableRoles();
              }}
            >
              {t("team:membersTable.rolesRetry")}
            </Button>
          </div>
        ) : null
      }
    />
  );
}

export default WorkspacePendingInvitations;
