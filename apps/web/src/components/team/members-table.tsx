import {
  CopyIcon,
  EllipsisIcon,
  MailIcon,
  RefreshCwIcon,
  SendIcon,
  ShieldIcon,
  TrashIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useCancelInvitation from "@/hooks/mutations/workspace-user/use-cancel-invitation";
import useDeleteWorkspaceUser from "@/hooks/mutations/workspace-user/use-delete-workspace-user";
import useInviteWorkspaceUser from "@/hooks/mutations/workspace-user/use-invite-workspace-user";
import useUpdateWorkspaceUserRole from "@/hooks/mutations/workspace-user/use-update-workspace-user-role";
import useGetAssignableRoles from "@/hooks/queries/workspace/use-get-assignable-roles";
import { useCopyInvitationLink } from "@/hooks/use-copy-invitation-link";
import {
  getInvitationEmailMessageKey,
  useInvitationEmailDelivery,
} from "@/hooks/use-invitation-email-delivery";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";
import { getWorkspaceMemberErrorMessage } from "@/lib/workspace-role-error";
import { getWorkspaceRoleLabel } from "@/lib/workspace-role-label";
import type {
  WorkspaceUser,
  WorkspaceUserInvitation,
} from "@/types/workspace-user";
import { useAuth } from "../providers/auth-provider/hooks/use-auth";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import RoleSelect from "./role-select";

type Props = {
  workspaceId: string;
  invitations: WorkspaceUserInvitation[];
  users: WorkspaceUser[];
};

// Stable per-user pastel for the avatar fallback. Picks one of a curated set
// of Tailwind tone pairs from a cheap string hash so the same user keeps the
// same color across re-renders without server-side state.
const AVATAR_TONES = [
  "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
] as const;

function toneFor(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

function MembersTable({ workspaceId, invitations, users }: Props) {
  const { t } = useTranslation();
  const [memberToDelete, setMemberToDelete] = useState<WorkspaceUser | null>(
    null,
  );
  const [invitationToCancel, setInvitationToCancel] =
    useState<WorkspaceUserInvitation | null>(null);

  const { user: currentUser } = useAuth();
  const { mutateAsync: deleteWorkspaceUser, isPending: isDeleting } =
    useDeleteWorkspaceUser();
  const { mutateAsync: cancelInvitation, isPending: isCancelling } =
    useCancelInvitation();
  const { mutateAsync: updateMemberRole } = useUpdateWorkspaceUserRole();
  const { mutateAsync: inviteMember, isPending: isResending } =
    useInviteWorkspaceUser();
  const emailDelivery = useInvitationEmailDelivery();
  const { copy: copyInvitationLink } = useCopyInvitationLink();
  // Roles the current user may grant. Undefined until loaded, in which case no
  // role Select is offered rather than one that may list the wrong choices.
  const {
    data: assignableRoles,
    isError: assignableRolesFailed,
    refetch: refetchAssignableRoles,
  } = useGetAssignableRoles(workspaceId);
  const {
    canManageTeam,
    canRemoveMembers,
    canInviteUsers,
    canCancelInvitations,
    isOwner,
  } = useWorkspacePermission();
  const canChangeRoles = Boolean(canManageTeam());
  const canRemove = Boolean(canRemoveMembers());
  const canInvite = Boolean(canInviteUsers());
  // "Invite again" creates one invitation and cancels another, and Better Auth
  // checks the two permissions separately.
  const canInviteAgain = canInvite && Boolean(canCancelInvitations());

  const assignableRoleNames = useMemo(
    () => (assignableRoles ?? []).map((r) => r.role),
    [assignableRoles],
  );
  const assignableRoleSet = useMemo(
    () => new Set(assignableRoleNames),
    [assignableRoleNames],
  );
  // No data at all (not merely a failed background refetch): every role Select
  // would silently degrade to a badge, and resend / invite-again would vanish
  // from invitation rows, so say so and offer a retry to anyone affected.
  const showRolesLoadError =
    (canChangeRoles || canInvite) &&
    assignableRolesFailed &&
    assignableRoles === undefined;

  // Owner first, then everyone else (stable on ties so the original
  // listMembers order is preserved within each group).
  const sortedUsers = [...users].sort((a, b) => {
    if (a.role === b.role) return 0;
    if (a.role === "owner") return -1;
    if (b.role === "owner") return 1;
    return 0;
  });

  const pendingInvitations = invitations.filter(
    (inv) => inv.status !== "accepted" && inv.status !== "canceled",
  );

  const handleChangeRole = async (member: WorkspaceUser, role: string) => {
    if (role === member.role) return;
    try {
      await updateMemberRole({ workspaceId, memberId: member.id, role });
      toast.success(t("team:membersTable.roleUpdateSuccess"));
    } catch (error) {
      toast.error(
        getWorkspaceMemberErrorMessage(
          error,
          t,
          "team:membersTable.roleUpdateError",
        ),
      );
    }
  };

  // Better Auth renews an invitation only while it is pending and unexpired.
  // Any other row cannot be resent: inviting again would leave the old row
  // behind, so those get "Invite again", which replaces it. Expiry is judged
  // with the browser clock; a skewed clock can at worst offer the wrong action
  // near the boundary, and the API decides the outcome either way.
  const isInvitationLive = (invitation: WorkspaceUserInvitation) =>
    invitation.status === "pending" &&
    new Date(invitation.expiresAt).getTime() > Date.now();

  const handleResendInvitation = async (
    invitation: WorkspaceUserInvitation,
  ) => {
    try {
      await inviteMember({
        email: invitation.email,
        role: invitation.role,
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

  // The new invitation comes first: Better Auth ignores expired and
  // non-pending rows, so it is created without conflict, and a failure at this
  // step leaves the old row untouched. Cancelling the old row afterwards is
  // tidy-up; if that fails the new invitation is kept.
  const handleInviteAgain = async (invitation: WorkspaceUserInvitation) => {
    try {
      await inviteMember({
        email: invitation.email,
        role: invitation.role,
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
    // The new invitation exists from here on, so say so the way email
    // delivery allows, whatever happens to the cleanup below.
    toast.success(t(getInvitationEmailMessageKey("created", emailDelivery)));
    try {
      await cancelInvitation({ invitationId: invitation.id, workspaceId });
    } catch {
      toast.error(t("team:invitations.inviteAgainCancelError"));
    }
  };

  const handleDeleteMember = async () => {
    if (!memberToDelete) return;
    try {
      await deleteWorkspaceUser({
        workspaceId,
        userId: memberToDelete.user.email,
      });
      toast.success(t("team:membersTable.removeSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("team:membersTable.removeError"),
      );
    } finally {
      setMemberToDelete(null);
    }
  };

  const handleCancelInvitation = async () => {
    if (!invitationToCancel) return;
    try {
      await cancelInvitation({
        invitationId: invitationToCancel.id,
        workspaceId,
      });
      toast.success(t("team:membersTable.cancelInviteSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("team:membersTable.cancelInviteError"),
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
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="ps-6 text-foreground font-medium">
              {t("team:membersTable.columns.name", {
                defaultValue: "Member",
              })}
            </TableHead>
            <TableHead className="text-foreground font-medium">
              {t("team:membersTable.columns.role", { defaultValue: "Role" })}
            </TableHead>
            <TableHead className="text-foreground font-medium">
              {t("team:membersTable.columns.joined", {
                defaultValue: "Joined",
              })}
            </TableHead>
            <TableHead className="w-px pe-6" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedUsers.map((member) => {
            const isSelf = currentUser?.id === member.userId;
            // Owners may manage every non-owner member. Anyone else may only
            // touch members whose current role they could grant themselves,
            // and never their own row; the API enforces the same rules.
            const canAssignCurrent = assignableRoleSet.has(member.role);
            const showRoleSelect =
              canChangeRoles &&
              assignableRoles !== undefined &&
              !isSelf &&
              member.role !== "owner" &&
              (isOwner || canAssignCurrent);
            // The current role is always an option so it can be displayed as
            // the selected value even when the caller could not assign it.
            const roleOptions = canAssignCurrent
              ? assignableRoleNames
              : [member.role, ...assignableRoleNames];
            const tone = toneFor(member.user.email);
            return (
              <TableRow key={member.user.email}>
                <TableCell className="ps-6 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar className={cn("size-8", tone)}>
                      <AvatarImage
                        src={member.user.image ?? ""}
                        alt={member.user.name ?? ""}
                      />
                      <AvatarFallback className="bg-transparent text-[11px] font-medium">
                        {getInitials(member.user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {member.user.name}
                        </span>
                        {isSelf ? (
                          <span className="text-xs text-muted-foreground">
                            ({t("team:members.you", { defaultValue: "You" })})
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {member.user.email}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="py-3">
                  {member.role === "owner" ? (
                    <Badge variant="outline" className="gap-1">
                      <ShieldIcon className="size-3" />
                      {t("team:roles.owner", { defaultValue: "Owner" })}
                    </Badge>
                  ) : showRoleSelect ? (
                    <RoleSelect
                      roles={roleOptions}
                      value={member.role}
                      onChange={(role) => handleChangeRole(member, role)}
                      size="sm"
                      className="h-8 w-32"
                      ariaLabel={t("team:membersTable.ariaChangeRole", {
                        name: member.user.name || member.user.email,
                      })}
                    />
                  ) : (
                    <Badge variant="secondary">
                      {getWorkspaceRoleLabel(member.role, t)}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="py-3 text-sm text-muted-foreground tabular-nums">
                  {member.createdAt ? formatDateMedium(member.createdAt) : "–"}
                </TableCell>
                <TableCell className="pe-6 py-3 text-right">
                  {!isSelf && canRemove ? (
                    <Menu>
                      <MenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            aria-label={t("team:membersTable.ariaRemoveMember")}
                          />
                        }
                      >
                        <EllipsisIcon className="size-4" />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        <MenuItem onClick={() => setMemberToDelete(member)}>
                          <TrashIcon className="size-4" />
                          {t("team:membersTable.removeMember")}
                        </MenuItem>
                      </MenuPopup>
                    </Menu>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}

          {pendingInvitations.map((invitation) => (
            <TableRow key={`invite-${invitation.id}`}>
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
                          : isInvitationLive(invitation)
                            ? t("team:invitations.pendingBadge", {
                                defaultValue: "pending",
                              })
                            : t("team:invitations.expiredBadge")}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {invitation.expiresAt && invitation.status !== "rejected"
                        ? isInvitationLive(invitation)
                          ? t("team:invitations.expires", {
                              defaultValue: "Expires {{date}}",
                              date: formatDateMedium(invitation.expiresAt),
                            })
                          : t("team:invitations.expired", {
                              defaultValue: "Expired {{date}}",
                              date: formatDateMedium(invitation.expiresAt),
                            })
                        : "–"}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell className="py-3">
                <Badge variant="outline">
                  {getWorkspaceRoleLabel(invitation.role, t)}
                </Badge>
              </TableCell>
              <TableCell className="py-3 text-sm text-muted-foreground">
                –
              </TableCell>
              <TableCell className="pe-6 py-3 text-right">
                {canInvite ? (
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          aria-label={t(
                            "team:membersTable.ariaInvitationActions",
                          )}
                        />
                      }
                    >
                      <EllipsisIcon className="size-4" />
                    </MenuTrigger>
                    <MenuPopup align="end">
                      {isInvitationLive(invitation) ? (
                        <>
                          <MenuItem
                            onClick={() => copyInvitationLink(invitation.id)}
                          >
                            <CopyIcon className="size-4" />
                            {t("team:invitations.copyLink")}
                          </MenuItem>
                          {/* Resending re-sends the invitation's own role, which
                              the API rejects unless the caller could grant it. */}
                          {assignableRoleSet.has(invitation.role) ? (
                            <MenuItem
                              disabled={isResending}
                              onClick={() => handleResendInvitation(invitation)}
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
                        </>
                      ) : canInviteAgain &&
                        assignableRoleSet.has(invitation.role) ? (
                        <MenuItem
                          disabled={isResending || isCancelling}
                          onClick={() => handleInviteAgain(invitation)}
                        >
                          <SendIcon className="size-4" />
                          {t("team:invitations.inviteAgain")}
                        </MenuItem>
                      ) : null}
                      <MenuItem
                        onClick={() => setInvitationToCancel(invitation)}
                      >
                        <TrashIcon className="size-4" />
                        {t("team:membersTable.cancelInvitation")}
                      </MenuItem>
                    </MenuPopup>
                  </Menu>
                ) : null}
              </TableCell>
            </TableRow>
          ))}

          {users.length === 0 && pendingInvitations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="py-16 text-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <p className="text-sm font-medium text-foreground">
                    {t("team:membersTable.emptyTitle")}
                  </p>
                  <p className="text-xs">
                    {t("team:membersTable.emptyDescription")}
                  </p>
                </div>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <AlertDialog
        open={!!memberToDelete}
        onOpenChange={(open) => !open && setMemberToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("team:membersTable.removeDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("team:membersTable.removeDialogDescription", {
                name:
                  memberToDelete?.user.name || memberToDelete?.user.email || "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" size="sm" disabled={isDeleting} />
              }
            >
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isDeleting}
                  onClick={handleDeleteMember}
                />
              }
            >
              <TrashIcon className="mr-2 size-4" />
              {t("team:membersTable.removeMember")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!invitationToCancel}
        onOpenChange={(open) => !open && setInvitationToCancel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("team:membersTable.cancelDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("team:membersTable.cancelDialogDescription", {
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
                  onClick={handleCancelInvitation}
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

export default MembersTable;
