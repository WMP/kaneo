import { Link } from "@tanstack/react-router";
import { CheckCircle, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { JiraMappingPanel } from "@/components/jira/jira-mapping-panel";
import { ResolvedMappingPreview } from "@/components/jira/resolved-mapping-preview";
import { Badge } from "@/components/ui/badge";
import useGetJiraConnection from "@/hooks/queries/jira-integration/use-get-jira-connection";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useProjectPermission } from "@/hooks/use-project-permission";

// Project section of the Jira integration: whether the workspace has a
// connection, and the project's mapping, shown against the values it inherits
// from the workspace and the built-in defaults.
export function JiraIntegrationSettings({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { data: connection, isLoading } = useGetJiraConnection(workspaceId);
  const { canUpdateProject } = useProjectPermission(projectId);

  if (!workspaceId || isLoading) {
    return <div className="h-24 animate-pulse rounded-md bg-muted" />;
  }

  const connected = !!connection?.isActive;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-sidebar p-4">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">
            {t("settings:jiraIntegration.project.connectionTitle")}
          </p>
          <p className="break-all text-xs text-muted-foreground">
            {connection
              ? connected
                ? connection.baseUrl
                : t("settings:jiraIntegration.project.connectionInactive")
              : t("settings:jiraIntegration.project.connectionNone")}
          </p>
          <p className="text-xs">
            <Link
              to="/dashboard/settings/workspace/jira"
              className="text-primary underline underline-offset-2"
            >
              {t("settings:jiraIntegration.project.workspaceLink")}
            </Link>
            {" · "}
            <Link
              to="/dashboard/settings/account/jira"
              className="text-primary underline underline-offset-2"
            >
              {t("settings:jiraIntegration.project.accountLink")}
            </Link>
          </p>
        </div>
        {connected ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle />
            {t("settings:jiraIntegration.connection.badgeConnected")}
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1">
            <XCircle />
            {t("settings:jiraIntegration.connection.badgeNotConnected")}
          </Badge>
        )}
      </div>

      <JiraMappingPanel
        level="project"
        workspaceId={workspaceId}
        projectId={projectId}
        readOnly={!canUpdateProject()}
      />

      <ResolvedMappingPreview projectId={projectId} workspaceId={workspaceId} />
    </div>
  );
}
