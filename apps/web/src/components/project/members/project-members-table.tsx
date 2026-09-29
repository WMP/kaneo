import { EllipsisIcon, LogOutIcon, TrashIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import RoleSelect from "@/components/team/role-select";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import type { ProjectMember } from "@/fetchers/project-member/get-project-members";
import useLeaveProject from "@/hooks/mutations/project-member/use-leave-project";
import useRemoveProjectMember from "@/hooks/mutations/project-member/use-remove-project-member";
import useUpdateProjectMember from "@/hooks/mutations/project-member/use-update-project-member";
import { getInitials } from "@/lib/get-initials";
import { getProjectMemberErrorMessage } from "@/lib/project-member-error";
import { toast } from "@/lib/toast";
import { getWorkspaceRoleLabel } from "@/lib/workspace-role-label";

type Props = {
  projectId: string;
  workspaceId: string;
  members: ProjectMember[];
  currentUserId: string | undefined;
  /** Change roles of others and remove them (see useProjectMemberAbilities). */
  canManage: boolean;
  /** Roles the caller may assign; undefined until loaded. */
  assignableRoles: { role: string }[] | undefined;
  assignableRolesFailed: boolean;
  onRetryRoles: () => void;
  /** Navigates away once the caller left the project; awaited. */
  onLeft: () => void | Promise<void>;
};

// Access rows first (they reach every project), then the project's own
// members, and memberships that grant nothing any more last. Stable within a
// group, so the API order is kept.
function rank(member: ProjectMember): number {
  if (member.source === "full-access") return 0;
  return member.active ? 1 : 2;
}

function ProjectMembersTable({
  projectId,
  workspaceId,
  members,
  currentUserId,
  canManage,
  assignableRoles,
  assignableRolesFailed,
  onRetryRoles,
  onLeft,
}: Props) {
  const { t } = useTranslation();
  const [memberToRemove, setMemberToRemove] = useState<ProjectMember | null>(
    null,
  );
  const [confirmLeave, setConfirmLeave] = useState(false);
  const { mutateAsync: updateMember } = useUpdateProjectMember(workspaceId);
  const { mutateAsync: removeMember, isPending: isRemovingMember } =
    useRemoveProjectMember(workspaceId);
  const { leave, isPending: isLeaving } = useLeaveProject(workspaceId);
  const isRemoving = isRemovingMember || isLeaving;

  const assignableRoleNames = useMemo(
    () => (assignableRoles ?? []).map((role) => role.role),
    [assignableRoles],
  );
  const assignableRoleSet = useMemo(
    () => new Set(assignableRoleNames),
    [assignableRoleNames],
  );
  const showRolesLoadError =
    canManage && assignableRolesFailed && assignableRoles === undefined;

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => rank(a) - rank(b)),
    [members],
  );

  const handleChangeRole = async (member: ProjectMember, role: string) => {
    if (role === member.role) return;
    try {
      await updateMember({ projectId, userId: member.userId, role });
      toast.success(t("projectMembers:table.roleUpdateSuccess"));
    } catch (error) {
      toast.error(
        getProjectMemberErrorMessage(
          error,
          t,
          "projectMembers:table.roleUpdateError",
        ),
      );
    }
  };

  const handleRemove = async () => {
    const member = memberToRemove;
    if (!member) return;
    try {
      await removeMember({ projectId, userId: member.userId });
      toast.success(t("projectMembers:removeDialog.success"));
    } catch (error) {
      toast.error(
        getProjectMemberErrorMessage(
          error,
          t,
          "projectMembers:removeDialog.error",
        ),
      );
    } finally {
      setMemberToRemove(null);
    }
  };

  const handleLeave = async () => {
    if (!currentUserId) return;
    try {
      await leave({ projectId, userId: currentUserId }, async () => {
        toast.success(t("projectMembers:leaveDialog.success"));
        await onLeft();
      });
    } catch (error) {
      toast.error(
        getProjectMemberErrorMessage(
          error,
          t,
          "projectMembers:leaveDialog.error",
        ),
      );
    } finally {
      setConfirmLeave(false);
    }
  };

  return (
    <>
      {showRolesLoadError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b px-6 py-3 text-sm text-destructive"
        >
          <span>{t("projectMembers:table.rolesLoadError")}</span>
          <Button variant="outline" size="xs" onClick={onRetryRoles}>
            {t("projectMembers:table.rolesRetry")}
          </Button>
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="ps-6 text-foreground font-medium">
              {t("projectMembers:table.columns.member")}
            </TableHead>
            <TableHead className="text-foreground font-medium">
              {t("projectMembers:table.columns.role")}
            </TableHead>
            <TableHead className="w-px pe-6" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedMembers.map((member) => {
            const isSelf = currentUserId === member.userId;
            const isFullAccess = member.source === "full-access";
            const isInactive = !member.active;
            const displayName = member.name || member.email;
            // A member whose role the caller could grant may be re-assigned;
            // so may one whose role grants nothing any more (the API allows
            // whoever may manage members to fix those). Never oneself.
            const showRoleSelect =
              !isFullAccess &&
              canManage &&
              assignableRoles !== undefined &&
              !isSelf &&
              (assignableRoleSet.has(member.role) || isInactive);
            const roleOptions = assignableRoleNames;
            const canRemoveMember = !isFullAccess && canManage && !isSelf;
            const canLeave = !isFullAccess && isSelf;
            return (
              <TableRow key={member.userId}>
                <TableCell className="ps-6 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarImage
                        src={member.image ?? ""}
                        alt={member.name ?? ""}
                      />
                      <AvatarFallback className="text-[11px] font-medium">
                        {getInitials(member.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {member.name}
                        </span>
                        {isSelf ? (
                          <span className="text-xs text-muted-foreground">
                            ({t("projectMembers:table.you")})
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {member.email}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="py-3">
                  {isFullAccess ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="secondary"
                        title={t("projectMembers:table.fullAccessHint")}
                      >
                        {t("projectMembers:table.fullAccess")}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {getWorkspaceRoleLabel(member.role, t)}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {showRoleSelect ? (
                        <RoleSelect
                          roles={roleOptions}
                          value={member.role}
                          onChange={(role) => handleChangeRole(member, role)}
                          size="sm"
                          className="h-8 w-32"
                          ariaLabel={t("projectMembers:table.ariaChangeRole", {
                            name: displayName,
                          })}
                        />
                      ) : (
                        <Badge variant="secondary">
                          {getWorkspaceRoleLabel(member.role, t)}
                        </Badge>
                      )}
                      {isInactive ? (
                        <Badge
                          variant="outline"
                          size="sm"
                          className="font-mono text-[9px] uppercase tracking-wider"
                          title={t("projectMembers:table.inactiveHint")}
                        >
                          {t("projectMembers:table.inactive")}
                        </Badge>
                      ) : null}
                    </div>
                  )}
                </TableCell>
                <TableCell className="pe-6 py-3 text-right">
                  {canRemoveMember || canLeave ? (
                    <Menu>
                      <MenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            aria-label={t("projectMembers:table.ariaActions", {
                              name: displayName,
                            })}
                          />
                        }
                      >
                        <EllipsisIcon className="size-4" />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        {canLeave ? (
                          <MenuItem onClick={() => setConfirmLeave(true)}>
                            <LogOutIcon className="size-4" />
                            {t("projectMembers:table.leaveProject")}
                          </MenuItem>
                        ) : (
                          <MenuItem onClick={() => setMemberToRemove(member)}>
                            <TrashIcon className="size-4" />
                            {t("projectMembers:table.removeMember")}
                          </MenuItem>
                        )}
                      </MenuPopup>
                    </Menu>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}

          {members.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="py-16 text-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <p className="text-sm font-medium text-foreground">
                    {t("projectMembers:table.emptyTitle")}
                  </p>
                  <p className="text-xs">
                    {t("projectMembers:table.emptyDescription")}
                  </p>
                </div>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <AlertDialog
        open={!!memberToRemove}
        onOpenChange={(open) => !open && setMemberToRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("projectMembers:removeDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("projectMembers:removeDialog.description", {
                name: memberToRemove?.name || memberToRemove?.email || "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" size="sm" disabled={isRemoving} />
              }
            >
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isRemoving}
                  onClick={handleRemove}
                />
              }
            >
              <TrashIcon className="mr-2 size-4" />
              {t("projectMembers:table.removeMember")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("projectMembers:leaveDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("projectMembers:leaveDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" size="sm" disabled={isRemoving} />
              }
            >
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isRemoving}
                  onClick={handleLeave}
                />
              }
            >
              <LogOutIcon className="mr-2 size-4" />
              {t("projectMembers:table.leaveProject")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default ProjectMembersTable;
