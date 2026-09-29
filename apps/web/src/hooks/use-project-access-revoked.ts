import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectAccessRevoked } from "@/hooks/use-project-websocket";
import { toast } from "@/lib/toast";

// What the project views do when the project socket reports that the caller's
// access ended or changed: tell the person, and leave the project for the
// workspace dashboard when it can no longer be opened.
export function useProjectAccessRevoked(workspaceId: string) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return useCallback(
    ({ accessible }: ProjectAccessRevoked) => {
      if (accessible) {
        toast.info(t("common:projectAccess.changed"));
        return;
      }
      toast.error(t("common:projectAccess.lost"));
      void navigate({
        to: "/dashboard/workspace/$workspaceId",
        params: { workspaceId },
        replace: true,
      });
    },
    [navigate, t, workspaceId],
  );
}
