import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import WorkspaceCustomFieldEditor from "@/components/workspace/workspace-custom-field-editor";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/custom-fields",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { workspace } = useWorkspacePermission();
  const workspaceId = workspace?.id ?? "";

  return (
    <>
      <PageTitle title={t("settings:workspaceCustomFields.pageTitle")} />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:workspaceCustomFields.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:workspaceCustomFields.subtitle")}
          </p>
        </div>

        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-md font-medium">
              {t("settings:workspaceCustomFields.sectionTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("settings:workspaceCustomFields.sectionDescription")}
            </p>
          </div>
          {workspaceId && (
            <WorkspaceCustomFieldEditor workspaceId={workspaceId} />
          )}
        </div>
      </div>
    </>
  );
}
