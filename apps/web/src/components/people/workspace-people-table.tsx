import { TrashIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
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
import { MenuItem } from "@/components/ui/menu";
import type { WorkspacePerson } from "@/fetchers/workspace/get-workspace-people";
import useDeleteWorkspaceUser from "@/hooks/mutations/workspace-user/use-delete-workspace-user";
import useUpdateWorkspaceUserRole from "@/hooks/mutations/workspace-user/use-update-workspace-user-role";
import useGetAssignableRoles from "@/hooks/queries/workspace/use-get-assignable-roles";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import { getWorkspaceMemberErrorMessage } from "@/lib/workspace-role-error";
import { getWorkspaceRoleLabel } from "@/lib/workspace-role-label";
import PeopleTable, { type PeopleTableRow } from "./people-table";
import RoleCell from "./role-cell";

type Props = {
  workspaceId: string;
  people: WorkspacePerson[];
};

// Projects shown in a cell before the rest folds into a "+N" badge.
const VISIBLE_PROJECTS = 3;

function ProjectsCell({ person }: { person: WorkspacePerson }) {
  const { t } = useTranslation();
  if (person.fullAccess) {
    return (
      <Badge variant="secondary" title={t("people:table.fullAccessHint")}>
        {t("people:table.fullAccess")}
      </Badge>
    );
  }
  const projects = person.projects ?? [];
  if (projects.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {t("people:table.noProjects")}
      </span>
    );
  }
  const shown = projects.slice(0, VISIBLE_PROJECTS);
  const hidden = projects.slice(VISIBLE_PROJECTS);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((project) => (
        <Badge key={project.id} variant="outline" className="gap-1">
          <span className="max-w-32 truncate">{project.name}</span>
          <span className="text-muted-foreground">
            {getWorkspaceRoleLabel(project.role, t)}
          </span>
        </Badge>
      ))}
      {hidden.length > 0 ? (
        <Badge
          variant="secondary"
          title={hidden
            .map(
              (project) =>
                `${project.name} (${getWorkspaceRoleLabel(project.role, t)})`,
            )
            .join(", ")}
        >
          {t("people:table.moreProjects", { count: hidden.length })}
        </Badge>
      ) : null}
    </div>
  );
}

/**
 * The workspace members table: person, workspace role, the projects the person
 * belongs to with their project role (or "Full access"), join date, actions.
 * The Projects column appears when the API sent project data, which it does
 * for callers who manage members; it names only projects the caller can open.
 */
function WorkspacePeopleTable({ workspaceId, people }: Props) {
  const { t } = useTranslation();
  const [personToRemove, setPersonToRemove] = useState<WorkspacePerson | null>(
    null,
  );
  const { user: currentUser } = useAuth();
  const { mutateAsync: deleteWorkspaceUser, isPending: isDeleting } =
    useDeleteWorkspaceUser();
  const { mutateAsync: updateMemberRole } = useUpdateWorkspaceUserRole();
  // Roles the current user may grant. Undefined until loaded, in which case no
  // role Select is offered rather than one that may list the wrong choices.
  const {
    data: assignableRoles,
    isError: assignableRolesFailed,
    refetch: refetchAssignableRoles,
  } = useGetAssignableRoles(workspaceId);
  const { canManageTeam, canRemoveMembers, isOwner } = useWorkspacePermission();
  const canChangeRoles = Boolean(canManageTeam());
  const canRemove = Boolean(canRemoveMembers());

  const assignableRoleNames = useMemo(
    () => (assignableRoles ?? []).map((r) => r.role),
    [assignableRoles],
  );
  const assignableRoleSet = useMemo(
    () => new Set(assignableRoleNames),
    [assignableRoleNames],
  );
  // No data at all (not merely a failed background refetch): every role Select
  // would silently degrade to a badge, so say so and offer a retry.
  const showRolesLoadError =
    canChangeRoles && assignableRolesFailed && assignableRoles === undefined;
  const showProjects = people.some((person) => person.projects !== undefined);

  // Owner first, then everyone else (stable on ties so the API order is kept
  // within each group).
  const sortedPeople = useMemo(
    () =>
      [...people].sort((a, b) => {
        if (a.role === b.role) return 0;
        if (a.role === "owner") return -1;
        if (b.role === "owner") return 1;
        return 0;
      }),
    [people],
  );

  const handleChangeRole = async (person: WorkspacePerson, role: string) => {
    if (role === person.role) return;
    try {
      await updateMemberRole({ workspaceId, memberId: person.memberId, role });
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

  const handleRemove = async () => {
    if (!personToRemove) return;
    try {
      await deleteWorkspaceUser({ workspaceId, userId: personToRemove.email });
      toast.success(t("team:membersTable.removeSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("team:membersTable.removeError"),
      );
    } finally {
      setPersonToRemove(null);
    }
  };

  const rows: PeopleTableRow[] = sortedPeople.map((person) => {
    const isSelf = currentUser?.id === person.id;
    // Owners may manage every non-owner member. Anyone else may only touch
    // members whose current role they could grant themselves, and never their
    // own row; the API enforces the same rules.
    const canAssignCurrent = assignableRoleSet.has(person.role);
    const canChange =
      canChangeRoles &&
      assignableRoles !== undefined &&
      !isSelf &&
      person.role !== "owner" &&
      (isOwner || canAssignCurrent);
    return {
      key: person.id,
      name: person.name,
      email: person.email,
      image: person.image,
      isSelf,
      role: (
        <RoleCell
          role={person.role}
          assignable={assignableRoleNames}
          canChange={canChange}
          onChange={(role) => handleChangeRole(person, role)}
          ariaLabel={t("team:membersTable.ariaChangeRole", {
            name: person.name || person.email,
          })}
        />
      ),
      extra: showProjects ? <ProjectsCell person={person} /> : undefined,
      joinedAt: person.joinedAt,
      menu:
        !isSelf && canRemove
          ? {
              ariaLabel: t("team:membersTable.ariaRemoveMember"),
              items: (
                <MenuItem onClick={() => setPersonToRemove(person)}>
                  <TrashIcon className="size-4" />
                  {t("team:membersTable.removeMember")}
                </MenuItem>
              ),
            }
          : null,
    };
  });

  return (
    <>
      <PeopleTable
        rows={rows}
        roleHeader={t("people:table.columns.workspaceRole")}
        extraHeader={
          showProjects ? t("people:table.columns.projects") : undefined
        }
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
        emptyTitle={t("team:membersTable.emptyTitle")}
        emptyDescription={t("team:membersTable.emptyDescription")}
      />

      <AlertDialog
        open={!!personToRemove}
        onOpenChange={(open) => !open && setPersonToRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("team:membersTable.removeDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("team:membersTable.removeDialogDescription", {
                name: personToRemove?.name || personToRemove?.email || "",
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
                  onClick={handleRemove}
                />
              }
            >
              <TrashIcon className="mr-2 size-4" />
              {t("team:membersTable.removeMember")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default WorkspacePeopleTable;
