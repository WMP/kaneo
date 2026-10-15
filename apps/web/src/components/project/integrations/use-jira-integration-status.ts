import { getIntegrationStatus } from "@/components/project/integrations/get-integration-status";
import useGetJiraConnection from "@/hooks/queries/jira-integration/use-get-jira-connection";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

// Jira is connected once per workspace (project mappings come on top of it), so
// its row reflects the workspace connection. Kept apart from the project-scoped
// statuses because it is keyed by the workspace, not by the project.
export function useJiraIntegrationStatus() {
  const { data: workspace } = useActiveWorkspace();
  const jira = useGetJiraConnection(workspace?.id);

  return {
    status: getIntegrationStatus({
      queryStatus: jira.status,
      hasData: jira.data !== undefined,
      configured: Boolean(jira.data),
      isActive: jira.data?.isActive,
      detail: jira.data?.baseUrl,
    }),
    retry: () => {
      void jira.refetch();
    },
  };
}
