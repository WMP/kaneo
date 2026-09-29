import { MailPlusIcon, UserPlusIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { Button } from "@/components/ui/button";
import type { ProjectInvitationListItem } from "@/fetchers/project-invitation/get-project-invitations";
import useGetProjectInvitations from "@/hooks/queries/project-invitation/use-get-project-invitations";
import useGetMemberCandidates from "@/hooks/queries/project-member/use-get-member-candidates";
import useGetProjectMembers from "@/hooks/queries/project-member/use-get-project-members";
import useGetAssignableRoles from "@/hooks/queries/workspace/use-get-assignable-roles";
import { useProjectMemberAbilities } from "@/hooks/use-project-member-abilities";
import { isForbiddenError } from "@/lib/http-error";
import ProjectNoAccess from "../project-no-access";
import AddProjectMemberDialog from "./add-project-member-dialog";
import InviteToProjectDialog from "./invite-to-project-dialog";
import ProjectInvitationsList from "./project-invitations-list";
import ProjectMembersTable from "./project-members-table";

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
  const {
    data: members,
    error: membersError,
    isLoading: membersLoading,
    refetch: refetchMembers,
  } = useGetProjectMembers(projectId);
  const { data: invitations } = useGetProjectInvitations(projectId);
  const { data: candidates } = useGetMemberCandidates(projectId);
  const {
    data: workspaceRoles,
    isError: workspaceRolesFailed,
    refetch: refetchWorkspaceRoles,
  } = useGetAssignableRoles(abilities.canInvite ? workspaceId : undefined);

  const [addOpen, setAddOpen] = useState(false);
  const [addInitial, setAddInitial] = useState<
    { userId?: string; role?: string } | undefined
  >(undefined);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitePrefill, setInvitePrefill] = useState<InvitePrefill | undefined>(
    undefined,
  );

  if (isForbiddenError(membersError)) {
    return <ProjectNoAccess workspaceId={workspaceId} />;
  }

  const openAdd = (initial?: { userId?: string; role?: string }) => {
    setAddInitial(initial);
    setAddOpen(true);
  };
  const openInvite = (prefill?: InvitePrefill) => {
    setInvitePrefill(prefill);
    setInviteOpen(true);
  };
  const handleInviteAgain = (invitation: ProjectInvitationListItem) =>
    openInvite({
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
            <div className="flex items-center gap-2">
              {abilities.canAdd ? (
                <Button
                  variant="outline"
                  size="xs"
                  className="gap-1"
                  onClick={() => openAdd()}
                >
                  <UserPlusIcon className="size-3" />
                  {t("projectMembers:addMember")}
                </Button>
              ) : null}
              {abilities.canInvite ? (
                <Button
                  variant="outline"
                  size="xs"
                  className="gap-1"
                  onClick={() => openInvite()}
                >
                  <MailPlusIcon className="size-3" />
                  {t("projectMembers:inviteByEmail")}
                </Button>
              ) : null}
            </div>
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
            <ProjectMembersTable
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
            <ProjectInvitationsList
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

      {abilities.canAdd ? (
        <AddProjectMemberDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          projectId={projectId}
          workspaceId={workspaceId}
          initial={addInitial}
        />
      ) : null}
      {abilities.canInvite ? (
        <InviteToProjectDialog
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          projectId={projectId}
          workspaceId={workspaceId}
          prefill={invitePrefill}
          candidates={abilities.canAdd ? candidates : undefined}
          onAddExistingMember={
            abilities.canAdd
              ? ({ userId, role }) => {
                  setInviteOpen(false);
                  openAdd({ userId, role });
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

export default ProjectMembersSection;
