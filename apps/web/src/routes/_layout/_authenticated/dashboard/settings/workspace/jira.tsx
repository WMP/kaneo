import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { JiraConnectionSettings } from "@/components/jira/jira-connection-settings";
import { JiraMappingPanel } from "@/components/jira/jira-mapping-panel";
import PageTitle from "@/components/page-title";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/jira",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { workspace, canManageSettings } = useWorkspacePermission();
  const workspaceId = workspace?.id ?? "";
  // Only a UI affordance: the API answers 403 to anybody without
  // workspace:manage_settings.
  const canManage = canManageSettings();

  return (
    <>
      <PageTitle title={t("settings:jiraIntegration.workspace.pageTitle")} />
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:jiraIntegration.workspace.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:jiraIntegration.workspace.subtitle")}
          </p>
        </div>

        {workspaceId && (
          <>
            <section className="space-y-3">
              <div className="space-y-1">
                <h2 className="text-md font-medium">
                  {t("settings:jiraIntegration.workspace.connectionTitle")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "settings:jiraIntegration.workspace.connectionDescription",
                  )}
                </p>
              </div>
              <JiraConnectionSettings
                workspaceId={workspaceId}
                canManage={canManage}
              />
            </section>

            <section className="space-y-3">
              <div className="space-y-1">
                <h2 className="text-md font-medium">
                  {t("settings:jiraIntegration.workspace.mappingTitle")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t("settings:jiraIntegration.workspace.mappingDescription")}
                </p>
              </div>
              <JiraMappingPanel
                level="workspace"
                workspaceId={workspaceId}
                readOnly={!canManage}
              />
            </section>
          </>
        )}
      </div>
    </>
  );
}
