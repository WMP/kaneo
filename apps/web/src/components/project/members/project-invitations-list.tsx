import {
  CopyIcon,
  EllipsisIcon,
  MailIcon,
  RefreshCwIcon,
  SendIcon,
  TrashIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProjectInvitationListItem } from "@/fetchers/project-invitation/get-project-invitations";
import useCancelProjectInvitation from "@/hooks/mutations/project-invitation/use-cancel-project-invitation";
import useResendProjectInvitation from "@/hooks/mutations/project-invitation/use-resend-project-invitation";
import { useCopyInvitationLink } from "@/hooks/use-copy-invitation-link";
import {
  getInvitationEmailMessageKey,
  useInvitationEmailDelivery,
} from "@/hooks/use-invitation-email-delivery";
import { formatDateMedium } from "@/lib/format";
import { getProjectMemberErrorMessage } from "@/lib/project-member-error";
import { toast } from "@/lib/toast";
import { getWorkspaceRoleLabel } from "@/lib/workspace-role-label";

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
  /** Open the invite dialog from an expired invitation. */
  onInviteAgain: (invitation: ProjectInvitationListItem) => void;
};

function ProjectInvitationsList({
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
  const [invitationToCancel, setInvitationToCancel] =
    useState<ProjectInvitationListItem | null>(null);
  const emailDelivery = useInvitationEmailDelivery();
  const { copy: copyInvitationLink } = useCopyInvitationLink();
  const { mutateAsync: resendInvitation, isPending: isResending } =
    useResendProjectInvitation(workspaceId);
  const { mutateAsync: cancelInvitation, isPending: isCancelling } =
    useCancelProjectInvitation(workspaceId);

  const projectRoleSet = useMemo(
    () => new Set((projectRoles ?? []).map((role) => role.role)),
    [projectRoles],
  );
  const workspaceRoleSet = useMemo(
    () => new Set((workspaceRoles ?? []).map((role) => role.role)),
    [workspaceRoles],
  );
  const showRolesLoadError =
    canInvite &&
    rolesFailed &&
    (projectRoles === undefined || workspaceRoles === undefined);

  // The API re-sends only when both roles of the invitation are within the
  // caller's own permissions; the same lists decide what is offered here.
  const rolesWithinReach = (invitation: ProjectInvitationListItem) =>
    projectRoleSet.has(invitation.projectRole) &&
    workspaceRoleSet.has(invitation.workspaceRole);

  const handleResend = async (invitation: ProjectInvitationListItem) => {
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

  const handleCancel = async () => {
    const invitation = invitationToCancel;
    if (!invitation) return;
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
    } finally {
      setInvitationToCancel(null);
    }
  };

  return (
    <>
      {showRolesLoadError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b px-6 py-3 text-sm text-destructive"
        >
          <span>{t("projectInvitations:list.rolesLoadError")}</span>
          <Button variant="outline" size="xs" onClick={onRetryRoles}>
            {t("projectInvitations:list.rolesRetry")}
          </Button>
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="ps-6 text-foreground font-medium">
              {t("projectInvitations:list.columns.email")}
            </TableHead>
            <TableHead className="text-foreground font-medium">
              {t("projectInvitations:list.columns.roles")}
            </TableHead>
            <TableHead className="w-px pe-6" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.map((invitation) => {
            const isLive = invitation.status === "live";
            const canResend =
              isLive && canInvite && rolesWithinReach(invitation);
            const canInviteAgain =
              !isLive && canInvite && rolesWithinReach(invitation);
            const hasActions = isLive || canInviteAgain || canCancel;
            return (
              <TableRow key={invitation.id}>
                <TableCell className="ps-6 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <MailIcon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {invitation.email}
                        </span>
                        <Badge
                          variant="outline"
                          size="sm"
                          className="font-mono text-[9px] uppercase tracking-wider"
                        >
                          {isLive
                            ? t("team:invitations.pendingBadge")
                            : t("team:invitations.expiredBadge")}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {isLive
                          ? t("team:invitations.expires", {
                              date: formatDateMedium(invitation.expiresAt),
                            })
                          : t("team:invitations.expired", {
                              date: formatDateMedium(invitation.expiresAt),
                            })}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline">
                      {t("projectInvitations:list.workspaceRole", {
                        role: getWorkspaceRoleLabel(
                          invitation.workspaceRole,
                          t,
                        ),
                      })}
                    </Badge>
                    <Badge variant="outline">
                      {t("projectInvitations:list.projectRole", {
                        role: getWorkspaceRoleLabel(invitation.projectRole, t),
                      })}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="pe-6 py-3 text-right">
                  {hasActions ? (
                    <Menu>
                      <MenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            aria-label={t(
                              "projectInvitations:list.ariaActions",
                              {
                                email: invitation.email,
                              },
                            )}
                          />
                        }
                      >
                        <EllipsisIcon className="size-4" />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        {isLive ? (
                          <MenuItem
                            onClick={() => copyInvitationLink(invitation.id)}
                          >
                            <CopyIcon className="size-4" />
                            {t("team:invitations.copyLink")}
                          </MenuItem>
                        ) : null}
                        {canResend ? (
                          <MenuItem
                            disabled={isResending}
                            onClick={() => handleResend(invitation)}
                          >
                            {emailDelivery === "sent" ? (
                              <SendIcon className="size-4" />
                            ) : (
                              <RefreshCwIcon className="size-4" />
                            )}
                            {emailDelivery === "sent"
                              ? t("team:invitations.resend")
                              : t("team:invitations.renew")}
                          </MenuItem>
                        ) : null}
                        {canInviteAgain ? (
                          <MenuItem onClick={() => onInviteAgain(invitation)}>
                            <SendIcon className="size-4" />
                            {t("team:invitations.inviteAgain")}
                          </MenuItem>
                        ) : null}
                        {canCancel ? (
                          <MenuItem
                            onClick={() => setInvitationToCancel(invitation)}
                          >
                            <TrashIcon className="size-4" />
                            {t("team:membersTable.cancelInvitation")}
                          </MenuItem>
                        ) : null}
                      </MenuPopup>
                    </Menu>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}

          {invitations.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={3}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                {t("projectInvitations:empty")}
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <AlertDialog
        open={!!invitationToCancel}
        onOpenChange={(open) => !open && setInvitationToCancel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("projectInvitations:list.cancelDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("projectInvitations:list.cancelDialogDescription", {
                email: invitationToCancel?.email ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" size="sm" disabled={isCancelling} />
              }
            >
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isCancelling}
                  onClick={handleCancel}
                />
              }
            >
              <TrashIcon className="mr-2 size-4" />
              {t("team:membersTable.cancelInvitation")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default ProjectInvitationsList;
