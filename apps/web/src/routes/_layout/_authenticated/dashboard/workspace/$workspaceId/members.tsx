import { createFileRoute } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import AddPeopleDialog from "@/components/people/add-people-dialog";
import WorkspacePendingInvitations from "@/components/people/workspace-pending-invitations";
import WorkspacePeopleTable from "@/components/people/workspace-people-table";
import { Button } from "@/components/ui/button";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import useGetFullWorkspace from "@/hooks/queries/workspace/use-get-full-workspace";
import useGetWorkspacePeople from "@/hooks/queries/workspace/use-get-workspace-people";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/members",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();
  const { data: workspace } = useGetFullWorkspace({ workspaceId });
  const {
    data: people,
    isLoading: peopleLoading,
    refetch: refetchPeople,
  } = useGetWorkspacePeople(workspaceId);
  const { canInviteUsers, canAddMembers, canCancelInvitations } =
    useWorkspacePermission();
  const canInvite = Boolean(canInviteUsers());
  const canAdd = Boolean(canAddMembers());
  const { data: config } = useGetConfig();
  // In a workspace an existing account is found through the user directory, so
  // without it (switched off) adding has nothing to offer; inviting still does.
  const canAddFromDirectory = canAdd && config?.userDirectoryEnabled === true;
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const invitations = workspace?.invitations ?? [];
  const hasPendingInvitations = invitations.some(
    (invitation) =>
      invitation.status !== "accepted" && invitation.status !== "canceled",
  );
  // The pending invitations are listed for the people who can act on them.
  const showInvitations =
    hasPendingInvitations || canInvite || Boolean(canCancelInvitations());

  return (
    <>
      <PageTitle title={t("team:members.pageTitle")} />
      <WorkspaceLayout
        title={t("team:members.pageTitle")}
        headerActions={
          canInvite || canAddFromDirectory ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => setIsDialogOpen(true)}
              className="gap-1"
            >
              <UserPlus className="w-3 h-3" />
              {t("people:add.open")}
            </Button>
          ) : null
        }
      >
        {peopleLoading ? (
          <p className="px-6 py-8 text-sm text-muted-foreground" role="status">
            {t("people:loading")}
          </p>
        ) : people === undefined ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 px-6 py-4 text-sm text-destructive"
          >
            <span>{t("people:loadError")}</span>
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                void refetchPeople();
              }}
            >
              {t("people:retry")}
            </Button>
          </div>
        ) : (
          <WorkspacePeopleTable workspaceId={workspaceId} people={people} />
        )}

        {showInvitations ? (
          <section
            className="mt-10 space-y-4"
            aria-labelledby="workspace-invitations-heading"
          >
            <div className="space-y-1 px-6">
              <h2
                id="workspace-invitations-heading"
                className="text-md font-medium"
              >
                {t("projectInvitations:title")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("people:invitations.workspaceSubtitle")}
              </p>
            </div>
            <WorkspacePendingInvitations
              workspaceId={workspaceId}
              invitations={invitations}
            />
          </section>
        ) : null}

        <AddPeopleDialog
          open={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          context={{ kind: "workspace", workspaceId }}
          canAdd={canAdd}
          canInvite={canInvite}
        />
      </WorkspaceLayout>
    </>
  );
}
