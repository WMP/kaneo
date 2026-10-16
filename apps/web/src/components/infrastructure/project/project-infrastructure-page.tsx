import { useTranslation } from "react-i18next";
import useProjectCapacity from "@/hooks/queries/infrastructure/use-project-capacity";
import useProjectHosts from "@/hooks/queries/infrastructure/use-project-hosts";
import useProjectModels from "@/hooks/queries/infrastructure/use-project-models";
import { useProjectPermission } from "@/hooks/use-project-permission";
import { HostsTable } from "./hosts-table";
import { ModelsTable } from "./models-table";
import { WarningsPanel } from "./warnings-panel";

type Props = {
  projectId: string;
  workspaceId: string;
};

// Project settings > Infrastructure: the model pool, the hosts and the
// capacity warnings of one project.
export function ProjectInfrastructurePage({ projectId, workspaceId }: Props) {
  const { t } = useTranslation();
  const {
    canReadInfrastructure,
    canPlanInfrastructure,
    canManageInfrastructure,
  } = useProjectPermission(projectId);
  const canRead = canReadInfrastructure();

  const models = useProjectModels(projectId, canRead);
  const hosts = useProjectHosts(projectId, canRead);
  const capacity = useProjectCapacity(projectId, canRead);

  if (!canRead) return null;

  if (models.isError || hosts.isError) {
    return (
      <p className="text-sm text-destructive-foreground">
        {t("settings:projectInfrastructure.loadError")}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">
          {t("settings:projectInfrastructure.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("settings:projectInfrastructure.description")}
        </p>
      </div>

      <WarningsPanel
        projectId={projectId}
        workspaceId={workspaceId}
        capacity={capacity.data}
      />

      <HostsTable
        projectId={projectId}
        hosts={hosts.data ?? []}
        models={models.data ?? []}
        capacity={capacity.data}
        canPlan={canPlanInfrastructure()}
        canManage={canManageInfrastructure()}
      />

      <ModelsTable
        projectId={projectId}
        models={models.data ?? []}
        canManage={canManageInfrastructure()}
      />
    </div>
  );
}
