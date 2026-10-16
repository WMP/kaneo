import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProjectInfrastructurePage } from "@/components/infrastructure/project/project-infrastructure-page";
import PageTitle from "@/components/page-title";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/infrastructure",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  const { data: workspace } = useActiveWorkspace();

  return (
    <>
      <PageTitle title={t("settings:projectInfrastructure.title")} />
      <ProjectInfrastructurePage
        projectId={projectId}
        workspaceId={workspace?.id ?? ""}
      />
    </>
  );
}
