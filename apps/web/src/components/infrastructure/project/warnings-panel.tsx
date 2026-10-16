import { useTranslation } from "react-i18next";
import type { ProjectCapacity } from "@/fetchers/infrastructure/get-project-capacity";
import { InfrastructureWarningList } from "../infrastructure-warning-list";

type Props = {
  projectId: string;
  workspaceId: string;
  capacity: ProjectCapacity | undefined;
};

export function WarningsPanel({ projectId, workspaceId, capacity }: Props) {
  const { t } = useTranslation();
  const warnings = capacity?.warnings ?? [];

  return (
    <section className="space-y-3" aria-labelledby="infra-warnings-title">
      <h2 id="infra-warnings-title" className="text-base font-semibold">
        {t("settings:projectInfrastructure.warnings.title")}
      </h2>
      {warnings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings:projectInfrastructure.warnings.empty")}
        </p>
      ) : (
        <InfrastructureWarningList
          warnings={warnings}
          hosts={capacity?.hosts ?? []}
          projectId={projectId}
          workspaceId={workspaceId}
        />
      )}
    </section>
  );
}
