import { UserPlusIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import AddPeopleDialog from "@/components/people/add-people-dialog";
import ProjectPendingInvitations from "@/components/people/project-pending-invitations";
import ProjectPeopleTable from "@/components/people/project-people-table";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { Button } from "@/components/ui/button";
import type { ProjectInvitationListItem } from "@/fetchers/project-invitation/get-project-invitations";
import useGetProjectInvitations from "@/hooks/queries/project-invitation/use-get-project-invitations";
import useGetProjectMembers from "@/hooks/queries/project-member/use-get-project-members";
import useGetAssignableRoles from "@/hooks/queries/workspace/use-get-assignable-roles";
import { useProjectMemberAbilities } from "@/hooks/use-project-member-abilities";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { isForbiddenError } from "@/lib/http-error";
import ProjectNoAccess from "../project-no-access";

type Props = {
  projectId: string;
  workspaceId: string;
  /** Called after the current user left the project. */
  onLeft: () => void | Promise<void>;
};

type InvitePrefill = {
  email: string;
  workspaceRole: string;
  projectRole: string;
};

function ProjectMembersSection({ projectId, workspaceId, onLeft }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const abilities = useProjectMemberAbilities(projectId);
  const { canAddMembers } = useWorkspacePermission();
  const {
    data: members,
    error: membersError,
    isLoading: membersLoading,
    refetch: refetchMembers,
  } = useGetProjectMembers(projectId);
  const { data: invitations } = useGetProjectInvitations(projectId, {
    enabled: abilities.canViewInvitations,
  });
  const {
    data: workspaceRoles,
    isError: workspaceRolesFailed,
    refetch: refetchWorkspaceRoles,
  } = useGetAssignableRoles(abilities.canInvite ? workspaceId : undefined);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [prefill, setPrefill] = useState<InvitePrefill | undefined>(undefined);

  if (isForbiddenError(membersError)) {
    return <ProjectNoAccess workspaceId={workspaceId} />;
  }

  const openDialog = (next?: InvitePrefill) => {
    setPrefill(next);
    setDialogOpen(true);
  };
  const handleInviteAgain = (invitation: ProjectInvitationListItem) =>
    openDialog({
      email: invitation.email,
      workspaceRole: invitation.workspaceRole,
      projectRole: invitation.projectRole,
    });

  const showActions =
    !abilities.isLoading && (abilities.canAdd || abilities.canInvite);

  return (
    <div className="space-y-10">
      <section className="space-y-4" aria-labelledby="project-members-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="project-members-heading" className="text-md font-medium">
            {t("projectMembers:title")}
          </h2>
          {showActions ? (
            <Button
              variant="outline"
              size="xs"
              className="gap-1"
              onClick={() => openDialog()}
            >
              <UserPlusIcon className="size-3" />
              {t("people:add.open")}
            </Button>
          ) : null}
        </div>

        {abilities.hasError ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-md border border-destructive/32 px-4 py-3 text-sm text-destructive"
          >
            <span>{t("projectMembers:abilitiesError")}</span>
            <Button variant="outline" size="xs" onClick={abilities.retry}>
              {t("projectMembers:retry")}
            </Button>
          </div>
        ) : null}

        <div className="rounded-md border border-border">
          {membersLoading ? (
            <p
              className="px-6 py-8 text-sm text-muted-foreground"
              role="status"
            >
              {t("projectMembers:loading")}
            </p>
          ) : members === undefined ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 px-6 py-4 text-sm text-destructive"
            >
              <span>{t("projectMembers:loadError")}</span>
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  void refetchMembers();
                }}
              >
                {t("projectMembers:retry")}
              </Button>
            </div>
          ) : (
            <ProjectPeopleTable
              projectId={projectId}
              workspaceId={workspaceId}
              members={members}
              currentUserId={user?.id}
              canManage={abilities.canManage}
              assignableRoles={abilities.assignableRoles}
              assignableRolesFailed={abilities.assignableRolesFailed}
              onRetryRoles={abilities.refetchAssignableRoles}
              onLeft={onLeft}
            />
          )}
        </div>
      </section>

      {abilities.canViewInvitations ? (
        <section
          className="space-y-4"
          aria-labelledby="project-invitations-heading"
        >
          <div className="space-y-1">
            <h2
              id="project-invitations-heading"
              className="text-md font-medium"
            >
              {t("projectInvitations:title")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("projectInvitations:subtitle")}
            </p>
          </div>
          <div className="rounded-md border border-border">
            <ProjectPendingInvitations
              projectId={projectId}
              workspaceId={workspaceId}
              invitations={invitations ?? []}
              canInvite={abilities.canInvite}
              canCancel={abilities.canCancelInvitations}
              projectRoles={abilities.assignableRoles}
              workspaceRoles={workspaceRoles}
              rolesFailed={
                abilities.assignableRolesFailed || workspaceRolesFailed
              }
              onRetryRoles={() => {
                abilities.refetchAssignableRoles();
                void refetchWorkspaceRoles();
              }}
              onInviteAgain={handleInviteAgain}
            />
          </div>
        </section>
      ) : null}

      {abilities.canAdd || abilities.canInvite ? (
        <AddPeopleDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          context={{ kind: "project", workspaceId, projectId }}
          canAdd={abilities.canAdd}
          canInvite={abilities.canInvite}
          canAddToWorkspace={Boolean(canAddMembers())}
          prefill={prefill}
        />
      ) : null}
    </div>
  );
}

export default ProjectMembersSection;
