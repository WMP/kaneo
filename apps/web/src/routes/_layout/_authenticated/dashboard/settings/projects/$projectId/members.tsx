import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import ProjectMembersSection from "@/components/project/members/project-members-section";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/members",
)({ component: MembersSettings });

function MembersSettings() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  const { data: workspace } = useActiveWorkspace();
  const navigate = useNavigate();
  const workspaceId = workspace?.id;

  return (
    <>
      <PageTitle title={t("projectMembers:pageTitle")} />
      <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:px-8 sm:py-10">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("projectMembers:pageTitle")}
          </h1>
          <p className="text-muted-foreground">
            {t("projectMembers:subtitle")}
          </p>
        </div>
        {workspaceId ? (
          <ProjectMembersSection
            key={projectId}
            projectId={projectId}
            workspaceId={workspaceId}
            onLeft={() =>
              navigate({
                to: "/dashboard/workspace/$workspaceId",
                params: { workspaceId },
              })
            }
          />
        ) : null}
      </div>
    </>
  );
}
