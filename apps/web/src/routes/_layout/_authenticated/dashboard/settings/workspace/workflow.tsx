import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import ColumnEnforcementSection from "@/components/workspace-column/column-enforcement-section";
import WorkspaceColumnEditor from "@/components/workspace-column/workspace-column-editor";
import { useGetWorkspaceColumns } from "@/hooks/queries/workspace-column/use-get-workspace-columns";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/workflow",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { workspace, canUpdateProjects, canManageSettings } =
    useWorkspacePermission();
  const workspaceId = workspace?.id ?? "";
  const { data, isLoading, isError, refetch } =
    useGetWorkspaceColumns(workspaceId);

  const columns = data?.columns;
  const enforced = data?.enforced === true;

  return (
    <>
      <PageTitle title={t("settings:workspaceWorkflow.pageTitle")} />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:workspaceWorkflow.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:workspaceWorkflow.subtitle")}
          </p>
        </div>

        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-md font-medium">
              {t("settings:workspaceWorkflow.columnsTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("settings:workspaceWorkflow.columnsDescription")}
            </p>
            {enforced && (
              <p className="text-xs text-muted-foreground">
                {t("settings:workspaceWorkflow.columnsEnforcedHint")}
              </p>
            )}
          </div>
          {isError ? (
            <Alert variant="error">
              <AlertDescription>
                <p>{t("settings:workspaceWorkflow.loadError")}</p>
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void refetch()}
                  >
                    {t("settings:workspaceWorkflow.retry")}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <WorkspaceColumnEditor
                workspaceId={workspaceId}
                columns={columns}
                enforced={enforced}
                isLoading={isLoading || !workspaceId}
                canEdit={canUpdateProjects()}
              />
              {columns && columns.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("settings:workspaceWorkflow.empty")}
                </p>
              )}
            </>
          )}
        </div>

        {workspaceId && !isError && columns && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-md font-medium">
                {t("settings:workspaceWorkflow.enforcement.title")}
              </h2>
            </div>
            <ColumnEnforcementSection
              workspaceId={workspaceId}
              columns={columns}
              enforced={enforced}
              canManage={canManageSettings()}
            />
          </div>
        )}
      </div>
    </>
  );
}
