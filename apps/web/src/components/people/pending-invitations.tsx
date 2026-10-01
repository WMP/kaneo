import {
  CopyIcon,
  EllipsisIcon,
  MailIcon,
  RefreshCwIcon,
  SendIcon,
  TrashIcon,
} from "lucide-react";
import { useState } from "react";
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
import { useCopyInvitationLink } from "@/hooks/use-copy-invitation-link";
import { useInvitationEmailDelivery } from "@/hooks/use-invitation-email-delivery";
import { formatDateMedium } from "@/lib/format";
import { getWorkspaceRoleLabel } from "@/lib/workspace-role-label";

/** A pending invitation of a workspace or of a project, in one shape. */
export type PendingInvitation = {
  id: string;
  email: string;
  /** live: can still be accepted. expired: use "Invite again". */
  status: "live" | "expired" | "rejected";
  expiresAt: string | Date | null;
  workspaceRole: string;
  /** Only for an invitation to a project. */
  projectRole?: string;
  /**
   * The projects (and project role in each) the invitation grants, for a list
   * that is not about one project.
   */
  projects?: { id: string; name: string; role: string }[];
};

/** What the caller may do with one invitation; the context decides. */
export type InvitationAbilities = {
  copyLink: boolean;
  resend: boolean;
  inviteAgain: boolean;
  cancel: boolean;
};

type Props = {
  /** Wording of the cancel confirmation: it differs for a project. */
  context: "workspace" | "project";
  invitations: PendingInvitation[];
  getAbilities: (invitation: PendingInvitation) => InvitationAbilities;
  onResend: (invitation: PendingInvitation) => void | Promise<void>;
  onInviteAgain: (invitation: PendingInvitation) => void | Promise<void>;
  /** Called once the caller confirmed; shows its own success and error. */
  onCancel: (invitation: PendingInvitation) => Promise<void>;
  /** A resend, invite again or cancel is running. */
  isBusy: boolean;
  /** Shown above the table, for example "could not load the roles". */
  notice?: React.ReactNode;
};

/**
 * The pending invitations of a workspace or a project, the same section in
 * both: live and expired (and rejected) invitations with copy link, resend or
 * renew, invite again and cancel, each offered only when the context says the
 * caller may.
 */
function PendingInvitations({
  context,
  invitations,
  getAbilities,
  onResend,
  onInviteAgain,
  onCancel,
  isBusy,
  notice,
}: Props) {
  const { t } = useTranslation();
  const emailDelivery = useInvitationEmailDelivery();
  const { copy: copyInvitationLink } = useCopyInvitationLink();
  const [invitationToCancel, setInvitationToCancel] =
    useState<PendingInvitation | null>(null);

  const handleConfirmCancel = async () => {
    const invitation = invitationToCancel;
    if (!invitation) return;
    try {
      await onCancel(invitation);
    } finally {
      setInvitationToCancel(null);
    }
  };

  return (
    <>
      {notice}
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
            const abilities = getAbilities(invitation);
            const isLive = invitation.status === "live";
            const hasActions =
              abilities.copyLink ||
              abilities.resend ||
              abilities.inviteAgain ||
              abilities.cancel;
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
                          {invitation.status === "rejected"
                            ? t("team:invitations.rejectedBadge")
                            : isLive
                              ? t("team:invitations.pendingBadge")
                              : t("team:invitations.expiredBadge")}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {invitation.expiresAt &&
                        invitation.status !== "rejected"
                          ? isLive
                            ? t("team:invitations.expires", {
                                date: formatDateMedium(invitation.expiresAt),
                              })
                            : t("team:invitations.expired", {
                                date: formatDateMedium(invitation.expiresAt),
                              })
                          : "–"}
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
                    {invitation.projectRole ? (
                      <Badge variant="outline">
                        {t("projectInvitations:list.projectRole", {
                          role: getWorkspaceRoleLabel(
                            invitation.projectRole,
                            t,
                          ),
                        })}
                      </Badge>
                    ) : null}
                    {invitation.projects?.map((project) => (
                      <Badge
                        key={project.id}
                        variant="outline"
                        className="gap-1"
                      >
                        <span className="max-w-32 truncate">
                          {project.name}
                        </span>
                        <span className="text-muted-foreground">
                          {getWorkspaceRoleLabel(project.role, t)}
                        </span>
                      </Badge>
                    ))}
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
                              { email: invitation.email },
                            )}
                          />
                        }
                      >
                        <EllipsisIcon className="size-4" />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        {abilities.copyLink ? (
                          <MenuItem
                            onClick={() => copyInvitationLink(invitation.id)}
                          >
                            <CopyIcon className="size-4" />
                            {t("team:invitations.copyLink")}
                          </MenuItem>
                        ) : null}
                        {abilities.resend ? (
                          <MenuItem
                            disabled={isBusy}
                            onClick={() => onResend(invitation)}
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
                        {abilities.inviteAgain ? (
                          <MenuItem
                            disabled={isBusy}
                            onClick={() => onInviteAgain(invitation)}
                          >
                            <SendIcon className="size-4" />
                            {t("team:invitations.inviteAgain")}
                          </MenuItem>
                        ) : null}
                        {abilities.cancel ? (
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
              {context === "project"
                ? t("projectInvitations:list.cancelDialogTitle")
                : t("team:membersTable.cancelDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {context === "project"
                ? t("projectInvitations:list.cancelDialogDescription", {
                    email: invitationToCancel?.email ?? "",
                  })
                : t("team:membersTable.cancelDialogDescription", {
                    email: invitationToCancel?.email ?? "",
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="outline" size="sm" disabled={isBusy} />}
            >
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isBusy}
                  onClick={handleConfirmCancel}
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

export default PendingInvitations;
