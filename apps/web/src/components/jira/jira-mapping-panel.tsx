import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  usePutJiraProjectMapping,
  usePutJiraUserMapping,
  usePutJiraWorkspaceMapping,
} from "@/hooks/mutations/jira-integration/use-jira-mapping";
import {
  useGetJiraProjectMapping,
  useGetJiraUserMapping,
  useGetJiraWorkspaceMapping,
} from "@/hooks/queries/jira-integration/use-get-jira-mapping";
import { getJiraErrorMessage } from "@/lib/jira-error";
import { toast } from "@/lib/toast";
import { MappingEditor } from "./mapping-editor";
import type { MappingLevel } from "./mapping-model";

// Loads one mapping level, renders the editor and saves it. The editor is
// remounted when the stored mapping changes (`updatedAt`), so it never shows a
// draft of a replaced mapping.
export function JiraMappingPanel({
  level,
  workspaceId,
  projectId,
  readOnly,
}: {
  level: MappingLevel;
  workspaceId: string;
  projectId?: string;
  readOnly: boolean;
}) {
  const { t } = useTranslation();

  // Only the hook of the requested level runs; the others get no id.
  const workspaceQuery = useGetJiraWorkspaceMapping(
    level === "workspace" ? workspaceId : undefined,
  );
  const projectQuery = useGetJiraProjectMapping(
    level === "project" ? projectId : undefined,
  );
  const userQuery = useGetJiraUserMapping(
    level === "user" ? workspaceId : undefined,
  );
  const query =
    level === "workspace"
      ? workspaceQuery
      : level === "project"
        ? projectQuery
        : userQuery;

  const putWorkspace = usePutJiraWorkspaceMapping();
  const putProject = usePutJiraProjectMapping();
  const putUser = usePutJiraUserMapping();
  const saving =
    putWorkspace.isPending || putProject.isPending || putUser.isPending;

  if (query.isLoading) {
    return <div className="h-24 animate-pulse rounded-md bg-muted" />;
  }

  if (query.isError || !query.data) {
    return (
      <div className="flex items-start justify-between gap-4 rounded-md border border-destructive/25 bg-sidebar p-4">
        <p className="text-sm text-muted-foreground">
          {getJiraErrorMessage(
            query.error,
            t,
            "settings:jiraIntegration.mapping.loadError",
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
        >
          {t("settings:jiraIntegration.retry")}
        </Button>
      </div>
    );
  }

  const { data } = query;

  return (
    <MappingEditor
      key={data.updatedAt ?? "none"}
      level={level}
      config={data.config}
      parent={data.parent}
      readOnly={readOnly}
      workspaceId={workspaceId}
      projectId={projectId}
      saving={saving}
      onSave={async (config) => {
        try {
          if (level === "workspace") {
            await putWorkspace.mutateAsync({ workspaceId, config });
          } else if (level === "project" && projectId) {
            await putProject.mutateAsync({ projectId, config });
          } else {
            await putUser.mutateAsync({ workspaceId, config });
          }
          toast.success(t("settings:jiraIntegration.mapping.saved"));
        } catch (error) {
          toast.error(
            getJiraErrorMessage(
              error,
              t,
              "settings:jiraIntegration.mapping.saveError",
            ),
          );
        }
      }}
    />
  );
}
