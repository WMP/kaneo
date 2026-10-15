import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type EnforcedColumnsAlertProps = {
  canManageWorkspaceColumns: boolean;
};

// Shown instead of an editable list while the workspace enforces its columns:
// every project then has exactly the workspace columns and cannot change them.
export function EnforcedColumnsAlert({
  canManageWorkspaceColumns,
}: EnforcedColumnsAlertProps) {
  const { t } = useTranslation();

  return (
    <Alert variant="info">
      <Lock />
      <AlertTitle>{t("settings:projectWorkflow.enforced.title")}</AlertTitle>
      <AlertDescription>
        <p>
          {canManageWorkspaceColumns
            ? t("settings:projectWorkflow.enforced.description")
            : t("settings:projectWorkflow.enforced.descriptionNoAccess")}
        </p>
        {canManageWorkspaceColumns ? (
          <div>
            <Button
              render={<Link to="/dashboard/settings/workspace/workflow" />}
              variant="outline"
              size="sm"
            >
              {t("settings:projectWorkflow.enforced.manageLink")}
            </Button>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
