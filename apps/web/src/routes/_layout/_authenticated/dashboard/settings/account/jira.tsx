import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { JiraMappingPanel } from "@/components/jira/jira-mapping-panel";
import { JiraTokenSettings } from "@/components/jira/jira-token-settings";
import PageTitle from "@/components/page-title";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/jira",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  // Account pages have no workspace in the URL; the session's active
  // workspace is the one the token and the mapping belong to.
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";

  return (
    <>
      <PageTitle title={t("settings:jiraIntegration.account.pageTitle")} />
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:jiraIntegration.account.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:jiraIntegration.account.subtitle", {
              workspace: workspace?.name ?? "",
            })}
          </p>
        </div>

        {workspaceId ? (
          <>
            <section className="space-y-3">
              <div className="space-y-1">
                <h2 className="text-md font-medium">
                  {t("settings:jiraIntegration.account.tokenTitle")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t("settings:jiraIntegration.account.tokenDescription")}
                </p>
              </div>
              <JiraTokenSettings workspaceId={workspaceId} />
            </section>

            <section className="space-y-3">
              <div className="space-y-1">
                <h2 className="text-md font-medium">
                  {t("settings:jiraIntegration.account.mappingTitle")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t("settings:jiraIntegration.account.mappingDescription")}
                </p>
              </div>
              <JiraMappingPanel
                level="user"
                workspaceId={workspaceId}
                readOnly={false}
              />
            </section>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("settings:jiraIntegration.account.noWorkspace")}
          </p>
        )}
      </div>
    </>
  );
}
