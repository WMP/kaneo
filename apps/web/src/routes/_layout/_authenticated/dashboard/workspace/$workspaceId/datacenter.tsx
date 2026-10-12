import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import { DatacenterPage } from "@/components/infrastructure/datacenter/datacenter-page";
import PageTitle from "@/components/page-title";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/datacenter",
)({
  component: DatacenterRoute,
});

function DatacenterRoute() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();

  return (
    <>
      <PageTitle title={t("navigation:sidebar.datacenter")} />
      <WorkspaceLayout title={t("navigation:sidebar.datacenter")}>
        <div className="p-4">
          <DatacenterPage workspaceId={workspaceId} />
        </div>
      </WorkspaceLayout>
    </>
  );
}
